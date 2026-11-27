import type { ResearchView } from "../../../server/kinds/research/view";
import { logLevelOf } from "../../../server/shared/errors";
import { type DeviceApiContext, deviceApi } from "./device-api";
import { errorResponse } from "./errors";

// 課題の一覧と週報の端末の API（DD-01 M11。DD-02 FN-026、FN-027、DD-04。CR-020）。
//   `listResearchTopics` GET `/api/app/research/topics`
//   `getResearchReport`  GET `/api/app/research/reports/{contentId}`
// 1. 3章 P01 で端末の鍵を確かめる（`deviceApi`）。
// 2. `getResearchReport` は 400 を返さない操作なので（`openapi.yaml`）、内容ID の形が違えば週報が無いとして
//    404 と MSG-048（DD-06 E05）。
// 3. M33 で読む。`getResearchReport` は週報が無いか週報でなければ 404 と MSG-048。
// 4. 失敗は 500 と MSG-019（読むだけの操作。DD-04 3.4）。

const ID_PATTERN = /^[1-9][0-9]*$/;

export interface ResearchApiContext {
  deviceApi: DeviceApiContext;
  research: ResearchView;
}

export interface ResearchReportRouteContext {
  params: Promise<{ contentId: string }>;
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
