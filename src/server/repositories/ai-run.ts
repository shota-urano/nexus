import type { Database } from "../db/connection";

// ENT-009 AI の実行（DD-03 `ai_run`）の読み書き（DD-01 M22）。
// 状態の遷移は全て、遷移の前の状態を条件にした更新で行う（DD-02 2章 状態の実装、DD-05 3章）。

export type AiRunPurpose = "answer" | "relate" | "summarize";
export type AiRunState = "queued" | "running" | "done" | "failed" | "cancelled";

export interface AiRunRow {
  aiRunId: number;
  purpose: AiRunPurpose;
  state: AiRunState;
  replyMessageId: number | null;
  summaryConversationId: number | null;
  relateDeliveryId: number | null;
  attempt: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  failureReason: string | null;
}

const COLUMNS =
  "ai_run_id, purpose, state, reply_message_id, summary_conversation_id, relate_delivery_id, attempt, created_at, started_at, finished_at, failure_reason";

function toRow(row: Record<string, unknown>): AiRunRow {
  const nullableNumber = (value: unknown) =>
    value === null || value === undefined ? null : Number(value);
  const nullableString = (value: unknown) =>
    value === null || value === undefined ? null : String(value);
  return {
    aiRunId: Number(row.ai_run_id),
    purpose: String(row.purpose) as AiRunPurpose,
    state: String(row.state) as AiRunState,
    replyMessageId: nullableNumber(row.reply_message_id),
    summaryConversationId: nullableNumber(row.summary_conversation_id),
    relateDeliveryId: nullableNumber(row.relate_delivery_id),
    attempt: Number(row.attempt),
    createdAt: String(row.created_at),
    startedAt: nullableString(row.started_at),
    finishedAt: nullableString(row.finished_at),
    failureReason: nullableString(row.failure_reason),
  };
}

// 記事の関係の判定の実行を待ちに入れる。作った実行ID を返す。
export function insertQueuedRelateRun(
  db: Database,
  relateDeliveryId: number,
  attempt: number,
  createdAt: string,
): number {
  const result = db
    .prepare(
      "INSERT INTO ai_run (purpose, state, relate_delivery_id, attempt, created_at) VALUES ('relate', 'queued', ?, ?, ?)",
    )
    .run(relateDeliveryId, attempt, createdAt);
  return Number(result.lastInsertRowid);
}

// 次の待ちの実行を1つ選び、`state` が queued のときだけ running にする（DD-02 3章 P06 手順 2）。
// 選ぶ順: 目的の順（answer、relate、summarize）、同じ目的なら `created_at` の古い順。
// answer は、同じ会話の answer が running でないものだけを選ぶ。
// 拾えなければ null。書き込みの権利を持つトランザクションの中で呼ぶ（M20）。
export function claimNextQueuedRun(
  db: Database,
  startedAt: string,
): AiRunRow | null {
  const row = db
    .prepare(
      `UPDATE ai_run SET state = 'running', started_at = ?
       WHERE state = 'queued' AND ai_run_id = (
         SELECT r.ai_run_id FROM ai_run AS r
         LEFT JOIN message AS m ON m.message_id = r.reply_message_id
         WHERE r.state = 'queued'
           AND (
             r.purpose <> 'answer'
             OR NOT EXISTS (
               SELECT 1 FROM ai_run AS x
               JOIN message AS xm ON xm.message_id = x.reply_message_id
               WHERE x.purpose = 'answer'
                 AND x.state = 'running'
                 AND xm.conversation_id = m.conversation_id
             )
           )
         ORDER BY
           CASE r.purpose WHEN 'answer' THEN 0 WHEN 'relate' THEN 1 ELSE 2 END,
           r.created_at,
           r.ai_run_id
         LIMIT 1
       )
       RETURNING ${COLUMNS}`,
    )
    .get(startedAt);
  return row === undefined ? null : toRow(row);
}

// running のときだけ done にする。変えた行の数を返す（DD-02 3章 P06 手順 4）。
export function markRunDone(
  db: Database,
  aiRunId: number,
  finishedAt: string,
): number {
  return Number(
    db
      .prepare(
        "UPDATE ai_run SET state = 'done', finished_at = ? WHERE ai_run_id = ? AND state = 'running'",
      )
      .run(finishedAt, aiRunId).changes,
  );
}

// running のときだけ failed にする。変えた行の数を返す（DD-02 3章 P06 手順 5）。
export function markRunFailed(
  db: Database,
  aiRunId: number,
  failureReason: string,
  finishedAt: string,
): number {
  return Number(
    db
      .prepare(
        "UPDATE ai_run SET state = 'failed', failure_reason = ?, finished_at = ? WHERE ai_run_id = ? AND state = 'running'",
      )
      .run(failureReason, finishedAt, aiRunId).changes,
  );
}

export function findAiRun(db: Database, aiRunId: number): AiRunRow | null {
  const row = db
    .prepare(`SELECT ${COLUMNS} FROM ai_run WHERE ai_run_id = ?`)
    .get(aiRunId);
  return row === undefined ? null : toRow(row);
}

export interface QueueCounts {
  queuedCount: number;
  runningCount: number;
  // 一番古い待ちの `created_at`。待ちが無ければ null。
  oldestQueuedAt: string | null;
}

// 待ちの数、処理中の数、一番古い待ちの日時（状態を返す API。DD-04 `getHealth`）。
export function countQueue(db: Database): QueueCounts {
  const row = db
    .prepare(
      `SELECT
         COALESCE(SUM(state = 'queued'), 0) AS queued_count,
         COALESCE(SUM(state = 'running'), 0) AS running_count,
         MIN(CASE WHEN state = 'queued' THEN created_at END) AS oldest_queued_at
       FROM ai_run`,
    )
    .get();
  return {
    queuedCount: Number(row?.queued_count ?? 0),
    runningCount: Number(row?.running_count ?? 0),
    oldestQueuedAt:
      row?.oldest_queued_at === null || row?.oldest_queued_at === undefined
        ? null
        : String(row.oldest_queued_at),
  };
}
