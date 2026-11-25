import type { Chat, ChatMessage } from "../../../server/chat";
import { logLevelOf } from "../../../server/shared/errors";
import { type DeviceApiContext, deviceApi } from "./device-api";
import { errorResponse } from "./errors";

// 応答の送り直しと中止の端末の API（DD-01 M11。DD-02 FN-016、DD-04）。
//   `retryReply`    POST `/api/app/messages/{messageId}/retry`    失敗か中止の応答を送り直す
//   `stopReply`     POST `/api/app/messages/{messageId}/stop`     作成中の応答を止める
//   `dismissReply`  POST `/api/app/messages/{messageId}/dismiss`  失敗した応答をやめる
// 1. 3章 P01 で端末の鍵とオリジンを確かめる（`deviceApi`）。
// 2. 発言ID の形が違うか、M18 で発言が無いか本人の発言なら 404 と MSG-019（DD-06 E05）。
// 3. M18 を呼び、200 で今の AI の発言を返す。事前条件に合わなければ、何もせずに今の発言を返す
//    （冪等。DD-04 3.2、DD-06 E06）。失敗は 500 と MSG-019（DD-04 3.4）。

const ID_PATTERN = /^[1-9][0-9]*$/;
const TARGET = "FN-016";

export interface ReplyActionRouteContext {
  params: Promise<{ messageId: string }>;
}

export interface ReplyActionApiContext {
  deviceApi: DeviceApiContext;
  chat: Chat;
}

function readId(text: string): number | null {
  if (!ID_PATTERN.test(text)) return null;
  const value = Number(text);
  return Number.isSafeInteger(value) ? value : null;
}

function replyAction(
  context: ReplyActionApiContext,
  action: (chat: Chat, messageId: number) => ChatMessage,
): (
  request: Request,
  routeContext: ReplyActionRouteContext,
) => Promise<Response> {
  const { logger } = context.deviceApi;
  return deviceApi<ReplyActionRouteContext>(
    context.deviceApi,
    async (_request, { requestId }, routeContext) => {
      const { messageId: text } = await routeContext.params;
      const messageId = readId(text);
      if (messageId === null) {
        logger.log({
          level: logLevelOf("NOT_FOUND"),
          code: "NOT_FOUND",
          msg: "MSG-019",
          target: TARGET,
          requestId,
        });
        return errorResponse(404, "not_found", "MSG-019");
      }
      return Response.json(action(context.chat, messageId));
    },
    { target: TARGET },
  );
}

export function retryReply(context: ReplyActionApiContext) {
  return replyAction(context, (chat, messageId) => chat.retryReply(messageId));
}

export function stopReply(context: ReplyActionApiContext) {
  return replyAction(context, (chat, messageId) => chat.stopReply(messageId));
}

export function dismissReply(context: ReplyActionApiContext) {
  return replyAction(context, (chat, messageId) =>
    chat.dismissReply(messageId),
  );
}
