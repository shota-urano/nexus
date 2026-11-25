import type { Database } from "../db/connection";
import type { PageCursor } from "../shared/paging";

// ENT-007 会話と ENT-008 発言（DD-03 `conversation`、`message`）の読み書き（DD-01 M22。DD-02 FN-014）。

export interface ConversationRow {
  conversationId: number;
  targetContentId: number | null;
  questionTargetJson: string | null;
  // 対象の内容の見出し（`content.title`）。対象が無ければ null。
  targetTitle: string | null;
  startedAt: string;
  lastSpokenAt: string;
}

export interface MessageRow {
  messageId: number;
  conversationId: number;
  speaker: "owner" | "ai";
  bodyMd: string;
  sentAt: string;
  replyState: "writing" | "done" | "failed" | "cancelled" | null;
  replyToMessageId: number | null;
  // その発言の一番新しい `ai_run` の `failure_reason`（AI の発言で、実行があるときだけ）。
  latestFailureReason: string | null;
  // その発言の `ai_run` があるか。
  hasAiRun: boolean;
}

const CONVERSATION_COLUMNS = `v.conversation_id AS conversation_id,
              v.target_content_id AS target_content_id,
              v.question_target_json AS question_target_json,
              c.title AS target_title,
              v.started_at AS started_at,
              v.last_spoken_at AS last_spoken_at`;

function toConversationRow(row: Record<string, unknown>): ConversationRow {
  return {
    conversationId: Number(row.conversation_id),
    targetContentId:
      row.target_content_id === null ? null : Number(row.target_content_id),
    questionTargetJson: (row.question_target_json as string | null) ?? null,
    targetTitle: (row.target_title as string | null) ?? null,
    startedAt: row.started_at as string,
    lastSpokenAt: row.last_spoken_at as string,
  };
}

// 内容があるか。
export function contentExists(db: Database, contentId: number): boolean {
  return (
    db.prepare("SELECT 1 FROM content WHERE content_id = ?").get(contentId) !==
    undefined
  );
}

// 会話を作り、作った行を返す。`started_at` と `last_spoken_at` は `at`。
export function insertConversation(
  db: Database,
  targetContentId: number | null,
  questionTargetJson: string | null,
  at: string,
): ConversationRow {
  const result = db
    .prepare(
      "INSERT INTO conversation (target_content_id, question_target_json, started_at, last_spoken_at) VALUES (?, ?, ?, ?)",
    )
    .run(targetContentId, questionTargetJson, at, at);
  const row = findConversation(db, Number(result.lastInsertRowid));
  if (row === null) throw new Error("作った会話を読めない");
  return row;
}

export function findConversation(
  db: Database,
  conversationId: number,
): ConversationRow | null {
  const row = db
    .prepare(
      `SELECT ${CONVERSATION_COLUMNS}
         FROM conversation AS v
         LEFT JOIN content AS c ON c.content_id = v.target_content_id
        WHERE v.conversation_id = ?`,
    )
    .get(conversationId);
  return row === undefined ? null : toConversationRow(row);
}

// 対象の内容がその値の会話（null なら対象の無い会話）を、最後に話した日時の新しい順、
// 同じ値のときは ID の大きい順に、`after` の後から `limit` 件まで読む（DD-02 3章 P03、DD-04 3.3）。
export function listConversationRows(
  db: Database,
  targetContentId: number | null,
  after: PageCursor | null,
  limit: number,
): ConversationRow[] {
  const where: string[] = [
    targetContentId === null
      ? "v.target_content_id IS NULL"
      : "v.target_content_id = ?",
  ];
  const params: (string | number)[] =
    targetContentId === null ? [] : [targetContentId];
  if (after !== null) {
    where.push(
      "(v.last_spoken_at < ? OR (v.last_spoken_at = ? AND v.conversation_id < ?))",
    );
    params.push(after.value, after.value, after.id);
  }
  params.push(limit);
  return db
    .prepare(
      `SELECT ${CONVERSATION_COLUMNS}
         FROM conversation AS v
         LEFT JOIN content AS c ON c.content_id = v.target_content_id
        WHERE ${where.join(" AND ")}
        ORDER BY v.last_spoken_at DESC, v.conversation_id DESC
        LIMIT ?`,
    )
    .all(...params)
    .map(toConversationRow);
}

// 会話の発言を `message_id` の順に読む。AI の発言には、一番新しい `ai_run` の失敗の理由を添える。
export function listMessageRows(
  db: Database,
  conversationId: number,
): MessageRow[] {
  return db
    .prepare(
      `SELECT m.message_id AS message_id,
              m.conversation_id AS conversation_id,
              m.speaker AS speaker,
              m.body_md AS body_md,
              m.sent_at AS sent_at,
              m.reply_state AS reply_state,
              m.reply_to_message_id AS reply_to_message_id,
              r.ai_run_id AS ai_run_id,
              r.failure_reason AS failure_reason
         FROM message AS m
         LEFT JOIN ai_run AS r ON r.ai_run_id = (
           SELECT ai_run_id FROM ai_run
            WHERE reply_message_id = m.message_id
            ORDER BY ai_run_id DESC
            LIMIT 1
         )
        WHERE m.conversation_id = ?
        ORDER BY m.message_id`,
    )
    .all(conversationId)
    .map((row) => ({
      messageId: Number(row.message_id),
      conversationId: Number(row.conversation_id),
      speaker: row.speaker as MessageRow["speaker"],
      bodyMd: row.body_md as string,
      sentAt: row.sent_at as string,
      replyState: (row.reply_state as MessageRow["replyState"]) ?? null,
      replyToMessageId:
        row.reply_to_message_id === null
          ? null
          : Number(row.reply_to_message_id),
      latestFailureReason: (row.failure_reason as string | null) ?? null,
      hasAiRun: row.ai_run_id !== null,
    }));
}
