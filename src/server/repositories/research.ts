import type { Database } from "../db/connection";

// ENT-014 研究課題と ENT-015 週報（DD-03 `research_topic`、`research_report`）のうち、
// 週報の受け取りの読み書き（DD-01 M22。DD-02 FN-025 手順 6.2、6.3。CR-020）。

// 研究課題を残すときの値（DD-02 FN-025 手順 6.2）。
export interface ResearchTopicValues {
  topicKey: string;
  title: string;
  status: string;
  week: number;
  receivedAt: string;
}

// 週報を残すときの値（`research_report` の中身の列）。
export interface ResearchReportValues {
  week: number;
  sentOn: string;
  status: string;
  answerMd: string;
  approachesJson: string;
  unknownsMd: string;
  changesMd: string;
}

// 課題の ID と週の週報の内容ID（`research_report_week_uq` で1つまで）。無ければ null。
export function findResearchContentId(
  db: Database,
  topicKey: string,
  week: number,
): number | null {
  const row = db
    .prepare(
      "SELECT r.content_id FROM research_report AS r JOIN research_topic AS t ON t.topic_id = r.topic_id WHERE t.topic_key = ? AND r.week = ?",
    )
    .get(topicKey, week);
  return row === undefined ? null : Number(row.content_id);
}

// 研究課題を探し、無ければ作る。あって、届いた週が最後の週以上なら、課題名、状態、最後の週、
// 最後に届いた日時を新しい値にする。届いた週が小さいときは変えない（DD-02 FN-025 手順 6.2）。
// 課題の行の ID を返す。
export function upsertResearchTopic(
  db: Database,
  values: ResearchTopicValues,
): number {
  const row = db
    .prepare(
      "SELECT topic_id, last_week FROM research_topic WHERE topic_key = ?",
    )
    .get(values.topicKey);
  if (row === undefined) {
    const result = db
      .prepare(
        "INSERT INTO research_topic (topic_key, title, status, last_week, last_received_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(
        values.topicKey,
        values.title,
        values.status,
        values.week,
        values.receivedAt,
      );
    return Number(result.lastInsertRowid);
  }
  const topicId = Number(row.topic_id);
  if (values.week >= Number(row.last_week)) {
    db.prepare(
      "UPDATE research_topic SET title = ?, status = ?, last_week = ?, last_received_at = ? WHERE topic_id = ?",
    ).run(values.title, values.status, values.week, values.receivedAt, topicId);
  }
  return topicId;
}

// 週報を作る（内容を作った後に呼ぶ）。
export function insertResearchReportRow(
  db: Database,
  contentId: number,
  topicId: number,
  values: ResearchReportValues,
): void {
  db.prepare(
    "INSERT INTO research_report (content_id, topic_id, week, sent_on, status, answer_md, approaches_json, unknowns_md, changes_md) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    contentId,
    topicId,
    values.week,
    values.sentOn,
    values.status,
    values.answerMd,
    values.approachesJson,
    values.unknownsMd,
    values.changesMd,
  );
}

// 週報の全ての中身の列を新しい値にする（内容ID と課題と週は変えない。DD-02 FN-025 手順 6.3）。
export function updateResearchReportRow(
  db: Database,
  contentId: number,
  values: ResearchReportValues,
): void {
  db.prepare(
    "UPDATE research_report SET sent_on = ?, status = ?, answer_md = ?, approaches_json = ?, unknowns_md = ?, changes_md = ? WHERE content_id = ?",
  ).run(
    values.sentOn,
    values.status,
    values.answerMd,
    values.approachesJson,
    values.unknownsMd,
    values.changesMd,
    contentId,
  );
}
