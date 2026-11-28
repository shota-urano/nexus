import type {
  ApproachMark,
  ApproachPayload,
  ResearchStatus,
  StepPayload,
} from "../../../contracts/research";
import type { Database } from "../../db/connection";
import { toDbError } from "../../db/errors";
import { inReadTransaction } from "../../db/transaction";
import {
  findResearchApproachesJson,
  findResearchReportView,
  insertApproachSeen,
  listResearchTopicRows,
  listResearchWeeks,
  listSeenApproachNos,
} from "../../repositories/research";
import type { Clock } from "../../shared/clock";
import { formatDateTime } from "../../shared/datetime";
import { NexusError } from "../../shared/errors";

// 課題の一覧と週報のデータ（DD-01 M33。DD-02 FN-026、FN-027。CR-020）。読むのと、方法を確かめた印を
// 残すこと（FN-027 手順 8。CR-024）だけを行う。
// 週報は2つ以上の文で同じ時点の値を読むので、読むためのトランザクション（`BEGIN`）で読む（DD-05 1章）。

// `openapi.yaml` の `ResearchTopicSummary`。
export interface ResearchTopicSummary {
  topicId: string;
  title: string;
  status: ResearchStatus;
  lastWeek: number;
  lastReceivedAt: string;
  latestContentId: number;
  hasUnread: boolean;
}

// `openapi.yaml` の `ResearchTopicList`。
export interface ResearchTopicList {
  topics: ResearchTopicSummary[];
}

// `openapi.yaml` の `Approach`。
export interface Approach {
  title: string;
  howToMd: string;
  sourceUrls: string[];
  // 出典の URL の数（Q-088 の答え。数は残さない。DD-02 FN-027 手順 4）。
  sourceCount: number;
  marks: ApproachMark[];
  counterMd: string | null;
  // 方法の番号とぶら下がる段。無ければ null。本人が確かめたか（番号が無ければ偽。CR-024）。
  no: number | null;
  step: number | null;
  seen: boolean;
}

// `openapi.yaml` の `ApproachSeen`（CR-024）。
export interface ApproachSeen {
  contentId: number;
  no: number;
  seenAt: string;
}

// `openapi.yaml` の `ResearchReportDetail`。
export interface ResearchReportDetail {
  contentId: number;
  topicId: string;
  topicTitle: string;
  week: number;
  sentOn: string;
  status: ResearchStatus;
  answerMd: string;
  approaches: Approach[];
  unknownsMd: string;
  changesMd: string;
  receivedAt: string;
  state: {
    contentId: number;
    isNew: boolean;
    isRead: boolean;
    isSaved: boolean;
    savedAt: string | null;
  };
  // 同じ課題の週の一覧。週の大きい順。
  weeks: { contentId: number; week: number; sentOn: string; isRead: boolean }[];
  // 段の一覧（送られた順。段の欄の無い週報は空）と段の変更の案（無ければ null。CR-024）。
  steps: StepPayload[];
  stepChangesMd: string | null;
}

export interface ResearchView {
  // 課題の一覧（FN-026 手順 2、3）。最後に届いた日時の新しい順。
  listTopics(): ResearchTopicList;
  // 週報と同じ課題の週の一覧（FN-027 手順 2〜4）。
  // 内容が無いか週報でなければ NOT_FOUND（MSG-048）を投げる。
  getReport(contentId: number): ResearchReportDetail;
  // 方法を確かめた日時を残す（FN-027 手順 8。RD-03 R26。CR-024）。前に確かめていれば最初の日時のまま。
  // 週報が無いか、その番号の方法が無ければ NOT_FOUND（MSG-048）を投げる。
  markApproachSeen(contentId: number, no: number): ApproachSeen;
}

// 残した方法（BD-06 IF-005 3.2 の名前のまま）に出典の数と確かめたかを添える。反対の意見、番号、段が
// 無ければ null。
function toApproach(approach: ApproachPayload, seen: Set<number>): Approach {
  const no = approach.no ?? null;
  return {
    title: approach.title,
    howToMd: approach.howToMd,
    sourceUrls: approach.sourceUrls,
    sourceCount: approach.sourceUrls.length,
    marks: approach.marks,
    counterMd: approach.counterMd ?? null,
    no,
    step: approach.step ?? null,
    seen: no !== null && seen.has(no),
  };
}

const notFound = () =>
  new NexusError("NOT_FOUND", "週報が無い", { msg: "MSG-048" });

export function createResearchView(deps: {
  db: Database;
  clock: Clock;
}): ResearchView {
  const { db, clock } = deps;

  return {
    listTopics() {
      const topics = inReadTransaction(db, () => listResearchTopicRows(db));
      return {
        topics: topics.map((row) => ({
          topicId: row.topicKey,
          title: row.title,
          status: row.status as ResearchStatus,
          lastWeek: row.lastWeek,
          lastReceivedAt: row.lastReceivedAt,
          latestContentId: row.latestContentId,
          hasUnread: row.hasUnread,
        })),
      };
    },

    getReport(contentId) {
      return inReadTransaction(db, () => {
        const row = findResearchReportView(db, contentId);
        if (row === null) throw notFound();
        const seen = new Set(listSeenApproachNos(db, contentId));
        const approaches = (
          JSON.parse(row.approachesJson) as ApproachPayload[]
        ).map((approach) => toApproach(approach, seen));
        return {
          contentId: row.contentId,
          topicId: row.topicKey,
          topicTitle: row.topicTitle,
          week: row.week,
          sentOn: row.sentOn,
          status: row.status as ResearchStatus,
          answerMd: row.answerMd,
          approaches,
          unknownsMd: row.unknownsMd,
          changesMd: row.changesMd,
          receivedAt: row.receivedAt,
          state: {
            contentId: row.contentId,
            isNew: row.openedAt === null,
            isRead: row.isRead,
            isSaved: row.isSaved,
            savedAt: row.savedAt,
          },
          weeks: listResearchWeeks(db, row.topicId),
          steps:
            row.stepsJson === null
              ? []
              : (JSON.parse(row.stepsJson) as StepPayload[]),
          stepChangesMd: row.stepChangesMd,
        };
      });
    },

    markApproachSeen(contentId, no) {
      try {
        const approachesJson = findResearchApproachesJson(db, contentId);
        if (approachesJson === null) throw notFound();
        const approaches = JSON.parse(approachesJson) as ApproachPayload[];
        if (!approaches.some((approach) => approach.no === no)) {
          throw notFound();
        }
        const seenAt = insertApproachSeen(
          db,
          contentId,
          no,
          formatDateTime(clock.now()),
        );
        return { contentId, no, seenAt };
      } catch (error) {
        throw toDbError(error);
      }
    },
  };
}
