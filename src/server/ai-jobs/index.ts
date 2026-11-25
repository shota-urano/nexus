import type { Database } from "../db/connection";
import { inWriteTransaction } from "../db/transaction";
import {
  type AiRunPurpose,
  claimNextQueuedRun,
  insertQueuedRelateRun,
  markRunDone,
  markRunFailed,
} from "../repositories/ai-run";
import type { Clock } from "../shared/clock";
import { formatDateTime } from "../shared/datetime";

// AI の実行（ENT-009）の待ち行列（DD-01 M20。DD-02 3章 P06、DD-05 3章）。
// 状態を変えるのはこのモジュールだけで、遷移の前の状態を条件にした更新で行う（DD-02 2章 状態の実装）。

export type { AiRunPurpose } from "../repositories/ai-run";

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
}

export function createAiQueue(db: Database, clock: Clock): AiQueue {
  return {
    pickNext() {
      // 書き込みの権利を先に取り、選ぶと running にするを1つの文で行う。
      // 同じ実行を2つの枠（または2つの接続）が拾わない（DD-05 3章 ENT-009）。
      const row = inWriteTransaction(db, () =>
        claimNextQueuedRun(db, formatDateTime(clock.now())),
      );
      if (row === null) return null;
      return {
        aiRunId: row.aiRunId,
        purpose: row.purpose,
        attempt: row.attempt,
        createdAt: row.createdAt,
        relateDeliveryId: row.relateDeliveryId,
        replyMessageId: row.replyMessageId,
        summaryConversationId: row.summaryConversationId,
      };
    },
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
