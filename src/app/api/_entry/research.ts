import type { ResearchView } from "../../../server/kinds/research/view";
import { logLevelOf } from "../../../server/shared/errors";
import { type DeviceApiContext, deviceApi } from "./device-api";
import { errorResponse } from "./errors";

// 課題の一覧と週報の端末の API（DD-01 M11。DD-02 FN-026、FN-027、DD-04。CR-020）。
//   `listResearchTopics` GET `/api/app/research/topics`
//   `getResearchReport`  GET `/api/app/research/reports/{contentId}`
//   `markApproachSeen`   POST `/api/app/research/reports/{contentId}/approaches/{no}/seen`（CR-024）
// 1. 3章 P01 で端末の鍵を確かめる（`deviceApi`）。POST はオリジンも確かめる。
// 2. `getResearchReport` と `markApproachSeen` は 400 を返さない操作なので（`openapi.yaml`）、内容ID か
//    方法の番号の形が違えば週報が無いとして 404 と MSG-048（DD-06 E05）。
// 3. M33 で読む。週報が無いか週報でなければ 404 と MSG-048。`markApproachSeen` はその番号の方法が無くても
//    404 と MSG-048（DD-02 FN-027 手順 8）。
// 4. 失敗は 500 と MSG-019（読むだけの操作。DD-04 3.4）。

const ID_PATTERN = /^[1-9][0-9]*$/;

export interface ResearchApiContext {
  deviceApi: DeviceApiContext;
  research: ResearchView;
}

export interface ResearchReportRouteContext {
  params: Promise<{ contentId: string }>;
}

export interface ApproachSeenRouteContext {
  params: Promise<{ contentId: string; no: string }>;
}

// 1以上の安全な整数の形なら値を返す。
function readId(text: string): number | null {
  if (!ID_PATTERN.test(text)) return null;
  const value = Number(text);
  return Number.isSafeInteger(value) ? value : null;
}

export function listResearchTopics(
  context: ResearchApiContext,
): (request: Request) => Promise<Response> {
  const handle = deviceApi(
    context.deviceApi,
    () => Response.json(context.research.listTopics()),
    { target: "FN-026" },
  );
  return (request) => handle(request, undefined);
}

export function getResearchReport(
  context: ResearchApiContext,
): (
  request: Request,
  routeContext: ResearchReportRouteContext,
) => Promise<Response> {
  const target = "FN-027";
  const { logger } = context.deviceApi;
  return deviceApi<ResearchReportRouteContext>(
    context.deviceApi,
    async (_request, { requestId }, routeContext) => {
      const { contentId: text } = await routeContext.params;
      const contentId = ID_PATTERN.test(text) ? Number(text) : NaN;
      if (!Number.isSafeInteger(contentId)) {
        logger.log({
          level: logLevelOf("NOT_FOUND"),
          code: "NOT_FOUND",
          msg: "MSG-048",
          target,
          requestId,
        });
        return errorResponse(404, "not_found", "MSG-048");
      }
      return Response.json(context.research.getReport(contentId));
    },
    { target },
  );
}

export function markApproachSeen(
  context: ResearchApiContext,
): (
  request: Request,
  routeContext: ApproachSeenRouteContext,
) => Promise<Response> {
  const target = "FN-027";
  const { logger } = context.deviceApi;
  return deviceApi<ApproachSeenRouteContext>(
    context.deviceApi,
    async (_request, { requestId }, routeContext) => {
      const params = await routeContext.params;
      const contentId = readId(params.contentId);
      const no = readId(params.no);
      if (contentId === null || no === null) {
        logger.log({
          level: logLevelOf("NOT_FOUND"),
          code: "NOT_FOUND",
          msg: "MSG-048",
          target,
          requestId,
        });
        return errorResponse(404, "not_found", "MSG-048");
      }
      return Response.json(context.research.markApproachSeen(contentId, no));
    },
    { target },
  );
}
