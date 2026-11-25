import { createConversationBodySchema } from "../../../contracts/chat";
import type { Chat } from "../../../server/chat";
import { logLevelOf } from "../../../server/shared/errors";
import type { Logger } from "../../../server/shared/logger";
import { readPageQuery } from "./content-list";
import { type DeviceApiContext, deviceApi } from "./device-api";
import { errorResponse } from "./errors";

// 会話の選択の端末の API（DD-01 M11。DD-02 FN-014、3章 P03、DD-04）。
//   `listConversations`  GET  `/api/app/conversations`                   最後に話した日時の新しい順
//   `createConversation` POST `/api/app/conversations`                   本文 `{ "target"?: QuestionTarget }`
//   `getConversation`    GET  `/api/app/conversations/{conversationId}`
// 1. 3章 P01 で端末の鍵を確かめる（`createConversation` はオリジンも。`deviceApi`）。
// 2. `listConversations` は `targetContentId`、`cursor`、`limit` の形を、`createConversation` は本文の形を
//    M10 で確かめる。違えば 400 と MSG-019（DD-06 E01）。`phrase` の中身は M18 が確かめて 400 にする（2章 C07）。
//    `getConversation` は 400 を返さない操作なので（DD-04 2章）、会話ID の形が違えば会話が無いとして 404。
// 3. M18 を呼び、`openapi.yaml` の形で返す。`createConversation` は 201。
// 4. 会話が無ければ 404 と MSG-019（DD-06 E05）。失敗は 500 と MSG-019（DD-04 3.4）。

const ID_PATTERN = /^[1-9][0-9]*$/;

export interface ConversationRouteContext {
  params: Promise<{ conversationId: string }>;
}

export interface ConversationApiContext {
  deviceApi: DeviceApiContext;
  chat: Chat;
}

function readId(text: string): number | null {
  if (!ID_PATTERN.test(text)) return null;
  const value = Number(text);
  return Number.isSafeInteger(value) ? value : null;
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

const TARGET = "FN-014";

export function listConversations(
  context: ConversationApiContext,
): (request: Request) => Promise<Response> {
  const { logger } = context.deviceApi;
  const handle = deviceApi(
    context.deviceApi,
    (request, { requestId }) => {
      const url = new URL(request.url);
      const query = readPageQuery(url);
      const targetText = url.searchParams.get("targetContentId");
      const targetContentId = targetText === null ? null : readId(targetText);
      if (query === null || (targetText !== null && targetContentId === null)) {
        logInvalid(logger, TARGET, requestId);
        return errorResponse(400, "bad_request", "MSG-019");
      }
      return Response.json(
        context.chat.listConversations(targetContentId, query),
      );
    },
    { target: TARGET },
  );
  return (request) => handle(request, undefined);
}

export function createConversation(
  context: ConversationApiContext,
): (request: Request) => Promise<Response> {
  const { logger } = context.deviceApi;
  const handle = deviceApi(
    context.deviceApi,
    async (request, { requestId }) => {
      let body: unknown;
      try {
        body = JSON.parse(await request.text()) as unknown;
      } catch {
        body = undefined;
      }
      const parsed = createConversationBodySchema.safeParse(body);
      if (!parsed.success) {
        logInvalid(logger, TARGET, requestId);
        return errorResponse(400, "bad_request", "MSG-019");
      }
      // `phrase` の中身が足りなければ M18 が INPUT_INVALID を投げ、入口が 400 にする。
      const created = context.chat.createConversation(
        parsed.data.target ?? null,
      );
      return Response.json(created, { status: 201 });
    },
    { target: TARGET },
  );
  return (request) => handle(request, undefined);
}

export function getConversation(
  context: ConversationApiContext,
): (
  request: Request,
  routeContext: ConversationRouteContext,
) => Promise<Response> {
  const { logger } = context.deviceApi;
  return deviceApi<ConversationRouteContext>(
    context.deviceApi,
    async (_request, { requestId }, routeContext) => {
      const { conversationId: text } = await routeContext.params;
      const conversationId = readId(text);
      if (conversationId === null) {
        logger.log({
          level: logLevelOf("NOT_FOUND"),
          code: "NOT_FOUND",
          msg: "MSG-019",
          target: TARGET,
          requestId,
        });
        return errorResponse(404, "not_found", "MSG-019");
      }
      return Response.json(context.chat.getConversation(conversationId));
    },
    { target: TARGET },
  );
}
