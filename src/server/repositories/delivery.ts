import type { Database } from "../db/connection";

// ENT-010 受け取りの記録（DD-03 `delivery`）の書き込み（DD-01 M22）。

export type DeliverySender = "brain-harness" | "sharpen";

// 受け取った記録を作る（DD-02 FN-001 手順 7.1）。作った受け取りの記録ID を返す。
export function insertAcceptedDelivery(
  db: Database,
  input: {
    sender: DeliverySender;
    targetDate: string;
    receivedAt: string;
    itemCount: number;
  },
): number {
  const result = db
    .prepare(
      "INSERT INTO delivery (sender, target_date, received_at, item_count, result) VALUES (?, ?, ?, ?, 'accepted')",
    )
    .run(input.sender, input.targetDate, input.receivedAt, input.itemCount);
  return Number(result.lastInsertRowid);
}

// 断った記録を作る（DD-02 FN-001「結果とメッセージ」）。件数は 0、対象日は分からなければ null。
export function insertRejectedDelivery(
  db: Database,
  input: {
    sender: DeliverySender;
    targetDate: string | null;
    receivedAt: string;
    rejectionReason: string;
  },
): number {
  const result = db
    .prepare(
      "INSERT INTO delivery (sender, target_date, received_at, item_count, result, rejection_reason) VALUES (?, ?, ?, 0, 'rejected', ?)",
    )
    .run(
      input.sender,
      input.targetDate,
      input.receivedAt,
      input.rejectionReason,
    );
  return Number(result.lastInsertRowid);
}

// 受け取った日時が境より前で、残った AI の実行の判定する受け取りから指されていない記録を消す。
// 消した行の数を返す（DD-02 FN-022 手順 3.3。BAT-002。DD-03 2.3）。
export function deleteUnreferencedDeliveriesReceivedBefore(
  db: Database,
  before: string,
): number {
  return Number(
    db
      .prepare(
        "DELETE FROM delivery WHERE received_at < ? AND NOT EXISTS (SELECT 1 FROM ai_run WHERE ai_run.relate_delivery_id = delivery.delivery_id)",
      )
      .run(before).changes,
  );
}
