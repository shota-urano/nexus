import type { Database } from "../db/connection";

// ENT-001 内容（DD-03 `content`）の、種類を問わない書き込み（DD-01 M22）。
// 種類ごとの中身（`article` など）は種類ごとの読み書きに置く。

// 内容を作る。作った内容ID を返す。
export function insertContent(
  db: Database,
  input: {
    kind: string;
    title: string;
    targetDate: string;
    receivedAt: string;
    deliveryId: number;
  },
): number {
  const result = db
    .prepare(
      "INSERT INTO content (kind, title, target_date, received_at, delivery_id) VALUES (?, ?, ?, ?, ?)",
    )
    .run(
      input.kind,
      input.title,
      input.targetDate,
      input.receivedAt,
      input.deliveryId,
    );
  return Number(result.lastInsertRowid);
}

// 置き換えのときに、見出し、届いた日時、受け取りの記録ID を新しい値にする。内容ID は変えない
// （BD-02 FN-001 業務ルール）。
export function updateContentOnReplace(
  db: Database,
  contentId: number,
  input: { title: string; receivedAt: string; deliveryId: number },
): void {
  db.prepare(
    "UPDATE content SET title = ?, received_at = ?, delivery_id = ? WHERE content_id = ?",
  ).run(input.title, input.receivedAt, input.deliveryId, contentId);
}
