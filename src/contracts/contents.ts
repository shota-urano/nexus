import { z } from "zod";

// 共有の型層 M10（DD-01 1.1、ADR-019）。種類を問わない一覧と検索の応答の形
// （`docs/api/openapi.yaml` の `ContentSummary`、`ContentPage`。DD-04 `listInbox`、
// `searchContents`、`listSaved`）。

const DATE_TIME_PATTERN =
  /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}\+09:00$/;
const DATE_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

// 日本時間で時差付きの日時（`YYYY-MM-DDTHH:MM:SS.sss+09:00`）。
const dateTime = z.string().regex(DATE_TIME_PATTERN);

export const contentSummarySchema = z.object({
  // `openapi.yaml` の `Id`（1 以上の整数）。
  contentId: z.number().int().min(1),
  // 種類を足すときに値が増えるので、値の一覧で絞らない（NFR-004）。
  kind: z.string().min(1),
  title: z.string(),
  targetDate: z.string().regex(DATE_PATTERN),
  receivedAt: dateTime,
  isNew: z.boolean(),
  isRead: z.boolean(),
  isSaved: z.boolean(),
  savedAt: dateTime.nullable().optional(),
});

export const contentPageSchema = z.object({
  items: z.array(contentSummarySchema),
  nextCursor: z.string().nullable(),
});

export type ContentSummary = z.infer<typeof contentSummarySchema>;
export type ContentPage = z.infer<typeof contentPageSchema>;
