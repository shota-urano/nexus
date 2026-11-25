import type { Database } from "../../src/server/db/connection";
import {
  MIGRATIONS_DIR,
  applyMigrations,
  readMigrations,
} from "../../src/server/db/migrations";
import { enqueueRelate } from "../../src/server/ai-jobs";
import { createFakeClock } from "../../src/server/shared/clock";

// ニュースの記事と受け取りの記録と AI の実行を DB に入れる作る関数（DD-10 3章）。
// 受け取り（FN-001）を通さず、テストの前提の状態を直接作る。

export const NOW = "2026-12-01T08:00:00.000+09:00";

export function migrate(db: Database): void {
  applyMigrations(db, readMigrations(MIGRATIONS_DIR), createFakeClock(NOW));
}

export function insertDelivery(
  db: Database,
  targetDate: string,
  receivedAt: string,
  itemCount: number,
): number {
  const result = db
    .prepare(
      "INSERT INTO delivery (sender, target_date, received_at, item_count, result) VALUES ('brain-harness', ?, ?, ?, 'accepted')",
    )
    .run(targetDate, receivedAt, itemCount);
  return Number(result.lastInsertRowid);
}

let slugSeed = 0;

export interface ArticleInput {
  title: string;
  theme: string;
  guideMd: string;
  targetDate: string;
  receivedAt: string;
  deliveryId: number;
}

export function insertArticle(db: Database, input: ArticleInput): number {
  const result = db
    .prepare(
      "INSERT INTO content (kind, title, target_date, received_at, delivery_id) VALUES ('news', ?, ?, ?, ?)",
    )
    .run(input.title, input.targetDate, input.receivedAt, input.deliveryId);
  const contentId = Number(result.lastInsertRowid);
  slugSeed += 1;
  db.prepare(
    "INSERT INTO article (content_id, slug, guide_md, source_url, theme) VALUES (?, ?, ?, ?, ?)",
  ).run(
    contentId,
    slugSeed.toString(16).padStart(12, "0"),
    input.guideMd,
    `https://example.com/news/${contentId}`,
    input.theme,
  );
  return contentId;
}

export function insertRelation(
  db: Database,
  from: number,
  to: number,
  relationType = "related_topic",
  isActive = 1,
): void {
  db.prepare(
    "INSERT INTO article_relation (from_content_id, to_content_id, relation_type, reason, judged_at, is_active) VALUES (?, ?, ?, '前の判定の根拠', '2026-11-28T08:00:00.000+09:00', ?)",
  ).run(from, to, relationType, isActive);
}

// D1 のニュース（DD-10 3章）: 2026-12-01 の A1〜A3、2026-11-28 の P1、P2、2026-11-23 の P8。
export interface D1News {
  todayDeliveryId: number;
  A1: number;
  A2: number;
  A3: number;
  P1: number;
  P2: number;
  P8: number;
}

export function insertD1News(db: Database): D1News {
  const p8Delivery = insertDelivery(
    db,
    "2026-11-23",
    "2026-11-23T07:00:00.000+09:00",
    1,
  );
  const P8 = insertArticle(db, {
    title: "8日前の記事 P8",
    theme: "AI",
    guideMd: "P8 の案内",
    targetDate: "2026-11-23",
    receivedAt: "2026-11-23T07:00:00.000+09:00",
    deliveryId: p8Delivery,
  });
  const pDelivery = insertDelivery(
    db,
    "2026-11-28",
    "2026-11-28T07:00:00.000+09:00",
    2,
  );
  const past = (title: string, theme: string) =>
    insertArticle(db, {
      title,
      theme,
      guideMd: `${title} の案内`,
      targetDate: "2026-11-28",
      receivedAt: "2026-11-28T07:00:00.000+09:00",
      deliveryId: pDelivery,
    });
  const P1 = past("3日前の記事 P1", "AI");
  const P2 = past("3日前の記事 P2", "半導体");
  const todayDeliveryId = insertDelivery(
    db,
    "2026-12-01",
    "2026-12-01T07:00:00.000+09:00",
    3,
  );
  const today = (title: string, theme: string) =>
    insertArticle(db, {
      title,
      theme,
      guideMd: `${title} の案内`,
      targetDate: "2026-12-01",
      receivedAt: "2026-12-01T07:00:00.000+09:00",
      deliveryId: todayDeliveryId,
    });
  const A1 = today("今日の記事 A1", "AI");
  const A2 = today("今日の記事 A2", "AI");
  const A3 = today("今日の記事 A3", "半導体");
  return { todayDeliveryId, A1, A2, A3, P1, P2, P8 };
}

// 受け取りの relate を待ちに入れる（`created_at` は今）。
export function queueRelate(db: Database, deliveryId: number): number {
  return enqueueRelate(db, deliveryId, new Date(NOW));
}
