import { type ContentPage, contentPageSchema } from "../contracts/contents";
import { deviceFetch } from "./device-api";

// 通信層 M09（DD-01 1.1）。種類を問わない一覧と検索の端末の API を呼び、応答を
// M10 の形で確かめる（DD-04 `listInbox`、`searchContents`、`listSaved`）。
// 結果は次の3つのどれかで返す。
// - ok: 応答の形が正しい1ページ
// - unauthorized: 401（MSG-020）。全面の知らせは M01 の枠が出す（deviceFetch が届け先に渡す）
// - failed: それ以外の失敗（つながらない、200 でない、形が違う）。画面は MSG-019 を出す
// 呼んだ画面が止めた（AbortSignal）ときは、AbortError をそのまま投げる。

export type ContentPageResult =
  | { status: "ok"; page: ContentPage }
  | { status: "unauthorized" }
  | { status: "failed" };

export interface PageRequest {
  /** 前のページの `nextCursor`。初めのページでは省く */
  cursor?: string | null;
  signal?: AbortSignal;
}

async function getContentPage(
  path: string,
  params: URLSearchParams,
  signal: AbortSignal | undefined,
): Promise<ContentPageResult> {
  const query = params.toString();
  let response: Response;
  try {
    response = await deviceFetch(query === "" ? path : `${path}?${query}`, {
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    return { status: "failed" };
  }
  if (response.status === 401) return { status: "unauthorized" };
  if (!response.ok) return { status: "failed" };
  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    if (signal?.aborted) throw error;
    return { status: "failed" };
  }
  const parsed = contentPageSchema.safeParse(body);
  return parsed.success
    ? { status: "ok", page: parsed.data }
    : { status: "failed" };
}

function pageParams(cursor: string | null | undefined): URLSearchParams {
  const params = new URLSearchParams();
  if (cursor) params.set("cursor", cursor);
  return params;
}

// `listInbox`（FN-017）。新着と未読を届いた日時の新しい順に読む。
export function fetchInbox(
  request: PageRequest = {},
): Promise<ContentPageResult> {
  return getContentPage(
    "/api/app/contents/inbox",
    pageParams(request.cursor),
    request.signal,
  );
}

// `searchContents`（FN-018）。検索の言葉 `q` で探す。
export function fetchSearch(
  q: string,
  request: PageRequest = {},
): Promise<ContentPageResult> {
  const params = pageParams(request.cursor);
  params.set("q", q);
  return getContentPage("/api/app/contents/search", params, request.signal);
}

// `listSaved`（FN-019）。保存した内容を保存した日時の新しい順に読む。
export function fetchSaved(
  request: PageRequest = {},
): Promise<ContentPageResult> {
  return getContentPage(
    "/api/app/contents/saved",
    pageParams(request.cursor),
    request.signal,
  );
}
