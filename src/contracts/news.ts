import { z } from "zod";

// 共有の型層 M10（DD-01 1.1、ADR-019）。ニュースの図と案内と内容の状態の応答の形
// （`docs/api/openapi.yaml` の `Galaxy`、`GalaxyNode`、`GalaxyLink`、`ArticleDetail`、
// `RelatedArticle`、`ContentState`。DD-04 `getGalaxy`、`getArticle`、`markOpened`、`setRead`、
// `setSaved`）。

const DATE_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const DATE_TIME_PATTERN =
  /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}\+09:00$/;
const URL_PATTERN = /^https?:\/\//;

const id = z.number().int().min(1);
const date = z.string().regex(DATE_PATTERN);
const dateTime = z.string().regex(DATE_TIME_PATTERN);
const url = z.string().regex(URL_PATTERN).max(2048);

export const relationTypeSchema = z.enum([
  "follow_up",
  "background",
  "same_actor",
  "related_topic",
]);

export const galaxyNodeSchema = z.object({
  contentId: id,
  title: z.string(),
  theme: z.string(),
  imageUrl: url.nullable(),
  targetDate: date,
  isNew: z.boolean(),
  isRead: z.boolean(),
});

export const galaxyLinkSchema = z.object({
  fromContentId: id,
  toContentId: id,
  relationType: relationTypeSchema,
});

export const galaxySchema = z.object({
  date,
  availableDates: z.array(date).max(60),
  themes: z.array(z.string()),
  nodes: z.array(galaxyNodeSchema),
  links: z.array(galaxyLinkSchema),
});

export const contentStateSchema = z.object({
  contentId: id,
  isNew: z.boolean(),
  isRead: z.boolean(),
  isSaved: z.boolean(),
  savedAt: dateTime.nullable().optional(),
});

export const relatedArticleSchema = z.object({
  node: galaxyNodeSchema,
  relationType: relationTypeSchema,
  reason: z.string(),
  direction: z.enum(["from", "to"]),
});

export const articleDetailSchema = z.object({
  contentId: id,
  title: z.string(),
  theme: z.string(),
  guideMd: z.string(),
  sourceUrl: url,
  imageUrl: url.nullable(),
  targetDate: date,
  receivedAt: dateTime,
  state: contentStateSchema,
  related: z.array(relatedArticleSchema),
});

export type RelationType = z.infer<typeof relationTypeSchema>;
export type GalaxyNode = z.infer<typeof galaxyNodeSchema>;
export type GalaxyLink = z.infer<typeof galaxyLinkSchema>;
export type Galaxy = z.infer<typeof galaxySchema>;
export type ContentState = z.infer<typeof contentStateSchema>;
export type RelatedArticle = z.infer<typeof relatedArticleSchema>;
export type ArticleDetail = z.infer<typeof articleDetailSchema>;
