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
