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
  // 段の一覧（JSON）と段の変更の案。段の欄の無い週報は null（CR-024）。
  stepsJson: string | null;
  stepChangesMd: string | null;
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
    "INSERT INTO research_report (content_id, topic_id, week, sent_on, status, answer_md, approaches_json, unknowns_md, changes_md, steps_json, step_changes_md) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
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
    values.stepsJson,
    values.stepChangesMd,
  );
}

// 週報の全ての中身の列を新しい値にする（内容ID と課題と週は変えない。DD-02 FN-025 手順 6.3）。
export function updateResearchReportRow(
  db: Database,
  contentId: number,
  values: ResearchReportValues,
): void {
  db.prepare(
    "UPDATE research_report SET sent_on = ?, status = ?, answer_md = ?, approaches_json = ?, unknowns_md = ?, changes_md = ?, steps_json = ?, step_changes_md = ? WHERE content_id = ?",
  ).run(
    values.sentOn,
    values.status,
    values.answerMd,
    values.approachesJson,
    values.unknownsMd,
    values.changesMd,
    values.stepsJson,
    values.stepChangesMd,
    contentId,
  );
}

// AI チャットに渡す内容の組み立てで読む週報（DD-02 3章 P07 手順 3。CR-020）。
export interface ChatResearchReport {
  topicTitle: string;
  week: number;
  status: string;
  answerMd: string;
  approachesJson: string;
  unknownsMd: string;
  changesMd: string;
}

// 内容ID の週報と、その課題名。無ければ null。
export function findChatResearchReport(
  db: Database,
  contentId: number,
): ChatResearchReport | null {
  const row = db
    .prepare(
      "SELECT t.title, r.week, r.status, r.answer_md, r.approaches_json, r.unknowns_md, r.changes_md FROM research_report AS r JOIN research_topic AS t ON t.topic_id = r.topic_id WHERE r.content_id = ?",
    )
    .get(contentId);
  if (row === undefined) return null;
  return {
    topicTitle: String(row.title),
    week: Number(row.week),
    status: String(row.status),
    answerMd: String(row.answer_md),
    approachesJson: String(row.approaches_json),
    unknownsMd: String(row.unknowns_md),
    changesMd: String(row.changes_md),
  };
}

// 課題の一覧の1行（DD-02 FN-026 手順 2、3。CR-020）。
export interface ResearchTopicRow {
  topicKey: string;
  title: string;
  status: string;
  lastWeek: number;
  lastReceivedAt: string;
  latestContentId: number;
  hasUnread: boolean;
}

// 研究課題を最後に届いた日時の新しい順（同じ日時は課題の行の ID の大きい順）に全て読む。
// 最新の週の週報の内容ID と、既読でない週報（`content_state` が無いか `is_read` が 0）があるかを添える。
// 週報の無い課題は出さない。
export function listResearchTopicRows(db: Database): ResearchTopicRow[] {
  return db
    .prepare(
      `SELECT t.topic_key, t.title, t.status, t.last_week, t.last_received_at,
              (SELECT r.content_id FROM research_report AS r
                WHERE r.topic_id = t.topic_id
                ORDER BY r.week DESC LIMIT 1) AS latest_content_id,
              EXISTS (SELECT 1 FROM research_report AS r
                        LEFT JOIN content_state AS s ON s.content_id = r.content_id
                       WHERE r.topic_id = t.topic_id
                         AND (s.content_id IS NULL OR s.is_read = 0)) AS has_unread
         FROM research_topic AS t
        WHERE EXISTS (SELECT 1 FROM research_report AS r WHERE r.topic_id = t.topic_id)
        ORDER BY t.last_received_at DESC, t.topic_id DESC`,
    )
    .all()
    .map((row) => ({
      topicKey: String(row.topic_key),
      title: String(row.title),
      status: String(row.status),
      lastWeek: Number(row.last_week),
      lastReceivedAt: String(row.last_received_at),
      latestContentId: Number(row.latest_content_id),
      hasUnread: Number(row.has_unread) === 1,
    }));
}

// 週報の表示で読む週報と、その内容の状態（DD-02 FN-027 手順 2。CR-020）。
export interface ResearchReportViewRow {
  contentId: number;
  topicId: number;
  topicKey: string;
  topicTitle: string;
  week: number;
  sentOn: string;
  status: string;
  answerMd: string;
  approachesJson: string;
  unknownsMd: string;
  changesMd: string;
  // 段の一覧（JSON）と段の変更の案。段の欄の無い週報は null（CR-024）。
  stepsJson: string | null;
  stepChangesMd: string | null;
  receivedAt: string;
  openedAt: string | null;
  isRead: boolean;
  isSaved: boolean;
  savedAt: string | null;
}

// 内容ID の週報（`content` の `kind` が research）。無いか週報でなければ null。
export function findResearchReportView(
  db: Database,
  contentId: number,
): ResearchReportViewRow | null {
  const row = db
    .prepare(
      `SELECT c.content_id, c.received_at, t.topic_id, t.topic_key, t.title,
              r.week, r.sent_on, r.status, r.answer_md, r.approaches_json, r.unknowns_md, r.changes_md,
              r.steps_json, r.step_changes_md,
              s.opened_at, COALESCE(s.is_read, 0) AS is_read,
              COALESCE(s.is_saved, 0) AS is_saved, s.saved_at
         FROM content AS c
         JOIN research_report AS r ON r.content_id = c.content_id
         JOIN research_topic AS t ON t.topic_id = r.topic_id
         LEFT JOIN content_state AS s ON s.content_id = c.content_id
        WHERE c.content_id = ? AND c.kind = 'research'`,
    )
    .get(contentId);
  if (row === undefined) return null;
  return {
    contentId: Number(row.content_id),
    topicId: Number(row.topic_id),
    topicKey: String(row.topic_key),
    topicTitle: String(row.title),
    week: Number(row.week),
    sentOn: String(row.sent_on),
    status: String(row.status),
    answerMd: String(row.answer_md),
    approachesJson: String(row.approaches_json),
    unknownsMd: String(row.unknowns_md),
    changesMd: String(row.changes_md),
    stepsJson: (row.steps_json as string | null) ?? null,
    stepChangesMd: (row.step_changes_md as string | null) ?? null,
    receivedAt: String(row.received_at),
    openedAt: (row.opened_at as string | null) ?? null,
    isRead: Number(row.is_read) === 1,
    isSaved: Number(row.is_saved) === 1,
    savedAt: (row.saved_at as string | null) ?? null,
  };
}

// 週の一覧の1行（DD-02 FN-027 手順 3）。
export interface ResearchWeekRow {
  contentId: number;
  week: number;
  sentOn: string;
  isRead: boolean;
}

// 課題の全ての週の週報と、それぞれの既読を、週の大きい順に読む。
export function listResearchWeeks(
  db: Database,
  topicId: number,
): ResearchWeekRow[] {
  return db
    .prepare(
      `SELECT r.content_id, r.week, r.sent_on, COALESCE(s.is_read, 0) AS is_read
         FROM research_report AS r
         LEFT JOIN content_state AS s ON s.content_id = r.content_id
        WHERE r.topic_id = ?
        ORDER BY r.week DESC`,
    )
    .all(topicId)
    .map((row) => ({
      contentId: Number(row.content_id),
      week: Number(row.week),
      sentOn: String(row.sent_on),
      isRead: Number(row.is_read) === 1,
    }));
}

// 週報の確かめた方法の番号（ENT-006 の確かめた方法。DD-03 `research_approach_seen`。CR-024）。
export function listSeenApproachNos(db: Database, contentId: number): number[] {
  return db
    .prepare(
      "SELECT approach_no FROM research_approach_seen WHERE content_id = ? ORDER BY approach_no",
    )
    .all(contentId)
    .map((row) => Number(row.approach_no));
}

// 週報の方法の一覧（JSON）。週報が無いか週報でなければ null（DD-02 FN-027 手順 8）。
export function findResearchApproachesJson(
  db: Database,
  contentId: number,
): string | null {
  const row = db
    .prepare(
      "SELECT r.approaches_json FROM research_report AS r JOIN content AS c ON c.content_id = r.content_id WHERE r.content_id = ? AND c.kind = 'research'",
    )
    .get(contentId);
  return row === undefined ? null : String(row.approaches_json);
}

// 方法を確かめた日時を残す。行が既にあれば変えない（最初の日時を残す）。残っている日時を返す
// （DD-02 FN-027 手順 8。RD-03 R26）。
export function insertApproachSeen(
  db: Database,
  contentId: number,
  approachNo: number,
  seenAt: string,
): string {
  db.prepare(
    "INSERT INTO research_approach_seen (content_id, approach_no, seen_at) VALUES (?, ?, ?) ON CONFLICT (content_id, approach_no) DO NOTHING",
  ).run(contentId, approachNo, seenAt);
  const row = db
    .prepare(
      "SELECT seen_at FROM research_approach_seen WHERE content_id = ? AND approach_no = ?",
    )
    .get(contentId, approachNo);
  return String(row?.seen_at);
}
