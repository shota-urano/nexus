import {
  type ResearchReportPayload,
  RESEARCH_REPORT_MAX_BYTES,
  RESEARCH_SOURCE,
  checkResearchReportPayload,
  isRealDate,
} from "../../../contracts/research";
import type { Database } from "../../db/connection";
import {
  type ResearchReportValues,
  findResearchContentId,
  insertResearchReportRow,
  updateResearchReportRow,
  upsertResearchTopic,
} from "../../repositories/research";

// 週報の受け取りの形の確かめと、研究課題と週報を残す処理（DD-01 M33。DD-02 FN-025 手順 4〜6。CR-020）。
// 形は M10 の `ResearchReportPayload`（M34 と同じ定義。DD-01 M10）で確かめる。1つでも外れたら
// 週報の全体を断る（記事と違い、一部だけは残さない。BD-02 FN-025）。
// M14 の種類の一覧を読み込まず、同じ形の操作を公開する（DD-01 M14。輪を作らないため）。

export const RESEARCH_KIND = "research";
export { RESEARCH_REPORT_MAX_BYTES, RESEARCH_SOURCE };

// 置き換える相手を決める値（課題の ID と週）を1つの文字にする。課題の ID は a〜z、0〜9、`-` だけなので
// `#` で区切れる。
const keyOf = (topicId: string, week: number) => `${topicId}#${week}`;

function parseKey(key: string): { topicId: string; week: number } {
  const at = key.lastIndexOf("#");
  return { topicId: key.slice(0, at), week: Number(key.slice(at + 1)) };
}

// 内容の見出し「{課題名}（{week}週目）」（DD-02 FN-025 手順 6.3）。
export function researchReportTitle(topicTitle: string, week: number): string {
  return `${topicTitle}（${week}週目）`;
}

// 検索の本文（見出しの後につなぐ部分）。現時点の答えと方法の見出しを改行でつなぐ
// （DD-02 FN-025 手順 6.4、3章 P08。RD-03 R19）。課題名は見出しに入る。
export function researchSearchBody(report: ResearchReportPayload): string {
  return [report.answerMd, ...report.approaches.map((a) => a.title)].join("\n");
}

// 全体の形の確かめの結果（DD-02 FN-025 手順 4、5）。週報は1件として返す。
// 断るときの `date` は、送った日が正しければその値、でなければ null。
export type ResearchBatchCheck =
  | { ok: true; date: string; items: ResearchReportPayload[] }
  | { ok: false; msg: "MSG-033"; field: string; date: string | null }
  | { ok: false; msg: "MSG-034"; date: string | null };

export type ResearchItemCheck =
  | { ok: true; item: AcceptedResearchReport }
  | { ok: false; label: string; field: string };

// 形の正しい週報。見出しと検索の本文と、種類ごとの中身を残す処理を持つ（DD-01 M14）。
export interface AcceptedResearchReport {
  key: string;
  title: string;
  searchBody: string;
  insertDetail(db: Database, contentId: number, receivedAt: string): void;
  updateDetail(db: Database, contentId: number, receivedAt: string): void;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function checkResearchReport(payload: unknown): ResearchBatchCheck {
  const checked = checkResearchReportPayload(payload);
  if (checked.ok) {
    return { ok: true, date: checked.value.sentOn, items: [checked.value] };
  }
  // 送った日が正しい形なら、断った記録の対象日に入れる（DD-02 FN-025「結果とメッセージ」）。
  const sentOn = isRecord(payload) ? payload.sentOn : undefined;
  const date = typeof sentOn === "string" && isRealDate(sentOn) ? sentOn : null;
  return { ok: false, msg: "MSG-033", field: checked.field, date };
}

function valuesOf(report: ResearchReportPayload): ResearchReportValues {
  return {
    week: report.week,
    sentOn: report.sentOn,
    status: report.status,
    answerMd: report.answerMd,
    // 方法は送られた順に、BD-06 IF-005 3.2 の名前のまま残す（DD-03 2章）。
    approachesJson: JSON.stringify(report.approaches),
    unknownsMd: report.unknownsMd,
    changesMd: report.changesMd,
    // 段の欄（CR-024）。無ければ NULL にする（DD-03 2.2）。
    stepsJson: report.steps == null ? null : JSON.stringify(report.steps),
    stepChangesMd: report.stepChangesMd ?? null,
  };
}

export function checkResearchItem(raw: unknown): ResearchItemCheck {
  const report = raw as ResearchReportPayload;
  const values = valuesOf(report);
  // 研究課題を探して作るか新しい値にする（DD-02 FN-025 手順 6.2）。
  const topicOf = (db: Database, receivedAt: string) =>
    upsertResearchTopic(db, {
      topicKey: report.topicId,
      title: report.topicTitle,
      status: report.status,
      week: report.week,
      receivedAt,
    });
  return {
    ok: true,
    item: {
      key: keyOf(report.topicId, report.week),
      title: researchReportTitle(report.topicTitle, report.week),
      searchBody: researchSearchBody(report),
      insertDetail: (db, contentId, receivedAt) => {
        const topicId = topicOf(db, receivedAt);
        insertResearchReportRow(db, contentId, topicId, values);
      },
      updateDetail: (db, contentId, receivedAt) => {
        topicOf(db, receivedAt);
        updateResearchReportRow(db, contentId, values);
      },
    },
  };
}

// 種類の一覧（M14）に登録する、週報の受け取りの操作。
export const researchIngest = {
  kind: RESEARCH_KIND,
  // 1回の送信は1つの週報なので、同じ送信の中の重なりは起きない。
  keyField: "week",
  // 記事の関係の判定はしない（Q-094 の答え）。
  relatesAfterIngest: false,
  // 残す途中の失敗は MSG-046（DD-02 FN-025「結果とメッセージ」）。
  failureMessage: "MSG-046" as const,
  checkBatch: checkResearchReport,
  checkItem: checkResearchItem,
  // 同じ課題の同じ週の週報の内容ID（DD-02 FN-025 手順 6.3）。対象日では決めない。
  findContentId: (db: Database, _date: string, key: string) => {
    const { topicId, week } = parseKey(key);
    return findResearchContentId(db, topicId, week);
  },
};
