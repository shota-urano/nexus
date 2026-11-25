import { z } from "zod";
import type { Database } from "../../db/connection";
import {
  findNewsContentIdBySlug,
  insertArticleRow,
  updateArticleRow,
} from "../../repositories/news";
import { daysBetween } from "../../shared/datetime";

// ニュースの受け取りの形の確かめと、記事を残す処理（DD-01 M15。DD-02 FN-001 手順 4、6、7.2）。
// 形は `openapi.yaml` の `NewsBatch`、`NewsItem` と BD-06 IF-001 3.2 による（ADR-019 で zod を使う）。
// M14 の種類の一覧を読み込まず、同じ形の操作を公開する（DD-01 M14。輪を作らないため）。

export const NEWS_KIND = "news";

// 上限の値（BD-06 IF-001 3.2）。ここの1か所に置く（DD-01 3章 zod）。
export const NEWS_BATCH_MAX_BYTES = 1024 * 1024;
export const NEWS_BATCH_MAX_ITEMS = 100;
export const NEWS_BODY_MAX_BYTES = 128 * 1024;
export const NEWS_TITLE_MAX_CHARS = 200;
export const NEWS_THEME_MAX_CHARS = 50;
export const NEWS_URL_MAX_CHARS = 2048;
export const NEWS_SOURCE = "brain-collect";

const DATE_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

// 文字の数（UTF-16 の単位でなく、文字で数える）。
const charCount = (text: string) => [...text].length;

// 1行（改行を含まない）で、1文字以上 max 文字まで。
// 復帰（CR）も断る（DD-03 `content.title` の検査制約に合わせる）。
const singleLine = (max: number) =>
  z
    .string()
    .min(1)
    .refine((text) => charCount(text) <= max)
    .refine((text) => !/[\n\r]/.test(text));

const url = z
  .string()
  .max(NEWS_URL_MAX_CHARS)
  .regex(/^https?:\/\//);

// 日付は `YYYY-MM-DD` の実在する日付か `today`。
const targetDate = z.union([
  z.literal("today"),
  z
    .string()
    .regex(DATE_PATTERN)
    .refine((date) => daysBetween(date, date) === 0),
]);

const batchSchema = z.object({
  source: z.literal(NEWS_SOURCE),
  date: targetDate,
  items: z.array(z.unknown()).max(NEWS_BATCH_MAX_ITEMS),
});

const itemSchema = z.object({
  slug: z.string().regex(/^[0-9a-f]{12}$/),
  kind: z.literal("read"),
  title: singleLine(NEWS_TITLE_MAX_CHARS),
  bodyMd: z
    .string()
    .min(1)
    .refine((text) => Buffer.byteLength(text, "utf8") <= NEWS_BODY_MAX_BYTES),
  url,
  imageUrl: url.nullable().optional(),
  theme: singleLine(NEWS_THEME_MAX_CHARS),
});

// 全体の形の確かめの結果（DD-02 FN-001 手順 4）。
// 断るときの `date` は、日付の項目だけを見て正しければその値（`today` のまま）、でなければ null。
export type BatchCheck =
  | { ok: true; date: string; items: unknown[] }
  | { ok: false; msg: "MSG-033"; field: string; date: string | null }
  | { ok: false; msg: "MSG-034"; date: string | null };

// 記事ごとの形の確かめの結果（DD-02 FN-001 手順 6）。
export type ItemCheck =
  | { ok: true; item: AcceptedNewsItem }
  | { ok: false; label: string; field: string };

// 形の正しい記事。見出しと検索の本文と、種類ごとの中身を残す処理を持つ（DD-01 M14）。
export interface AcceptedNewsItem {
  // 同じ対象日で置き換える相手を決める値（slug）。
  key: string;
  title: string;
  // 検索の本文（ニュースは案内。DD-02 3章 P08）。
  searchBody: string;
  insertDetail(db: Database, contentId: number): void;
  updateDetail(db: Database, contentId: number): void;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function firstField(error: z.ZodError, fallback: string): string {
  const head = error.issues[0]?.path[0];
  return typeof head === "string" ? head : fallback;
}

export function checkNewsBatch(payload: unknown): BatchCheck {
  const knownDate = isRecord(payload)
    ? (() => {
        const parsed = targetDate.safeParse(payload.date);
        return parsed.success ? parsed.data : null;
      })()
    : null;
  const parsed = batchSchema.safeParse(payload);
  if (parsed.success) {
    return { ok: true, date: parsed.data.date, items: parsed.data.items };
  }
  const tooMany = parsed.error.issues.find(
    (issue) =>
      issue.path.length === 1 &&
      issue.path[0] === "items" &&
      issue.code === "too_big",
  );
  if (tooMany !== undefined && parsed.error.issues[0] === tooMany) {
    return { ok: false, msg: "MSG-034", date: knownDate };
  }
  return {
    ok: false,
    msg: "MSG-033",
    field: isRecord(payload) ? firstField(parsed.error, "本文") : "本文",
    date: knownDate,
  };
}

export function checkNewsItem(raw: unknown): ItemCheck {
  const label = isRecord(raw) && typeof raw.slug === "string" ? raw.slug : "";
  const parsed = itemSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      label,
      field: isRecord(raw) ? firstField(parsed.error, "items") : "items",
    };
  }
  const { slug, title, bodyMd, url: sourceUrl, imageUrl, theme } = parsed.data;
  const values = {
    guideMd: bodyMd,
    sourceUrl,
    imageUrl: imageUrl ?? null,
    theme,
  };
  return {
    ok: true,
    item: {
      key: slug,
      title,
      searchBody: bodyMd,
      insertDetail: (db, contentId) =>
        insertArticleRow(db, contentId, slug, values),
      updateDetail: (db, contentId) => updateArticleRow(db, contentId, values),
    },
  };
}

// 種類の一覧（M14）に登録する、ニュースの受け取りの操作。
export const newsIngest = {
  kind: NEWS_KIND,
  // 同じ送信の中の重なりを見分ける項目の名前（MSG-033 に差し込む）。
  keyField: "slug",
  // 1件以上残したら、記事の関係の判定を待ちに入れる（DD-02 FN-001 手順 7.4）。
  relatesAfterIngest: true,
  checkBatch: checkNewsBatch,
  checkItem: checkNewsItem,
  // 同じ対象日の同じ slug の内容ID（DD-02 FN-001 手順 7.2）。
  findContentId: (db: Database, date: string, key: string) =>
    findNewsContentIdBySlug(db, date, key),
};
