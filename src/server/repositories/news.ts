import type { Database } from "../db/connection";

// ENT-001 内容と ENT-002 記事（DD-03 `content`、`article`）のうち、ニュースの記事の読み取り（DD-01 M22）。
// ENT-010 受け取りの記録（DD-03 `delivery`）の対象日の読み取りもここに置く。

export interface NewsArticleRow {
  contentId: number;
  title: string;
  theme: string;
  guideMd: string;
  targetDate: string;
  deliveryId: number | null;
  receivedAt: string;
}

// 受け取りの記録の対象日。行が無いか対象日が空なら null。
export function findDeliveryTargetDate(
  db: Database,
  deliveryId: number,
): string | null {
  const row = db
    .prepare("SELECT target_date FROM delivery WHERE delivery_id = ?")
    .get(deliveryId);
  if (row === undefined || row.target_date === null) return null;
  return String(row.target_date);
}

// 対象日が from から to まで（両端を含む）のニュースの記事を、対象日と内容ID の順に読む。
export function listNewsArticlesBetween(
  db: Database,
  fromDate: string,
  toDate: string,
): NewsArticleRow[] {
  return db
    .prepare(
      `SELECT c.content_id, c.title, c.target_date, c.delivery_id, c.received_at, a.theme, a.guide_md
       FROM content AS c JOIN article AS a ON a.content_id = c.content_id
       WHERE c.kind = 'news' AND c.target_date BETWEEN ? AND ?
       ORDER BY c.target_date, c.content_id`,
    )
    .all(fromDate, toDate)
    .map((row) => ({
      contentId: Number(row.content_id),
      title: String(row.title),
      theme: String(row.theme),
      guideMd: String(row.guide_md),
      targetDate: String(row.target_date),
      deliveryId: row.delivery_id === null ? null : Number(row.delivery_id),
      receivedAt: String(row.received_at),
    }));
}

// 受け取りの記録が届けたニュースの記事の内容ID。
export function listNewsContentIdsByDelivery(
  db: Database,
  deliveryId: number,
): number[] {
  return db
    .prepare(
      "SELECT content_id FROM content WHERE delivery_id = ? AND kind = 'news' ORDER BY content_id",
    )
    .all(deliveryId)
    .map((row) => Number(row.content_id));
}
