import type { Contents } from "../../../server/contents";
import { logLevelOf } from "../../../server/shared/errors";
import {
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
  type PageQuery,
  decodeCursor,
} from "../../../server/shared/paging";
import { type DeviceApiContext, deviceApi } from "./device-api";
import { errorResponse } from "./errors";

// 種類を問わない一覧と検索の端末の API（DD-01 M11。DD-02 FN-017、FN-018、FN-019、3章 P03、DD-04）。
//   `listInbox`      GET `/api/app/contents/inbox`   届いた日時の新しい順
//   `searchContents` GET `/api/app/contents/search`  届いた日時の新しい順（検索の言葉 `q` で絞る）
//   `listSaved`      GET `/api/app/contents/saved`   保存した日時の新しい順
// 1. 3章 P01 で端末の鍵を確かめる（`deviceApi`）。
//    `searchContents` は、`q` が 1〜200 文字であることも確かめる（DD-02 FN-018 手順 1、2章 C06）。
// 2. `cursor` があれば `[並べる値, ID]` に戻し、`limit` が 1〜50 の整数かを確かめる（省くと 30。DD-04 3.3）。
//    戻せないか形が違えば 400 と MSG-019（DD-06 E01）。
// 3. M17 で読み、`openapi.yaml` の `ContentPage` の形で返す。
// 4. 失敗は 500 と MSG-019（読むだけの操作。DD-04 3.4）。

// `openapi.yaml` の `Cursor` の `maxLength`。
const CURSOR_MAX_LENGTH = 200;
const LIMIT_PATTERN = /^[1-9][0-9]*$/;
// 検索の言葉の上限（BD-10 4章。Q-079 の答え。`openapi.yaml` の `q` の `maxLength`）。
// 文字は Unicode の符号位置で数える。
export const SEARCH_QUERY_MAX_LENGTH = 200;

export interface ContentListApiContext {
  deviceApi: DeviceApiContext;
  contents: Contents;
}

// 問い合わせの `cursor` と `limit` を読む。形が違えば null。
export function readPageQuery(url: URL): PageQuery | null {
  const cursorText = url.searchParams.get("cursor");
  const limitText = url.searchParams.get("limit");

  let after: PageQuery["after"] = null;
  if (cursorText !== null) {
    if (cursorText.length > CURSOR_MAX_LENGTH) return null;
    after = decodeCursor(cursorText);
    if (after === null) return null;
  }

  let limit = DEFAULT_PAGE_LIMIT;
  if (limitText !== null) {
    if (!LIMIT_PATTERN.test(limitText)) return null;
    limit = Number(limitText);
    if (limit > MAX_PAGE_LIMIT) return null;
  }
  return { after, limit };
}

// 問い合わせの `q` を読む。無いか、1〜200 文字でなければ null。
// 空白だけの言葉は M17 が断る（DD-02 2章 C06）。
export function readSearchQuery(url: URL): string | null {
  const q = url.searchParams.get("q");
  if (q === null) return null;
  const length = [...q].length;
  if (length < 1 || length > SEARCH_QUERY_MAX_LENGTH) return null;
  return q;
}

function listApi(
  context: ContentListApiContext,
  target: string,
  read: (
    query: PageQuery,
    url: URL,
  ) => ReturnType<Contents["listInbox"]> | null,
): (request: Request) => Promise<Response> {
  const { logger } = context.deviceApi;
  const handle = deviceApi(
    context.deviceApi,
    (request, { requestId }) => {
      const url = new URL(request.url);
      const query = readPageQuery(url);
      const page = query === null ? null : read(query, url);
      if (page === null) {
        logger.log({
          level: logLevelOf("INPUT_INVALID"),
          code: "INPUT_INVALID",
          msg: "MSG-019",
          target,
          requestId,
        });
        return errorResponse(400, "bad_request", "MSG-019");
      }
      return Response.json(page);
    },
    { target },
  );
  return (request) => handle(request, undefined);
}

export function listInbox(
  context: ContentListApiContext,
): (request: Request) => Promise<Response> {
  return listApi(context, "FN-017", (query) =>
    context.contents.listInbox(query),
  );
}

export function searchContents(
  context: ContentListApiContext,
): (request: Request) => Promise<Response> {
  return listApi(context, "FN-018", (query, url) => {
    const q = readSearchQuery(url);
    return q === null ? null : context.contents.searchContents(q, query);
  });
}

export function listSaved(
  context: ContentListApiContext,
): (request: Request) => Promise<Response> {
  return listApi(context, "FN-019", (query) =>
    context.contents.listSaved(query),
  );
}
