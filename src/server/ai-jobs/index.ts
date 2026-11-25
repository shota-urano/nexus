import { type Database, databasePath, openDatabase } from "../db/connection";
import { toDbError } from "../db/errors";
import {
  applyKnownMigrations,
  assertMigrationsApplied,
} from "../db/migrations";
import { inWriteTransaction } from "../db/transaction";
import {
  type AiRunPurpose,
  type AiRunRow,
  type QueueCounts,
  claimNextQueuedRun,
  countQueue,
  insertQueuedAnswerRun,
  insertQueuedRelateRun,
  listRunningRuns,
  markRunDone,
  markRunFailed,
} from "../repositories/ai-run";
import type { Clock } from "../shared/clock";
import { formatDateTime } from "../shared/datetime";

// AI の実行（ENT-009）の待ち行列（DD-01 M20。DD-02 3章 P06、DD-05 3章）。
// 状態を変えるのはこのモジュールだけで、遷移の前の状態を条件にした更新で行う（DD-02 2章 状態の実装）。

export type { AiRunPurpose, QueueCounts } from "../repositories/ai-run";

// 拾った実行。目的ごとに、対象の1つだけを持つ（BD-07 ENT-009）。
export interface PickedRun {
  aiRunId: number;
  purpose: AiRunPurpose;
  attempt: number;
  createdAt: string;
  relateDeliveryId: number | null;
  replyMessageId: number | null;
  summaryConversationId: number | null;
}

export interface AiQueue {
  // 次を拾う（DD-02 3章 P06 手順 2）。拾えなければ null。
  pickNext(): PickedRun | null;
  // 処理中のまま残った実行を全て読む（AI Runner の起動のとき。DD-02 3章 P06 手順 1）。
  listRunning(): PickedRun[];
  // 待ちの数、処理中の数、一番古い待ちの日時（状態を返す API。DD-01 M20、DD-04 `getHealth`）。
  counts(): QueueCounts;
}

function toPicked(row: AiRunRow): PickedRun {
  return {
    aiRunId: row.aiRunId,
    purpose: row.purpose,
    attempt: row.attempt,
    createdAt: row.createdAt,
    relateDeliveryId: row.relateDeliveryId,
    replyMessageId: row.replyMessageId,
    summaryConversationId: row.summaryConversationId,
  };
}

export function createAiQueue(db: Database, clock: Clock): AiQueue {
  return {
    pickNext() {
      // 書き込みの権利を先に取り、選ぶと running にするを1つの文で行う。
      // 同じ実行を2つの枠（または2つの接続）が拾わない（DD-05 3章 ENT-009）。
      const row = inWriteTransaction(db, () =>
        claimNextQueuedRun(db, formatDateTime(clock.now())),
      );
      return row === null ? null : toPicked(row);
    },
    listRunning() {
      return listRunningRuns(db).map(toPicked);
    },
    counts() {
      return countQueue(db);
    },
  };
}

// プロセスの起動のときに DB を開く（DD-03 5章）。
// - `migrate`: Web サーバ。まだ当てていないマイグレーションを全て当ててから返す。
// - `check`: AI Runner。`schema_migration` の最後の番号が知る番号と違えば E17（STARTUP_MISMATCH）を投げる。
// 失敗したら DB を閉じて投げる。使い終わったら close で DB を閉じる。
// 接続はプロセスごとに1つ（DD-01 2.1 M21）なので、ほかの部品は返した `db` を使う。
export interface OpenAiJobsDeps {
  dataDir: string;
  clock: Clock;
  startup: "migrate" | "check";
  // `check` で比べる番号。試験で、番号の違うプロセスの代わりに渡す（DD-10 TC108）。
  knownVersion?: number;
}

export interface OpenedAiJobs {
  db: Database;
  queue: AiQueue;
  close(): void;
}

export function openAiJobs(deps: OpenAiJobsDeps): OpenedAiJobs {
  const db = openDatabase(databasePath(deps.dataDir));
  try {
    if (deps.startup === "migrate") {
      applyKnownMigrations(db, deps.clock);
    } else {
      assertMigrationsApplied(db, deps.knownVersion);
    }
  } catch (error) {
    db.close();
    throw toDbError(error);
  }
  return {
    db,
    queue: createAiQueue(db, deps.clock),
    close: () => db.close(),
  };
}

// 記事の関係の判定を待ちに入れる（`attempt` 1）。呼んだ側のトランザクションの中で呼ぶ。
export function enqueueRelate(
  db: Database,
  deliveryId: number,
  at: Date,
): number {
  return insertQueuedRelateRun(db, deliveryId, 1, formatDateTime(at));
}

// 質問の応答を待ちに入れる（`attempt` 1。DD-02 FN-015 受け付けの手順 3.5）。
// 呼んだ側のトランザクションの中で呼ぶ。作った実行ID を返す。
export function enqueueAnswer(
  db: Database,
  replyMessageId: number,
  at: Date,
): number {
  return insertQueuedAnswerRun(db, replyMessageId, 1, formatDateTime(at));
}

// 記事の関係の判定を自動で送り直す（同じ受け取りの記録で `attempt` 2 を待ちに入れる。DD-02 3章 P06 手順 5）。
// 失敗にするのと同じトランザクションの中で呼ぶ（DD-05 3章）。作った実行ID を返す。
export function requeueRelate(
  db: Database,
  deliveryId: number,
  attempt: number,
  at: Date,
): number {
  return insertQueuedRelateRun(db, deliveryId, attempt, formatDateTime(at));
}

// 質問の応答を自動で送り直す（同じ AI の発言で `attempt` 2 を待ちに入れる。DD-02 3章 P06 手順 5）。
// 失敗にするのと同じトランザクションの中で呼ぶ（DD-05 3章）。作った実行ID を返す。
export function requeueAnswer(
  db: Database,
  replyMessageId: number,
  attempt: number,
  at: Date,
): number {
  return insertQueuedAnswerRun(db, replyMessageId, attempt, formatDateTime(at));
}

// 実行を完了にする（running のときだけ。DD-02 3章 P06 手順 4）。
// 目的ごとの結果を残すのと同じトランザクションの中で呼ぶ。完了にできたかを返す。
export function completeRun(db: Database, aiRunId: number, at: Date): boolean {
  return markRunDone(db, aiRunId, formatDateTime(at)) === 1;
}

// 実行を失敗にする（running のときだけ。DD-02 3章 P06 手順 5）。失敗にできたかを返す。
// `failureReason` は失敗の分類と短い理由で、認証の情報と鍵を入れない（NFR-019）。
export function failRun(
  db: Database,
  aiRunId: number,
  failureReason: string,
  at: Date,
): boolean {
  return markRunFailed(db, aiRunId, failureReason, formatDateTime(at)) === 1;
}
