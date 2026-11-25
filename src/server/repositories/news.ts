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

// 渡した内容ID のうち、`received_at` が `since` より後の内容ID（置き換えられた記事。DD-02 FN-002 手順 7.1）。
// 日時は DD-03 1章の形の文字なので、文字の大小で比べられる。
export function listContentIdsReceivedAfter(
  db: Database,
  contentIds: readonly number[],
  since: string,
): number[] {
  if (contentIds.length === 0) return [];
  const placeholders = contentIds.map(() => "?").join(", ");
  return db
    .prepare(
      `SELECT content_id FROM content WHERE content_id IN (${placeholders}) AND received_at > ? ORDER BY content_id`,
    )
    .all(...contentIds, since)
    .map((row) => Number(row.content_id));
}

// 置き換えに使う、記事ごとの値（DD-02 FN-001 手順 7.2）。
export interface ArticleValues {
  guideMd: string;
  sourceUrl: string;
  imageUrl: string | null;
  theme: string;
}

// 対象日と slug でニュースの記事の内容ID を探す（DD-02 FN-001 手順 7.2）。無ければ null。
export function findNewsContentIdBySlug(
  db: Database,
  targetDate: string,
  slug: string,
): number | null {
  const row = db
    .prepare(
      `SELECT c.content_id FROM content AS c JOIN article AS a ON a.content_id = c.content_id
       WHERE c.kind = 'news' AND c.target_date = ? AND a.slug = ?
       ORDER BY c.content_id LIMIT 1`,
    )
    .get(targetDate, slug);
  return row === undefined ? null : Number(row.content_id);
}

// 記事を作る（内容を作った後に呼ぶ）。
export function insertArticleRow(
  db: Database,
  contentId: number,
  slug: string,
  values: ArticleValues,
): void {
  db.prepare(
    "INSERT INTO article (content_id, slug, guide_md, source_url, image_url, theme) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(
    contentId,
    slug,
    values.guideMd,
    values.sourceUrl,
    values.imageUrl,
    values.theme,
  );
}

// 記事の案内、元の記事の URL、画像の URL、テーマを新しい値にする（BD-02 FN-001 業務ルール）。
export function updateArticleRow(
  db: Database,
  contentId: number,
  values: ArticleValues,
): void {
  db.prepare(
    "UPDATE article SET guide_md = ?, source_url = ?, image_url = ?, theme = ? WHERE content_id = ?",
  ).run(
    values.guideMd,
    values.sourceUrl,
    values.imageUrl,
    values.theme,
    contentId,
  );
}
