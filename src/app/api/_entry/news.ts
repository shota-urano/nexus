import type { NewsView } from "../../../server/kinds/news/view";
import { daysBetween, formatDate } from "../../../server/shared/datetime";
import { logLevelOf } from "../../../server/shared/errors";
import { type DeviceApiContext, deviceApi } from "./device-api";
import { errorResponse } from "./errors";

// ニュースの図と案内の端末の API（DD-01 M11。DD-02 FN-003、FN-004、DD-04）。
//   `getGalaxy`  GET `/api/app/news/galaxy`               問い合わせ `date`（省くと日本時間の今日）
//   `getArticle` GET `/api/app/news/articles/{contentId}`
// 1. 3章 P01 で端末の鍵を確かめる（`deviceApi`）。
// 2. `getGalaxy` は `date` が `YYYY-MM-DD` の日付で、今日より後でないことを確かめる。
//    違えば 400 と MSG-019（DD-02 2章 C01、DD-06 E01）。
//    `getArticle` は 400 を返さない操作なので（`openapi.yaml`）、内容ID の形が違えば記事が無いとして
//    404 と MSG-002（DD-06 E05）。
// 3. M15 で読む。`getArticle` は記事が無いかニュースでなければ 404 と MSG-002。
// 4. 失敗は 500 と MSG-019（読むだけの操作。DD-04 3.4）。

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ID_PATTERN = /^[1-9][0-9]*$/;

export interface NewsApiContext {
  deviceApi: DeviceApiContext;
  news: NewsView;
}

export interface ArticleRouteContext {
  params: Promise<{ contentId: string }>;
}

// 問い合わせの `date` を読む。省けば今日。日付でないか今日より後なら null。
export function readGalaxyDate(url: URL, today: string): string | null {
  const date = url.searchParams.get("date");
  if (date === null) return today;
  if (!DATE_PATTERN.test(date)) return null;
  const days = daysBetween(date, today);
  return days === null || days < 0 ? null : date;
}

export function getGalaxy(
  context: NewsApiContext,
): (request: Request) => Promise<Response> {
  const target = "FN-003";
  const { logger, clock } = context.deviceApi;
  const handle = deviceApi(
    context.deviceApi,
    (request, { requestId }) => {
      const today = formatDate(clock.now());
      const date = readGalaxyDate(new URL(request.url), today);
      if (date === null) {
        logger.log({
          level: logLevelOf("INPUT_INVALID"),
          code: "INPUT_INVALID",
          msg: "MSG-019",
          target,
          requestId,
        });
        return errorResponse(400, "bad_request", "MSG-019");
      }
      return Response.json(context.news.getGalaxy(date));
    },
    { target },
  );
  return (request) => handle(request, undefined);
}

export function getArticle(
  context: NewsApiContext,
): (request: Request, routeContext: ArticleRouteContext) => Promise<Response> {
  const target = "FN-004";
  const { logger } = context.deviceApi;
  return deviceApi<ArticleRouteContext>(
    context.deviceApi,
    async (_request, { requestId }, routeContext) => {
      const { contentId: text } = await routeContext.params;
      const contentId = ID_PATTERN.test(text) ? Number(text) : NaN;
      if (!Number.isSafeInteger(contentId)) {
        logger.log({
          level: logLevelOf("NOT_FOUND"),
          code: "NOT_FOUND",
          msg: "MSG-002",
          target,
          requestId,
        });
        return errorResponse(404, "not_found", "MSG-002");
      }
      return Response.json(context.news.getArticle(contentId));
    },
    { target },
  );
}
