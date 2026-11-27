import type { ApproachPayload } from "../../../contracts/research";
import type { Database } from "../../db/connection";
import { findChatResearchReport } from "../../repositories/research";
import { RESEARCH_KIND } from "./ingest";

// AI チャットに渡す内容の組み立てのうち、週報に固有の処理（DD-01 M33。DD-02 3章 P07 手順 3、
// BD-02 FN-015 業務ルール。CR-020）。課題名、何週目か、状態、現時点の答え、方法の一覧（見出し、
// そのためには、出典の URL、印、反対の意見）、まだ分かっていないこと、今週の変化を、読む材料の文にする。
// 対象の種類は `page` だけで、その週の週報の全体を入れる。状態と印は IF-005 の値のまま入れる。
// M14 の種類の一覧を読み込まず、同じ形の操作を公開する（DD-01 M14。輪を作らないため）。

function approachLines(approach: ApproachPayload, index: number): string[] {
  return [
    `### 方法${index + 1}: ${approach.title}`,
    "そのためには:",
    approach.howToMd,
    "出典の URL:",
    ...(approach.sourceUrls.length === 0
      ? ["（無い）"]
      : approach.sourceUrls.map((url) => `- ${url}`)),
    `印: ${approach.marks.length === 0 ? "（無い）" : approach.marks.join("、")}`,
    "反対の意見:",
    approach.counterMd ?? "（無い）",
  ];
}

// 対象の内容の読む材料を組み立てる。週報が無ければ null。
export function buildResearchAnswerMaterial(
  db: Database,
  contentId: number,
): string | null {
  const report = findChatResearchReport(db, contentId);
  if (report === null) return null;
  const approaches = JSON.parse(report.approachesJson) as ApproachPayload[];
  const lines = [
    "種類: 調査の週報",
    `課題名: ${report.topicTitle}`,
    `何週目か: ${report.week}週目`,
    `状態: ${report.status}`,
    "現時点の答え:",
    report.answerMd,
    "",
    "方法の一覧:",
    ...(approaches.length === 0
      ? ["（無い）"]
      : approaches.flatMap((approach, index) => [
          ...approachLines(approach, index),
          "",
        ])),
    "まだ分かっていないこと:",
    report.unknownsMd === "" ? "（無い）" : report.unknownsMd,
    "",
    "今週の変化:",
    report.changesMd,
  ];
  return lines.join("\n");
}

export const researchChat = {
  kind: RESEARCH_KIND,
  buildAnswerMaterial: (db: Database, contentId: number) =>
    buildResearchAnswerMaterial(db, contentId),
};
