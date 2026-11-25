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
  // その発言の一番新しい `ai_run` の ID。無ければ null。
  latestAiRunId: number | null;
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

const MESSAGE_ROW_SELECT = `SELECT m.message_id AS message_id,
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
         )`;

function toMessageRow(row: Record<string, unknown>): MessageRow {
  return {
    messageId: Number(row.message_id),
    conversationId: Number(row.conversation_id),
    speaker: row.speaker as MessageRow["speaker"],
    bodyMd: row.body_md as string,
    sentAt: row.sent_at as string,
    replyState: (row.reply_state as MessageRow["replyState"]) ?? null,
    replyToMessageId:
      row.reply_to_message_id === null ? null : Number(row.reply_to_message_id),
    latestFailureReason: (row.failure_reason as string | null) ?? null,
    hasAiRun: row.ai_run_id !== null,
    latestAiRunId: row.ai_run_id === null ? null : Number(row.ai_run_id),
  };
}

// 会話の発言を `message_id` の順に読む。AI の発言には、一番新しい `ai_run` の失敗の理由を添える。
export function listMessageRows(
  db: Database,
  conversationId: number,
): MessageRow[] {
  return db
    .prepare(
      `${MESSAGE_ROW_SELECT}
        WHERE m.conversation_id = ?
        ORDER BY m.message_id`,
    )
    .all(conversationId)
    .map(toMessageRow);
}

// 発言を1つ、一番新しい `ai_run` の ID と失敗の理由を添えて読む（応答の続きを流す。DD-02 FN-015）。
// 無ければ null。
export function findMessageRow(
  db: Database,
  messageId: number,
): MessageRow | null {
  const row = db
    .prepare(`${MESSAGE_ROW_SELECT} WHERE m.message_id = ?`)
    .get(messageId);
  return row === undefined ? null : toMessageRow(row);
}

// ---- 質問の受け付け（DD-02 FN-015 受け付けの手順 3）と応答（応答の手順 2〜5）----

export interface ReplyMessageRow {
  messageId: number;
  conversationId: number;
  speaker: "owner" | "ai";
  bodyMd: string;
  sentAt: string;
  replyState: "writing" | "done" | "failed" | "cancelled" | null;
  replyToMessageId: number | null;
}

const MESSAGE_COLUMNS =
  "message_id, conversation_id, speaker, body_md, sent_at, reply_state, reply_to_message_id";

function toReplyMessageRow(row: Record<string, unknown>): ReplyMessageRow {
  return {
    messageId: Number(row.message_id),
    conversationId: Number(row.conversation_id),
    speaker: row.speaker as ReplyMessageRow["speaker"],
    bodyMd: row.body_md as string,
    sentAt: row.sent_at as string,
    replyState: (row.reply_state as ReplyMessageRow["replyState"]) ?? null,
    replyToMessageId:
      row.reply_to_message_id === null ? null : Number(row.reply_to_message_id),
  };
}

export function findMessage(
  db: Database,
  messageId: number,
): ReplyMessageRow | null {
  const row = db
    .prepare(`SELECT ${MESSAGE_COLUMNS} FROM message WHERE message_id = ?`)
    .get(messageId);
  return row === undefined ? null : toReplyMessageRow(row);
}

// 同じ会話の、応答の状態が作成中の AI の発言（一番新しいもの）。無ければ null。
export function findWritingReply(
  db: Database,
  conversationId: number,
): ReplyMessageRow | null {
  const row = db
    .prepare(
      `SELECT ${MESSAGE_COLUMNS} FROM message
        WHERE conversation_id = ? AND speaker = 'ai' AND reply_state = 'writing'
        ORDER BY message_id DESC LIMIT 1`,
    )
    .get(conversationId);
  return row === undefined ? null : toReplyMessageRow(row);
}

// 本人の発言を作る。作った発言ID を返す。
export function insertOwnerMessage(
  db: Database,
  conversationId: number,
  bodyMd: string,
  sentAt: string,
): number {
  const result = db
    .prepare(
      "INSERT INTO message (conversation_id, speaker, body_md, sent_at) VALUES (?, 'owner', ?, ?)",
    )
    .run(conversationId, bodyMd, sentAt);
  return Number(result.lastInsertRowid);
}

// 作成中の AI の発言（本文は空）を作る。作った発言ID を返す。
export function insertWritingReply(
  db: Database,
  conversationId: number,
  replyToMessageId: number,
  sentAt: string,
): number {
  const result = db
    .prepare(
      "INSERT INTO message (conversation_id, speaker, body_md, sent_at, reply_state, reply_to_message_id) VALUES (?, 'ai', '', ?, 'writing', ?)",
    )
    .run(conversationId, sentAt, replyToMessageId);
  return Number(result.lastInsertRowid);
}

// 会話の最後に話した日時を変える。
export function updateLastSpokenAt(
  db: Database,
  conversationId: number,
  at: string,
): void {
  db.prepare(
    "UPDATE conversation SET last_spoken_at = ? WHERE conversation_id = ?",
  ).run(at, conversationId);
}

// 質問の応答に要る会話の値（DD-02 3章 P07 手順 3）。
export interface AnswerConversationRow {
  conversationId: number;
  targetContentId: number | null;
  targetKind: string | null;
  questionTargetJson: string | null;
  summaryMd: string | null;
  summaryLastMessageId: number | null;
}

export function findAnswerConversation(
  db: Database,
  conversationId: number,
): AnswerConversationRow | null {
  const row = db
    .prepare(
      `SELECT v.conversation_id, v.target_content_id, c.kind, v.question_target_json,
              v.summary_md, v.summary_last_message_id
         FROM conversation AS v
         LEFT JOIN content AS c ON c.content_id = v.target_content_id
        WHERE v.conversation_id = ?`,
    )
    .get(conversationId);
  if (row === undefined) return null;
  return {
    conversationId: Number(row.conversation_id),
    targetContentId:
      row.target_content_id === null ? null : Number(row.target_content_id),
    targetKind: (row.kind as string | null) ?? null,
    questionTargetJson: (row.question_target_json as string | null) ?? null,
    summaryMd: (row.summary_md as string | null) ?? null,
    summaryLastMessageId:
      row.summary_last_message_id === null
        ? null
        : Number(row.summary_last_message_id),
  };
}

// 会話の発言のうち、発言ID が `afterId` より大きく `beforeId` より小さいものを、新しい順に読む。
// `afterId` が null なら最初から。
export function listMessagesBetweenNewestFirst(
  db: Database,
  conversationId: number,
  afterId: number | null,
  beforeId: number,
): ReplyMessageRow[] {
  return db
    .prepare(
      `SELECT ${MESSAGE_COLUMNS} FROM message
        WHERE conversation_id = ? AND message_id > ? AND message_id < ?
        ORDER BY message_id DESC`,
    )
    .all(conversationId, afterId ?? 0, beforeId)
    .map(toReplyMessageRow);
}

// AI に渡した内容の写しを入れる（BD-07 ENT-008。送り直しで置き換える）。
export function setAiInputCopy(
  db: Database,
  messageId: number,
  aiInputCopy: string,
): void {
  db.prepare("UPDATE message SET ai_input_copy = ? WHERE message_id = ?").run(
    aiInputCopy,
    messageId,
  );
}

// 本文の末尾に書き足す（`reply_state` が writing の行だけ。DD-05）。変えた行の数を返す。
export function appendReplyBody(
  db: Database,
  messageId: number,
  text: string,
): number {
  return Number(
    db
      .prepare(
        "UPDATE message SET body_md = body_md || ? WHERE message_id = ? AND reply_state = 'writing'",
      )
      .run(text, messageId).changes,
  );
}

// 応答を完了にする（`reply_state` が writing の行だけ）。変えた行の数を返す。
export function markReplyDone(db: Database, messageId: number): number {
  return Number(
    db
      .prepare(
        "UPDATE message SET reply_state = 'done' WHERE message_id = ? AND reply_state = 'writing'",
      )
      .run(messageId).changes,
  );
}

// 応答を失敗にする（`reply_state` が writing の行だけ。DD-02 3章 P06 手順 5）。変えた行の数を返す。
export function markReplyFailed(db: Database, messageId: number): number {
  return Number(
    db
      .prepare(
        "UPDATE message SET reply_state = 'failed' WHERE message_id = ? AND reply_state = 'writing'",
      )
      .run(messageId).changes,
  );
}

// 自動の送り直しのために本文を空に戻す（`reply_state` が writing の行だけ。writing のままにする。
// DD-02 3章 P06 手順 5）。変えた行の数を返す。
export function resetWritingReplyBody(db: Database, messageId: number): number {
  return Number(
    db
      .prepare(
        "UPDATE message SET body_md = '' WHERE message_id = ? AND reply_state = 'writing'",
      )
      .run(messageId).changes,
  );
}
