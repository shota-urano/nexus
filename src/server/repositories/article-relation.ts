import type { Database } from "../db/connection";

// ENT-004 記事の関係（DD-03 `article_relation`）の読み書き（DD-01 M22）。

export type RelationType =
  "follow_up" | "background" | "same_actor" | "related_topic";

export interface ArticleRelationRow {
  fromContentId: number;
  toContentId: number;
  relationType: RelationType;
  reason: string;
  judgedAt: string;
  isActive: boolean;
}

function toRow(row: Record<string, unknown>): ArticleRelationRow {
  return {
    fromContentId: Number(row.from_content_id),
    toContentId: Number(row.to_content_id),
    relationType: String(row.relation_type) as RelationType,
    reason: String(row.reason),
    judgedAt: String(row.judged_at),
    isActive: Number(row.is_active) === 1,
  };
}

// 向きを問わず、同じ2つの記事の行を消す（`article_relation_pair_uq` の組）。
export function deleteRelationPair(db: Database, a: number, b: number): number {
  return Number(
    db
      .prepare(
        "DELETE FROM article_relation WHERE (from_content_id = ? AND to_content_id = ?) OR (from_content_id = ? AND to_content_id = ?)",
      )
      .run(a, b, b, a).changes,
  );
}

// 有効な関係を作る（`is_active` 1）。
export function insertActiveRelation(
  db: Database,
  relation: {
    fromContentId: number;
    toContentId: number;
    relationType: RelationType;
    reason: string;
    judgedAt: string;
  },
): void {
  db.prepare(
    "INSERT INTO article_relation (from_content_id, to_content_id, relation_type, reason, judged_at, is_active) VALUES (?, ?, ?, ?, ?, 1)",
  ).run(
    relation.fromContentId,
    relation.toContentId,
    relation.relationType,
    relation.reason,
    relation.judgedAt,
  );
}

// 内容ID のどれかを関係の元か関係の先に含む、有効な関係を読む。
export function listActiveRelationsTouching(
  db: Database,
  contentIds: readonly number[],
): ArticleRelationRow[] {
  if (contentIds.length === 0) return [];
  const ids = JSON.stringify(contentIds);
  return db
    .prepare(
      `SELECT from_content_id, to_content_id, relation_type, reason, judged_at, is_active
       FROM article_relation
       WHERE is_active = 1
         AND (
           from_content_id IN (SELECT value FROM json_each(?))
           OR to_content_id IN (SELECT value FROM json_each(?))
         )
       ORDER BY from_content_id, to_content_id`,
    )
    .all(ids, ids)
    .map(toRow);
}

// 関係を無効にする（消さない。Q-038 の答え）。変えた行の数を返す。
export function deactivateRelation(
  db: Database,
  fromContentId: number,
  toContentId: number,
): number {
  return Number(
    db
      .prepare(
        "UPDATE article_relation SET is_active = 0 WHERE from_content_id = ? AND to_content_id = ? AND is_active = 1",
      )
      .run(fromContentId, toContentId).changes,
  );
}

export function listRelations(db: Database): ArticleRelationRow[] {
  return db
    .prepare(
      "SELECT from_content_id, to_content_id, relation_type, reason, judged_at, is_active FROM article_relation ORDER BY from_content_id, to_content_id",
    )
    .all()
    .map(toRow);
}
