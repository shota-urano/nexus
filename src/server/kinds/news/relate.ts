import type { Database } from "../../db/connection";
import {
  type RelationType,
  deactivateRelation,
  deleteRelationPair,
  insertActiveRelation,
  listActiveRelationsTouching,
} from "../../repositories/article-relation";
import {
  findDeliveryTargetDate,
  listContentIdsReceivedAfter,
  listNewsArticlesBetween,
} from "../../repositories/news";
import { addDays } from "../../shared/datetime";
import { NexusError } from "../../shared/errors";
import type { Logger } from "../../shared/logger";

// 記事の関係の判定（FN-002）のうち、ニュースに固有の処理（DD-01 M15）。
// 判定に渡す記事の選び方（DD-02 FN-002 手順 2、3）と、返った関係の確かめ方と残し方（手順 6、7）。

// 照らす記事の範囲（対象日の7日前から。RD-03 R02）。
export const RELATE_LOOKBACK_DAYS = 7;
// 記事ごとに渡す案内の先頭の文字数（Q-086 の答え）。
export const RELATE_GUIDE_CHARS = 600;
// 渡す記事の文字数の合計の上限（Q-086 の答え）。
export const RELATE_TOTAL_CHARS = 200_000;

export const RELATION_TYPES: readonly RelationType[] = [
  "follow_up",
  "background",
  "same_actor",
  "related_topic",
];

export interface RelateArticle {
  contentId: number;
  title: string;
  theme: string;
  // 案内の先頭 600 文字。
  guide: string;
  targetDate: string;
}

export interface RelateSelection {
  targetDate: string;
  // 今回の記事（判定する受け取りの記録が届けた記事）。
  current: RelateArticle[];
  // 照らす記事（対象日の7日前から対象日までの、今回の記事でない記事）。
  others: RelateArticle[];
  // 文字数の上限のために外した照らす記事の日（古い順）。
  droppedDates: string[];
}

// 文字数は、UTF-16 の単位でなく文字（コードポイント）で数える。
function chars(text: string): number {
  let count = 0;
  for (const _ of text) count += 1;
  return count;
}

function head(text: string, limit: number): string {
  let result = "";
  let count = 0;
  for (const ch of text) {
    if (count >= limit) break;
    result += ch;
    count += 1;
  }
  return result;
}

// 1件の記事の文字数（内容ID、見出し、テーマ、案内の先頭。DD-02 FN-002 手順 3 で並べる4項目）。
// 内容ID は10進の文字列の文字数で数える。
export function relateArticleChars(article: RelateArticle): number {
  return (
    chars(String(article.contentId)) +
    chars(article.title) +
    chars(article.theme) +
    chars(article.guide)
  );
}

// 判定に渡す記事を選ぶ（DD-02 FN-002 手順 1〜3）。
export function selectRelateArticles(
  db: Database,
  deliveryId: number,
  logger: Logger,
  ids: { aiRunId?: number } = {},
): RelateSelection {
  const targetDate = findDeliveryTargetDate(db, deliveryId);
  if (targetDate === null) {
    throw new NexusError("INTERNAL", "判定する受け取りの記録が無い");
  }
  const rows = listNewsArticlesBetween(
    db,
    addDays(targetDate, -RELATE_LOOKBACK_DAYS),
    targetDate,
  );
  const toArticle = (row: (typeof rows)[number]): RelateArticle => ({
    contentId: row.contentId,
    title: row.title,
    theme: row.theme,
    guide: head(row.guideMd, RELATE_GUIDE_CHARS),
    targetDate: row.targetDate,
  });
  const current = rows
    .filter((row) => row.deliveryId === deliveryId)
    .map(toArticle);
  let others = rows
    .filter((row) => row.deliveryId !== deliveryId)
    .map(toArticle);

  const total = (list: RelateArticle[]) =>
    list.reduce((sum, article) => sum + relateArticleChars(article), 0);
  const currentChars = total(current);
  let othersChars = total(others);
  const droppedDates: string[] = [];
  // 合計が上限を超える間、照らす記事を古い日から1日分ずつ外す。
  // 今回の記事だけで超えるときは、照らす記事を全て外す（手順 3）。
  while (others.length > 0 && currentChars + othersChars > RELATE_TOTAL_CHARS) {
    const oldest = others.reduce(
      (min, article) => (article.targetDate < min ? article.targetDate : min),
      others[0].targetDate,
    );
    others = others.filter((article) => article.targetDate !== oldest);
    othersChars = total(others);
    droppedDates.push(oldest);
  }
  if (droppedDates.length > 0) {
    logger.log({
      level: "info",
      target: "FN-002",
      deliveryId,
      aiRunId: ids.aiRunId,
      detail: `渡す量の上限のため、照らす記事から外した日: ${droppedDates.join("、")}`,
    });
  }
  return { targetDate, current, others, droppedDates };
}

// AI が返した1つの組（DD-02 FN-002 手順 5 の形）。
export interface ReturnedRelation {
  from: number;
  to: number;
  type: string;
  reason: string;
}

export interface CheckedRelation {
  fromContentId: number;
  toContentId: number;
  relationType: RelationType;
  reason: string;
}

// 返った組を確かめる（DD-02 FN-002 手順 6）。
// 渡していない内容ID を含む組、`from` と `to` が同じ組、どちらも今回の記事でない組は捨てる。
// `type` が4つの値でなければ related_topic にし、`reason` の先頭に AI の言葉を残す（BD-07 4.2）。
export function checkRelations(
  selection: RelateSelection,
  relations: readonly ReturnedRelation[],
): CheckedRelation[] {
  const currentIds = new Set(selection.current.map((a) => a.contentId));
  const passedIds = new Set([
    ...currentIds,
    ...selection.others.map((a) => a.contentId),
  ]);
  const checked: CheckedRelation[] = [];
  for (const relation of relations) {
    const { from, to } = relation;
    if (!passedIds.has(from) || !passedIds.has(to)) continue;
    if (from === to) continue;
    if (!currentIds.has(from) && !currentIds.has(to)) continue;
    const known = (RELATION_TYPES as readonly string[]).includes(relation.type);
    checked.push({
      fromContentId: from,
      toContentId: to,
      relationType: known ? (relation.type as RelationType) : "related_topic",
      reason: known
        ? relation.reason
        : `（AI の言葉: ${relation.type}）${relation.reason}`,
    });
  }
  return checked;
}

const pairKey = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);

// 確かめた組を残す（DD-02 FN-002 手順 7.1〜7.3）。呼んだ側の書き込みのトランザクションの中で呼ぶ。
// `runCreatedAt` は判定の実行の `ai_run.created_at`。これより後に届いた記事は置き換えられた記事として扱う。
export function saveRelations(
  db: Database,
  selection: RelateSelection,
  relations: readonly CheckedRelation[],
  judgedAt: string,
  runCreatedAt: string,
): void {
  const currentIds = new Set(selection.current.map((a) => a.contentId));
  const passedIds = new Set([
    ...currentIds,
    ...selection.others.map((a) => a.contentId),
  ]);

  // 7.1 組の2つの記事のどちらかが、実行を待ちに入れた後に置き換えられていたら、その組は残さない。
  // 置き換えの有無は、書き込みの権利を取った後のこのトランザクションの中で読む（DD-05 3章 ENT-004）。
  const replaced = new Set(
    listContentIdsReceivedAfter(db, [...passedIds], runCreatedAt),
  );
  const touchesReplaced = (a: number, b: number) =>
    replaced.has(a) || replaced.has(b);

  // 7.2 残す組ごとに、向きを問わず同じ2つの記事の行を消し、返った向きで作る。
  // 同じ2つの記事の組が2回返ったら、後の組が残る。
  const kept = new Set<string>();
  for (const relation of relations) {
    if (touchesReplaced(relation.fromContentId, relation.toContentId)) continue;
    deleteRelationPair(db, relation.fromContentId, relation.toContentId);
    insertActiveRelation(db, { ...relation, judgedAt });
    kept.add(pairKey(relation.fromContentId, relation.toContentId));
  }

  // 7.3 今回照らした組（今回の記事のどれかを含み、相手が渡した記事である組）のうち、
  // 残さなかった有効な行を無効にする（消さない。Q-038 の答え）。置き換えられた記事を含む組は変えない。
  for (const row of listActiveRelationsTouching(db, [...currentIds])) {
    const { fromContentId: from, toContentId: to } = row;
    if (!passedIds.has(from) || !passedIds.has(to)) continue;
    if (touchesReplaced(from, to)) continue;
    if (kept.has(pairKey(from, to))) continue;
    deactivateRelation(db, from, to);
  }
}
