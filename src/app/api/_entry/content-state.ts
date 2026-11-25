import type { ContentStateOutcome, Contents } from "../../../server/contents";
import { logLevelOf } from "../../../server/shared/errors";
import type { Logger } from "../../../server/shared/logger";
import {
  type DeviceApiContext,
  type DeviceRequestInfo,
  deviceApi,
} from "./device-api";
import { type MessageRef, errorResponse, toErrorResponse } from "./errors";

// 内容の状態を変える端末の API（DD-01 M11。DD-02 FN-004 手順 4、FN-005、FN-006、DD-04）。
//   `markOpened` POST `/api/app/contents/{contentId}/opened`
//   `setRead`    PUT  `/api/app/contents/{contentId}/read`   本文 `{ "isRead": 真偽 }`
//   `setSaved`   PUT  `/api/app/contents/{contentId}/saved`  本文 `{ "isSaved": 真偽 }`
// 1. 3章 P01 で端末の鍵とオリジンを確かめる（`deviceApi`）。
// 2. `setRead`、`setSaved` は、内容ID と本文の形を確かめる。違えば 400 と MSG-019（DD-06 E01）。
//    `markOpened` は 400 を返さない操作なので（DD-04 2章）、内容ID の形が違えば内容が無いとして 404。
// 3. M17 で変える。内容が無ければ 404 と MSG-019（DD-06 E05）。今と同じ値の求めは、何もせずに
//    200 で今の状態を返す（DD-06 E06）。
// 4. 失敗は 500。`setRead`、`setSaved` は MSG-003（操作の名前は押した操作。BD-09 1章）。

const ID_PATTERN = /^[1-9][0-9]*$/;

export interface ContentRouteContext {
  params: Promise<{ contentId: string }>;
}

export interface ContentStateApiContext {
  deviceApi: DeviceApiContext;
  contents: Contents;
}

async function readContentId(
  routeContext: ContentRouteContext,
): Promise<number | null> {
  const { contentId } = await routeContext.params;
  if (!ID_PATTERN.test(contentId)) return null;
  const value = Number(contentId);
  return Number.isSafeInteger(value) ? value : null;
}

// 本文が `{ [name]: 真偽 }` だけの形なら値を返す（`openapi.yaml` の `additionalProperties: false`）。
async function readBooleanBody(
  request: Request,
  name: string,
): Promise<boolean | null> {
  let body: unknown;
  try {
    body = JSON.parse(await request.text()) as unknown;
  } catch {
    return null;
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return null;
  }
  const keys = Object.keys(body);
  const value = (body as Record<string, unknown>)[name];
  if (keys.length !== 1 || keys[0] !== name || typeof value !== "boolean") {
    return null;
  }
  return value;
}

function logInvalid(logger: Logger, target: string, requestId: string): void {
  logger.log({
    level: logLevelOf("INPUT_INVALID"),
    code: "INPUT_INVALID",
    msg: "MSG-019",
    target,
    requestId,
  });
}

function stateResponse(
  logger: Logger,
  outcome: ContentStateOutcome,
  target: string,
  requestId: string,
): Response {
  if (outcome.unchanged) {
    logger.log({
      level: logLevelOf("STATE_CONFLICT"),
      code: "STATE_CONFLICT",
      target,
      requestId,
      contentId: outcome.state.contentId,
    });
  }
  return Response.json(outcome.state);
}

export function markOpened(
  context: ContentStateApiContext,
): (request: Request, routeContext: ContentRouteContext) => Promise<Response> {
  const target = "FN-004";
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
      const outcome = context.contents.markOpened(contentId);
      return stateResponse(logger, outcome, target, requestId);
    },
    { target },
  );
}

// `setRead` と `setSaved` の共通の形。
function setFlag(
  context: ContentStateApiContext,
  spec: {
    target: string;
    bodyName: string;
    change: (contentId: number, value: boolean) => ContentStateOutcome;
    // 押した操作の名前（MSG-003 の「操作」）。
    operation: (value: boolean) => string;
  },
): (request: Request, routeContext: ContentRouteContext) => Promise<Response> {
  const { target } = spec;
  const { logger } = context.deviceApi;
  return deviceApi<ContentRouteContext>(
    context.deviceApi,
    async (request, info: DeviceRequestInfo, routeContext) => {
      const { requestId } = info;
      const contentId = await readContentId(routeContext);
      const value = await readBooleanBody(request, spec.bodyName);
      if (contentId === null || value === null) {
        logInvalid(logger, target, requestId);
        return errorResponse(400, "bad_request", "MSG-019");
      }
      try {
        const outcome = spec.change(contentId, value);
        return stateResponse(logger, outcome, target, requestId);
      } catch (error) {
        const message: MessageRef = {
          id: "MSG-003",
          values: { 操作: spec.operation(value) },
        };
        return toErrorResponse(error, {
          logger,
          requestId,
          target,
          messages: { 500: message },
        });
      }
    },
    { target },
  );
}

export function setRead(
  context: ContentStateApiContext,
): (request: Request, routeContext: ContentRouteContext) => Promise<Response> {
  return setFlag(context, {
    target: "FN-005",
    bodyName: "isRead",
    change: (contentId, value) => context.contents.setRead(contentId, value),
    operation: (value) => (value ? "既読に" : "未読に戻す"),
  });
}

export function setSaved(
  context: ContentStateApiContext,
): (request: Request, routeContext: ContentRouteContext) => Promise<Response> {
  return setFlag(context, {
    target: "FN-006",
    bodyName: "isSaved",
    change: (contentId, value) => context.contents.setSaved(contentId, value),
    operation: (value) => (value ? "保存" : "保存を外す"),
  });
}
