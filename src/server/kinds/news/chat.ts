import type { Database } from "../../db/connection";
import {
  findChatArticle,
  listChatRelatedArticles,
} from "../../repositories/news";
import { NEWS_KIND } from "./ingest";

// AI チャットに渡す内容の組み立てのうち、ニュースに固有の処理（DD-01 M15。DD-02 3章 P07 手順 3、
// BD-02 FN-015 業務ルール）。記事の見出し、テーマ、案内の全体、元の記事の URL と、
// 有効な関係のある記事の見出しと関係の種類を、読む材料の文にする。
// M14 の種類の一覧を読み込まず、同じ形の操作を公開する（DD-01 M14。輪を作らないため）。

// 対象の内容の読む材料を組み立てる。記事が無ければ null。
export function buildNewsAnswerMaterial(
  db: Database,
  contentId: number,
): string | null {
  const article = findChatArticle(db, contentId);
  if (article === null) return null;
  const related = listChatRelatedArticles(db, contentId);
  const lines = [
    "種類: ニュースの記事",
    `見出し: ${article.title}`,
    `テーマ: ${article.theme}`,
    `元の記事の URL: ${article.sourceUrl}`,
    "案内:",
    article.guideMd,
    "",
    "関係のある記事:",
    ...(related.length === 0
      ? ["（無い）"]
      : related.map(
          (other) =>
            `- ${other.title}（関係の種類: ${other.relationType}。${
              other.direction === "to"
                ? "この記事から見た関係"
                : "相手の記事から見た関係"
            }）`,
        )),
  ];
  return lines.join("\n");
}

export const newsChat = {
  kind: NEWS_KIND,
  buildAnswerMaterial: (db: Database, contentId: number) =>
    buildNewsAnswerMaterial(db, contentId),
};
