import type {
  Sender,
  SenderInterface,
  SenderKeys,
} from "../../../server/auth/sender-key";
import { logLevelOf } from "../../../server/shared/errors";
import type { Logger } from "../../../server/shared/logger";
import type { MessageId } from "../../../server/shared/messages";
import { createRequestId } from "../../../server/shared/secret";
import { errorResponse, toErrorResponse, type MessageRef } from "./errors";

// 配信元の API の入口（DD-01 M11。DD-02 3章 P02、DD-04 3.1）。
// 配信元の API の handler は、最初にこの入口を通す（Next.js の middleware では確かめない。DD-01 3章）。
//   0. 本文の上限を決めた操作は、本文の大きさを読む。超えたら 413 と MSG-034（DD-02 FN-001 手順 1、DD-06 E02）。
//   1. `Authorization` の欄が `Bearer <鍵>` の形かを確かめ、M12 で照合値から配信元を読む。
//   2. 行が無いか、その配信元が使う連携を使えなければ、401 と MSG-032（DD-06 E03）。
// 鍵が無い、正しくない、取り消した、その連携を使えない、を応答で分けない（DD-04 3.1）。

export interface SenderApiContext {
  logger: Logger;
  senderKeys: Pick<SenderKeys, "verify">;
}

export interface SenderRequestInfo {
  sender: Sender;
  requestId: string;
  // 本文の上限を決めた操作は、読んだ本文（UTF-8 のバイト）。決めていない操作は null。
  body: Uint8Array | null;
}

export interface SenderApiOptions {
  // 使う連携（BD-07 4.2。NFR-014）。
  usedInterface: SenderInterface;
  // ログの `target`（FN、IF の番号）。
  target?: string;
  // 本文の上限（バイト）。決めると、鍵より先に大きさを確かめる。
  maxBodyBytes?: number;
  // 鍵か大きさで断ったときに呼ぶ（受け取りの断った記録を作る。DD-02 FN-001）。
  onRefused?(message: { id: MessageId }): void;
  // 500 の MSG（DD-04 3.4。例: `postNewsBatch` は MSG-045）。省くと端末の API と同じ既定の MSG。
  internalMessage?(error: unknown): MessageRef;
}

export type SenderApiHandler<C> = (
  request: Request,
  info: SenderRequestInfo,
  routeContext: C,
) => Response | Promise<Response>;

// `Authorization: Bearer <鍵>` から鍵を読む。形が違えば null。
export function readBearerKey(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (header === null) return null;
  const match = /^Bearer ([^\s]+)$/.exec(header.trim());
  return match === null ? null : match[1];
}

// 本文を上限 + 1 バイトまで読む。上限を超えたら null（残りは読まない）。
export async function readBodyWithin(
  request: Request,
  maxBytes: number,
): Promise<Uint8Array | null> {
  const declared = request.headers.get("content-length");
  if (declared !== null && Number(declared) > maxBytes) return null;
  if (request.body === null) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

// handler を P02 で包み、Route Handler の形にする。
export function senderApi<C = unknown>(
  context: SenderApiContext,
  handler: SenderApiHandler<C>,
  options: SenderApiOptions,
): (request: Request, routeContext: C) => Promise<Response> {
  return async (request, routeContext) => {
    const requestId = createRequestId();
    const { logger } = context;
    const { target } = options;
    try {
      let body: Uint8Array | null = null;
      if (options.maxBodyBytes !== undefined) {
        body = await readBodyWithin(request, options.maxBodyBytes);
        if (body === null) {
          logger.log({
            level: logLevelOf("INPUT_TOO_LARGE"),
            code: "INPUT_TOO_LARGE",
            msg: "MSG-034",
            target,
            requestId,
          });
          options.onRefused?.({ id: "MSG-034" });
          return errorResponse(413, "payload_too_large", "MSG-034");
        }
      }

      const sender = context.senderKeys.verify(
        readBearerKey(request),
        options.usedInterface,
      );
      if (sender === null) {
        logger.log({
          level: logLevelOf("AUTH_DENIED"),
          code: "AUTH_DENIED",
          msg: "MSG-032",
          target,
          requestId,
        });
        options.onRefused?.({ id: "MSG-032" });
        return errorResponse(401, "unauthorized", "MSG-032");
      }

      return await handler(request, { sender, requestId, body }, routeContext);
    } catch (error) {
      // 鍵を確かめる途中の失敗（DB が使えないなど）か、handler が扱わなかった失敗。
      return toErrorResponse(error, {
        logger,
        requestId,
        target,
        messages:
          options.internalMessage === undefined
            ? undefined
            : { 500: options.internalMessage(error) },
      });
    }
  };
}
