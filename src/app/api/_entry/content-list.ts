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

// 種類を問わない一覧の端末の API（DD-01 M11。DD-02 FN-017、FN-019、3章 P03、DD-04）。
//   `listInbox` GET `/api/app/contents/inbox`  届いた日時の新しい順
//   `listSaved` GET `/api/app/contents/saved`  保存した日時の新しい順
// 1. 3章 P01 で端末の鍵を確かめる（`deviceApi`）。
// 2. `cursor` があれば `[並べる値, ID]` に戻し、`limit` が 1〜50 の整数かを確かめる（省くと 30。DD-04 3.3）。
//    戻せないか形が違えば 400 と MSG-019（DD-06 E01）。
// 3. M17 で読み、`openapi.yaml` の `ContentPage` の形で返す。
// 4. 失敗は 500 と MSG-019（読むだけの操作。DD-04 3.4）。

// `openapi.yaml` の `Cursor` の `maxLength`。
const CURSOR_MAX_LENGTH = 200;
const LIMIT_PATTERN = /^[1-9][0-9]*$/;

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

function listApi(
  context: ContentListApiContext,
  target: string,
  read: (query: PageQuery) => ReturnType<Contents["listInbox"]>,
): (request: Request) => Promise<Response> {
  const { logger } = context.deviceApi;
  const handle = deviceApi(
    context.deviceApi,
    (request, { requestId }) => {
      const query = readPageQuery(new URL(request.url));
      if (query === null) {
        logger.log({
          level: logLevelOf("INPUT_INVALID"),
          code: "INPUT_INVALID",
          msg: "MSG-019",
          target,
          requestId,
        });
        return errorResponse(400, "bad_request", "MSG-019");
      }
      return Response.json(read(query));
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

export function listSaved(
  context: ContentListApiContext,
): (request: Request) => Promise<Response> {
  return listApi(context, "FN-019", (query) =>
    context.contents.listSaved(query),
  );
}
