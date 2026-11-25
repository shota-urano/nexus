import { putEnglishAnswerBodySchema } from "../../../contracts/english";
import type { EnglishLearning } from "../../../server/kinds/english/learning";
import { logLevelOf } from "../../../server/shared/errors";
import type { Logger } from "../../../server/shared/logger";
import { readPageQuery } from "./content-list";
import type { ContentRouteContext } from "./content-state";
import { type DeviceApiContext, deviceApi } from "./device-api";
import { errorResponse } from "./errors";

// 英語の教材の端末の API（DD-01 M11。DD-02 FN-008、FN-009、FN-012、3章 P01、P03、DD-04）。
//   `listEnglishSets`  GET `/api/app/english/sets`                      対象日の新しい順
//   `getEnglishSet`    GET `/api/app/english/sets/{contentId}`          教材と前に完了した答え
//   `putEnglishAnswer` PUT `/api/app/english/sets/{contentId}/answer`   本文 `{ "grades": Grade[] }`
// 1. 3章 P01 で端末の鍵（PUT はオリジンも）を確かめる（`deviceApi`）。
// 2. `listEnglishSets` は `cursor` と `limit` を、`putEnglishAnswer` は内容ID と本文を
//    `openapi.yaml` の形で確かめる。違えば 400 と MSG-019（DD-06 E01）。
//    `getEnglishSet` は 400 を返さない操作なので（`openapi.yaml`）、内容ID の形が違えば内容が無いとして 404。
// 3. M16 で読むか残す。内容が無いか英語でなければ 404 と MSG-019（DD-06 E05）。
//    `grades` の問題番号が問題と重なりなく全て一致しなければ 400 と MSG-005（DD-06 E07）。
// 4. 失敗は 500。読むだけの操作は MSG-019、`putEnglishAnswer` は MSG-007（DD-04 3.4）。

const ID_PATTERN = /^[1-9][0-9]*$/;

export interface EnglishLearningApiContext {
  deviceApi: DeviceApiContext;
  english: EnglishLearning;
}

async function readContentId(
  routeContext: ContentRouteContext,
): Promise<number | null> {
  const { contentId } = await routeContext.params;
  if (!ID_PATTERN.test(contentId)) return null;
  const value = Number(contentId);
  return Number.isSafeInteger(value) ? value : null;
}

function invalid(logger: Logger, target: string, requestId: string): Response {
  logger.log({
    level: logLevelOf("INPUT_INVALID"),
    code: "INPUT_INVALID",
    msg: "MSG-019",
    target,
    requestId,
  });
  return errorResponse(400, "bad_request", "MSG-019");
}

export function listEnglishSets(
  context: EnglishLearningApiContext,
): (request: Request) => Promise<Response> {
  const target = "FN-008";
  const { logger } = context.deviceApi;
  const handle = deviceApi(
    context.deviceApi,
    (request, { requestId }) => {
      const query = readPageQuery(new URL(request.url));
      if (query === null) return invalid(logger, target, requestId);
      return Response.json(context.english.listSets(query));
    },
    { target },
  );
  return (request) => handle(request, undefined);
}

export function getEnglishSet(
  context: EnglishLearningApiContext,
): (request: Request, routeContext: ContentRouteContext) => Promise<Response> {
  const target = "FN-009";
  const { logger } = context.deviceApi;
  return deviceApi<ContentRouteContext>(
    context.deviceApi,
    async (_request, { requestId }, routeContext) => {
      const contentId = await readContentId(routeContext);
      if (contentId === null) {
        logger.log({
          level: logLevelOf("NOT_FOUND"),
          code: "NOT_FOUND",
          msg: "MSG-019",
          target,
          requestId,
        });
        return errorResponse(404, "not_found", "MSG-019");
      }
      // 内容が無ければ M16 が NOT_FOUND を投げ、入口が 404 と MSG-019 にする。
      return Response.json(context.english.getSet(contentId));
    },
    { target },
  );
}

export function putEnglishAnswer(
  context: EnglishLearningApiContext,
): (request: Request, routeContext: ContentRouteContext) => Promise<Response> {
  const target = "FN-012";
  const { logger } = context.deviceApi;
  return deviceApi<ContentRouteContext>(
    context.deviceApi,
    async (request, { requestId }, routeContext) => {
      const contentId = await readContentId(routeContext);
      let body: unknown;
      try {
        body = JSON.parse(await request.text()) as unknown;
      } catch {
        return invalid(logger, target, requestId);
      }
      const parsed = putEnglishAnswerBodySchema.safeParse(body);
      if (contentId === null || !parsed.success) {
        return invalid(logger, target, requestId);
      }
      // 規則違反は M16 が MSG-005 の RULE_VIOLATION を投げ、入口が 400 にする。
      return Response.json(
        context.english.putAnswer(contentId, parsed.data.grades),
      );
    },
    { target, messages: { 500: "MSG-007" } },
  );
}
