import type { z } from "zod";
import {
  type ArticleDetail,
  type ContentState,
  type Galaxy,
  articleDetailSchema,
  contentStateSchema,
  galaxySchema,
} from "../contracts/news";
import { deviceFetch } from "./device-api";

// 通信層 M09（DD-01 1.1）。ニュースの図と案内（DD-04 `getGalaxy`、`getArticle`）と、
// 内容の状態を変える端末の API（`markOpened`、`setRead`、`setSaved`）を呼び、応答を M10 の形で
// 確かめる。結果は次のどれかで返す。
// - ok: 応答の形が正しい
// - unauthorized: 401（MSG-020）。全面の知らせは M01 の枠が出す（deviceFetch が届け先に渡す）
// - notFound: 404（`getArticle` の MSG-002。DD-06 E05）
// - failed: それ以外の失敗（つながらない、200 でない、形が違う）
// 呼んだ画面が止めた（AbortSignal）ときは、AbortError をそのまま投げる。

export type ApiResult<T> =
  | { status: "ok"; value: T }
  | { status: "unauthorized" }
  | { status: "notFound" }
  | { status: "failed" };

async function callJson<T>(
  url: string,
  init: RequestInit,
  schema: z.ZodType<T>,
): Promise<ApiResult<T>> {
  const signal = init.signal ?? undefined;
  let response: Response;
  try {
    response = await deviceFetch(url, init);
  } catch (error) {
    if (signal?.aborted) throw error;
    return { status: "failed" };
  }
  if (response.status === 401) return { status: "unauthorized" };
  if (response.status === 404) return { status: "notFound" };
  if (!response.ok) return { status: "failed" };
  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    if (signal?.aborted) throw error;
    return { status: "failed" };
  }
  const parsed = schema.safeParse(body);
  return parsed.success
    ? { status: "ok", value: parsed.data }
    : { status: "failed" };
}

// `getGalaxy`（FN-003）。`date` を省くとサーバが日本時間の今日にする。
export function fetchGalaxy(
  request: { date?: string; signal?: AbortSignal } = {},
): Promise<ApiResult<Galaxy>> {
  const path = "/api/app/news/galaxy";
  const url =
    request.date === undefined
      ? path
      : `${path}?${new URLSearchParams({ date: request.date }).toString()}`;
  return callJson(url, { signal: request.signal }, galaxySchema);
}

// `getArticle`（FN-004）。
export function fetchArticle(
  contentId: number,
  request: { signal?: AbortSignal } = {},
): Promise<ApiResult<ArticleDetail>> {
  return callJson(
    `/api/app/news/articles/${contentId}`,
    { signal: request.signal },
    articleDetailSchema,
  );
}

// `markOpened`（FN-004 手順 4）。初めて開いた日時を残す。
export function markOpened(
  contentId: number,
): Promise<ApiResult<ContentState>> {
  return callJson(
    `/api/app/contents/${contentId}/opened`,
    { method: "POST" },
    contentStateSchema,
  );
}

function putState(
  contentId: number,
  name: "read" | "saved",
  body: Record<string, boolean>,
): Promise<ApiResult<ContentState>> {
  return callJson(
    `/api/app/contents/${contentId}/${name}`,
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
    contentStateSchema,
  );
}

// `setRead`（FN-005）。既読にする、未読に戻す。
export function setRead(
  contentId: number,
  isRead: boolean,
): Promise<ApiResult<ContentState>> {
  return putState(contentId, "read", { isRead });
}

// `setSaved`（FN-006）。保存する、保存を外す。
export function setSaved(
  contentId: number,
  isSaved: boolean,
): Promise<ApiResult<ContentState>> {
  return putState(contentId, "saved", { isSaved });
}
