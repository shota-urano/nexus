import type { Database } from "../db/connection";

// ENT-001 内容と ENT-003 英語のセット（DD-03 `content`、`english_set`）のうち、
// 英語のセットの受け取りの読み書き（DD-01 M22。DD-02 FN-007 手順 4.2、4.3）。

// セットを残すときの値（`english_set` の全ての列）。
export interface EnglishSetValues {
  learningTheme: string;
  lessonBodyMd: string;
  closingMd: string | null;
  problemsJson: string;
  readingJson: string | null;
  rawPayloadJson: string;
}

// 日付の英語の内容ID（`content_english_date_uq` で1つまで）。無ければ null。
export function findEnglishContentIdByDate(
  db: Database,
  targetDate: string,
): number | null {
  const row = db
    .prepare(
      "SELECT content_id FROM content WHERE kind = 'english' AND target_date = ?",
    )
    .get(targetDate);
  return row === undefined ? null : Number(row.content_id);
}

// セットを作る（内容を作った後に呼ぶ）。
export function insertEnglishSetRow(
  db: Database,
  contentId: number,
  values: EnglishSetValues,
): void {
  db.prepare(
    `INSERT INTO english_set
       (content_id, learning_theme, lesson_body_md, closing_md, problems_json, reading_json, raw_payload_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    contentId,
    values.learningTheme,
    values.lessonBodyMd,
    values.closingMd,
    values.problemsJson,
    values.readingJson,
    values.rawPayloadJson,
  );
}

// セットの全ての列を新しい値にする（BD-02 FN-007 業務ルール）。答えと内容の状態は変えない。
export function updateEnglishSetRow(
  db: Database,
  contentId: number,
  values: EnglishSetValues,
): void {
  db.prepare(
    `UPDATE english_set SET learning_theme = ?, lesson_body_md = ?, closing_md = ?,
       problems_json = ?, reading_json = ?, raw_payload_json = ?
     WHERE content_id = ?`,
  ).run(
    values.learningTheme,
    values.lessonBodyMd,
    values.closingMd,
    values.problemsJson,
    values.readingJson,
    values.rawPayloadJson,
    contentId,
  );
}

// sharpen に返すセット（DD-02 FN-013 手順 2）。届いた原文と、内容を受け取った日時。
export interface EnglishSetForSenderRow {
  rawPayloadJson: string;
  receivedAt: string;
}

// 日付の英語のセットの原文を読む。内容かセットが無ければ null。
export function findEnglishSetForSenderByDate(
  db: Database,
  targetDate: string,
): EnglishSetForSenderRow | null {
  const row = db
    .prepare(
      `SELECT s.raw_payload_json, c.received_at
       FROM content AS c JOIN english_set AS s ON s.content_id = c.content_id
       WHERE c.kind = 'english' AND c.target_date = ?`,
    )
    .get(targetDate);
  if (row === undefined) return null;
  return {
    rawPayloadJson: String(row.raw_payload_json),
    receivedAt: String(row.received_at),
  };
}

// sharpen に返す答え（DD-02 FN-013 手順 3）。セットが無ければ null。
// セットがあって答えが無ければ answer が null。
export interface EnglishAnswerForSenderRow {
  answer: { answersJson: string; completedAt: string } | null;
}

export function findEnglishAnswerForSenderByDate(
  db: Database,
  targetDate: string,
): EnglishAnswerForSenderRow | null {
  const row = db
    .prepare(
      `SELECT a.answers_json, a.completed_at
       FROM content AS c
         JOIN english_set AS s ON s.content_id = c.content_id
         LEFT JOIN english_answer AS a ON a.content_id = s.content_id
       WHERE c.kind = 'english' AND c.target_date = ?`,
    )
    .get(targetDate);
  if (row === undefined) return null;
  if (row.answers_json === null || row.answers_json === undefined) {
    return { answer: null };
  }
  return {
    answer: {
      answersJson: String(row.answers_json),
      completedAt: String(row.completed_at),
    },
  };
}

// 教材の一覧の1行（DD-02 FN-008。`content` と `english_set` に `english_answer` と `content_state` を外部結合した行）。
export interface EnglishSetListRow {
  contentId: number;
  learningTheme: string;
  targetDate: string;
  receivedAt: string;
  openedAt: string | null;
  isRead: boolean;
  isSaved: boolean;
  isCompleted: boolean;
}

// 教材の一覧（BD-02 FN-008）。対象日と ID の大きい順に `count` 件まで読む（DD-02 3章 P03 手順 2）。
// `after` は前のページの最後の行の対象日と ID。
export function listEnglishSetRows(
  db: Database,
  after: { value: string; id: number } | null,
  count: number,
): EnglishSetListRow[] {
  const afterCondition =
    after === null
      ? ""
      : "AND (c.target_date < ? OR (c.target_date = ? AND c.content_id < ?))";
  const params =
    after === null ? [count] : [after.value, after.value, after.id, count];
  return db
    .prepare(
      `SELECT c.content_id AS content_id,
              e.learning_theme AS learning_theme,
              c.target_date AS target_date,
              c.received_at AS received_at,
              s.opened_at AS opened_at,
              COALESCE(s.is_read, 0) AS is_read,
              COALESCE(s.is_saved, 0) AS is_saved,
              a.content_id IS NOT NULL AS is_completed
         FROM content AS c
         JOIN english_set AS e ON e.content_id = c.content_id
         LEFT JOIN english_answer AS a ON a.content_id = c.content_id
         LEFT JOIN content_state AS s ON s.content_id = c.content_id
        WHERE c.kind = 'english'
          ${afterCondition}
        ORDER BY c.target_date DESC, c.content_id DESC
        LIMIT ?`,
    )
    .all(...params)
    .map((row) => ({
      contentId: Number(row.content_id),
      learningTheme: String(row.learning_theme),
      targetDate: String(row.target_date),
      receivedAt: String(row.received_at),
      openedAt: (row.opened_at as string | null) ?? null,
      isRead: Number(row.is_read) === 1,
      isSaved: Number(row.is_saved) === 1,
      isCompleted: Number(row.is_completed) === 1,
    }));
}

// 教材の1行（DD-02 FN-009 手順 2）。
export interface EnglishSetDetailRow {
  contentId: number;
  learningTheme: string;
  targetDate: string;
  lessonBodyMd: string;
  closingMd: string | null;
  problemsJson: string;
  readingJson: string | null;
  answer: { answersJson: string; completedAt: string } | null;
}

// 内容ID の英語のセットを、前に完了した答えと一緒に読む。内容が無いか英語でなければ null。
export function findEnglishSetDetail(
  db: Database,
  contentId: number,
): EnglishSetDetailRow | null {
  const row = db
    .prepare(
      `SELECT c.content_id, e.learning_theme, c.target_date, e.lesson_body_md, e.closing_md,
              e.problems_json, e.reading_json, a.answers_json, a.completed_at
         FROM content AS c
         JOIN english_set AS e ON e.content_id = c.content_id
         LEFT JOIN english_answer AS a ON a.content_id = c.content_id
        WHERE c.kind = 'english' AND c.content_id = ?`,
    )
    .get(contentId);
  if (row === undefined) return null;
  return {
    contentId: Number(row.content_id),
    learningTheme: String(row.learning_theme),
    targetDate: String(row.target_date),
    lessonBodyMd: String(row.lesson_body_md),
    closingMd: (row.closing_md as string | null) ?? null,
    problemsJson: String(row.problems_json),
    readingJson: (row.reading_json as string | null) ?? null,
    answer:
      row.answers_json === null || row.answers_json === undefined
        ? null
        : {
            answersJson: String(row.answers_json),
            completedAt: String(row.completed_at),
          },
  };
}

// 内容ID の英語のセットの問題（`problems_json`）を読む。内容が無いか英語でなければ null。
export function findEnglishProblemsJson(
  db: Database,
  contentId: number,
): string | null {
  const row = db
    .prepare(
      `SELECT e.problems_json
         FROM content AS c JOIN english_set AS e ON e.content_id = c.content_id
        WHERE c.kind = 'english' AND c.content_id = ?`,
    )
    .get(contentId);
  return row === undefined ? null : String(row.problems_json);
}

// 答えを置き換える（無ければ作る。BD-02 FN-012）。
export function upsertEnglishAnswerRow(
  db: Database,
  contentId: number,
  answersJson: string,
  completedAt: string,
): void {
  db.prepare(
    `INSERT INTO english_answer (content_id, answers_json, completed_at) VALUES (?, ?, ?)
     ON CONFLICT (content_id) DO UPDATE
        SET answers_json = excluded.answers_json, completed_at = excluded.completed_at`,
  ).run(contentId, answersJson, completedAt);
}

// AI チャットに渡す英語のセット（DD-02 3章 P07 手順 3 の英語）。
export interface ChatEnglishSetRow {
  learningTheme: string;
  lessonBodyMd: string;
  readingJson: string | null;
}

export function findChatEnglishSet(
  db: Database,
  contentId: number,
): ChatEnglishSetRow | null {
  const row = db
    .prepare(
      "SELECT learning_theme, lesson_body_md, reading_json FROM english_set WHERE content_id = ?",
    )
    .get(contentId);
  if (row === undefined) return null;
  return {
    learningTheme: String(row.learning_theme),
    lessonBodyMd: String(row.lesson_body_md),
    readingJson: (row.reading_json as string | null) ?? null,
  };
}
