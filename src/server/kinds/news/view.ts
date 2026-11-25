import type { Database } from "../../db/connection";
import { inReadTransaction } from "../../db/transaction";
import {
  type RelationType,
  listActiveRelationsTouching,
} from "../../repositories/article-relation";
import {
  type NewsViewRow,
  listNewsTargetDates,
  listNewsViewRowsByDate,
  listNewsViewRowsByIds,
} from "../../repositories/news";
import { NexusError } from "../../shared/errors";

// 記事の図と案内のデータ（DD-01 M15。DD-02 FN-003、FN-004）。読むだけで、データを変えない。
// 図は2つ以上の文で同じ時点の値を読むので、読むためのトランザクション（`BEGIN`）で読む（DD-05 1章）。

// 日付の選択肢の件数（DD-02 FN-003 手順 2.4。`openapi.yaml` の `Galaxy.availableDates` の `maxItems`）。
export const GALAXY_AVAILABLE_DATES_LIMIT = 60;

// `openapi.yaml` の `GalaxyNode`。
export interface GalaxyNode {
  contentId: number;
  title: string;
  theme: string;
  imageUrl: string | null;
  targetDate: string;
  // 開いた日時が空。
  isNew: boolean;
  isRead: boolean;
}

// `openapi.yaml` の `GalaxyLink`。
export interface GalaxyLink {
  fromContentId: number;
  toContentId: number;
  relationType: RelationType;
}

// `openapi.yaml` の `Galaxy`。
export interface Galaxy {
  date: string;
  availableDates: string[];
  themes: string[];
  nodes: GalaxyNode[];
  links: GalaxyLink[];
}

// `openapi.yaml` の `RelatedArticle`。
export interface RelatedArticle {
  node: GalaxyNode;
  relationType: RelationType;
  reason: string;
  // この記事が関係の元なら from。
  direction: "from" | "to";
}

// `openapi.yaml` の `ArticleDetail`。
export interface ArticleDetail {
  contentId: number;
  title: string;
  theme: string;
  guideMd: string;
  sourceUrl: string;
  imageUrl: string | null;
  targetDate: string;
  receivedAt: string;
  state: {
    contentId: number;
    isNew: boolean;
    isRead: boolean;
    isSaved: boolean;
    savedAt: string | null;
  };
  related: RelatedArticle[];
}

export interface NewsView {
  // その日の記事と、有効な関係と、関係の先の記事（FN-003 手順 2〜3）。
  getGalaxy(date: string): Galaxy;
  // 記事の案内と、有効な関係のある記事（FN-004 手順 2〜3）。
  // 内容が無いかニュースでなければ NOT_FOUND（MSG-002）を投げる。
  getArticle(contentId: number): ArticleDetail;
}

function toNode(row: NewsViewRow): GalaxyNode {
  return {
    contentId: row.contentId,
    title: row.title,
    theme: row.theme,
    imageUrl: row.imageUrl,
    targetDate: row.targetDate,
    isNew: row.openedAt === null,
    isRead: row.isRead,
  };
}

export function createNewsView(deps: { db: Database }): NewsView {
  const { db } = deps;

  return {
    getGalaxy(date) {
      return inReadTransaction(db, () => {
        // 1. その日の記事。
        const dayRows = listNewsViewRowsByDate(db, date);
        const dayIds = new Set(dayRows.map((row) => row.contentId));
        // 2. その日の記事のどれかを含む有効な関係。
        const relations = listActiveRelationsTouching(db, [...dayIds]);
        // 3. 関係の先の記事のうち、1 に無いもの。
        const otherIds = new Set<number>();
        for (const relation of relations) {
          for (const id of [relation.fromContentId, relation.toContentId]) {
            if (!dayIds.has(id)) otherIds.add(id);
          }
        }
        const otherRows = listNewsViewRowsByIds(db, [...otherIds]);
        // 4. 日付の選択肢。
        const availableDates = listNewsTargetDates(
          db,
          GALAXY_AVAILABLE_DATES_LIMIT,
        );

        // 線の両端がノードにあるものだけを返す（ニュースでない内容への関係は無いはずだが、図が崩れないように）。
        const nodeIds = new Set([
          ...dayIds,
          ...otherRows.map((row) => row.contentId),
        ]);
        const links = relations
          .filter(
            (relation) =>
              nodeIds.has(relation.fromContentId) &&
              nodeIds.has(relation.toContentId),
          )
          .map((relation) => ({
            fromContentId: relation.fromContentId,
            toContentId: relation.toContentId,
            relationType: relation.relationType,
          }));

        return {
          date,
          availableDates,
          // その日の記事のテーマの重ならない値（記事の順に初めて出た順）。
          themes: [...new Set(dayRows.map((row) => row.theme))],
          nodes: [...dayRows, ...otherRows].map(toNode),
          links,
        };
      });
    },

    getArticle(contentId) {
      return inReadTransaction(db, () => {
        const [row] = listNewsViewRowsByIds(db, [contentId]);
        if (row === undefined) {
          throw new NexusError("NOT_FOUND", "ニュースの記事が無い", {
            msg: "MSG-002",
          });
        }
        const relations = listActiveRelationsTouching(db, [contentId]);
        const partnerIds = relations.map((relation) =>
          relation.fromContentId === contentId
            ? relation.toContentId
            : relation.fromContentId,
        );
        const partners = new Map(
          listNewsViewRowsByIds(db, partnerIds).map((partner) => [
            partner.contentId,
            partner,
          ]),
        );
        const related: RelatedArticle[] = [];
        for (const relation of relations) {
          const isFrom = relation.fromContentId === contentId;
          const partner = partners.get(
            isFrom ? relation.toContentId : relation.fromContentId,
          );
          if (partner === undefined) continue;
          related.push({
            node: toNode(partner),
            relationType: relation.relationType,
            reason: relation.reason,
            direction: isFrom ? "from" : "to",
          });
        }
        return {
          contentId: row.contentId,
          title: row.title,
          theme: row.theme,
          guideMd: row.guideMd,
          sourceUrl: row.sourceUrl,
          imageUrl: row.imageUrl,
          targetDate: row.targetDate,
          receivedAt: row.receivedAt,
          state: {
            contentId: row.contentId,
            isNew: row.openedAt === null,
            isRead: row.isRead,
            isSaved: row.isSaved,
            savedAt: row.savedAt,
          },
          related,
        };
      });
    },
  };
}
