import type { Database } from "../db/connection";
import type { DeliverySender } from "./delivery";

// ホームの表示（DD-02 FN-020）のための読み取り（DD-01 M22）。読むだけで、データを変えない。
// 日時は DD-03 1章の形の文字なので、文字の大小で比べられる。

export interface HomeCounts {
  newCount: number;
  unreadCount: number;
}

// 新着と未読の数（DD-02 FN-020 手順 2。FN-017 と同じ決め方）。
// 新着: `content_state` が無いか `opened_at` が空。未読: `content_state` が無いか `is_read` が 0。
export function countNewAndUnread(db: Database): HomeCounts {
  const row = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN s.content_id IS NULL OR s.opened_at IS NULL THEN 1 ELSE 0 END), 0) AS new_count,
         COALESCE(SUM(CASE WHEN s.content_id IS NULL OR s.is_read = 0 THEN 1 ELSE 0 END), 0) AS unread_count
       FROM content AS c
       LEFT JOIN content_state AS s ON s.content_id = c.content_id`,
    )
    .get();
  return {
    newCount: Number(row?.new_count ?? 0),
    unreadCount: Number(row?.unread_count ?? 0),
  };
}

export interface HomeLearningRow {
  contentId: number;
  learningTheme: string;
  isCompleted: boolean;
}

// 対象日が一番新しい英語の教材（DD-02 FN-020 手順 3）。完了は `english_answer` があるか。無ければ null。
export function findLatestEnglishForHome(db: Database): HomeLearningRow | null {
  const row = db
    .prepare(
      `SELECT c.content_id, e.learning_theme,
              EXISTS (SELECT 1 FROM english_answer AS a WHERE a.content_id = c.content_id) AS is_completed
         FROM content AS c
         JOIN english_set AS e ON e.content_id = c.content_id
        WHERE c.kind = 'english'
        ORDER BY c.target_date DESC, c.content_id DESC
        LIMIT 1`,
    )
    .get();
  if (row === undefined) return null;
  return {
    contentId: Number(row.content_id),
    learningTheme: String(row.learning_theme),
    isCompleted: Number(row.is_completed) === 1,
  };
}

// 応答の状態が作成中の AI の発言の数（DD-02 FN-020 手順 4）。
export function countWritingReplies(db: Database): number {
  const row = db
    .prepare(
      "SELECT COUNT(*) AS n FROM message WHERE speaker = 'ai' AND reply_state = 'writing'",
    )
    .get();
  return Number(row?.n ?? 0);
}

// 終わった日時が `since` 以後で失敗のまま終わった AI の実行があるか（DD-02 FN-020 手順 5。Q-078 の答え）。
// 同じ求め（同じ `reply_message_id`、または同じ `relate_delivery_id`）の後の実行（`attempt` 2）が
// done のものは数えない。目的は問わない（summarize の失敗も数える）。
export function hasRecentUnrecoveredFailure(
  db: Database,
  since: string,
): boolean {
  const row = db
    .prepare(
      `SELECT EXISTS (
         SELECT 1 FROM ai_run AS f
          WHERE f.state = 'failed'
            AND f.finished_at >= ?
            AND NOT EXISTS (
              SELECT 1 FROM ai_run AS n
               WHERE n.attempt = 2
                 AND n.state = 'done'
                 AND n.ai_run_id > f.ai_run_id
                 AND (
                   (f.reply_message_id IS NOT NULL AND n.reply_message_id = f.reply_message_id)
                   OR (f.relate_delivery_id IS NOT NULL AND n.relate_delivery_id = f.relate_delivery_id)
                 )
            )
       ) AS has_failure`,
    )
    .get(since);
  return Number(row?.has_failure ?? 0) === 1;
}

export interface HomePickRow {
  contentId: number;
  title: string;
  theme: string;
  imageUrl: string | null;
}

// 対象日が `date` の記事を、有効な記事の関係の数（どちらの向きも数える）の多い順、同じ数なら
// 届いた日時の古い順に `limit` 件（DD-02 FN-020 手順 6。RD-03 R21、Q-037 の答え）。
export function listHomePicks(
  db: Database,
  date: string,
  limit: number,
): HomePickRow[] {
  return db
    .prepare(
      `SELECT c.content_id, c.title, a.theme, a.image_url,
              (SELECT COUNT(*) FROM article_relation AS r
                WHERE r.is_active = 1
                  AND (r.from_content_id = c.content_id OR r.to_content_id = c.content_id)) AS relation_count
         FROM content AS c
         JOIN article AS a ON a.content_id = c.content_id
        WHERE c.kind = 'news' AND c.target_date = ?
        ORDER BY relation_count DESC, c.received_at ASC, c.content_id ASC
        LIMIT ?`,
    )
    .all(date, limit)
    .map((row) => ({
      contentId: Number(row.content_id),
      title: String(row.title),
      theme: String(row.theme),
      imageUrl: row.image_url === null ? null : String(row.image_url),
    }));
}

// 対象日が `date` で結果が accepted の受け取りの記録がある配信元（DD-02 FN-020 手順 7。BD-11 M01）。
export function listAcceptedSendersOn(
  db: Database,
  date: string,
): Set<DeliverySender> {
  return new Set(
    db
      .prepare(
        "SELECT DISTINCT sender FROM delivery WHERE target_date = ? AND result = 'accepted'",
      )
      .all(date)
      .map((row) => String(row.sender) as DeliverySender),
  );
}
