import type {
  DeviceKeyVerifier,
  VerifiedDevice,
} from "../../../server/auth/device-key";
import type { Clock } from "../../../server/shared/clock";
import { NexusError, logLevelOf } from "../../../server/shared/errors";
import type { Logger } from "../../../server/shared/logger";
import { createRequestId } from "../../../server/shared/secret";
import {
  errorResponse,
  toErrorResponse,
  type ApiErrorStatus,
  type MessageRef,
} from "./errors";

// 端末の API の入口（DD-01 M11。DD-02 3章 P01、DD-04 3.1）。
// 全ての `/api/app/` の handler は、最初にこの入口を通す（Next.js の middleware では確かめない。DD-01 3章）。
//   1. Cookie `nexus_device` の鍵を M12 で確かめる。通らなければ 401 と MSG-020（DD-06 E03）。
//   2. M12 が `device.last_used_at` を今にする。
//   3. POST と PUT は `Origin` が NEXUS のオリジンと同じかを確かめる。違えば 403（DD-06 E04）。
//   4. 応答に Cookie を付け直す（鍵が通った応答の全て）。

export const DEVICE_COOKIE_NAME = "nexus_device";
// 400日。Chrome が Cookie の期限を 400日までに切り詰めるため（DD-02 3章 P01 手順 4）。
export const DEVICE_COOKIE_MAX_AGE_SECONDS = 34_560_000;
// E03 のログを、同じ端末の鍵の照合値で1分に1回までに抑える（DD-06 2章）。
export const DENIED_LOG_INTERVAL_MS = 60_000;

const ORIGIN_CHECKED_METHODS = new Set(["POST", "PUT"]);

// 端末の鍵の Cookie（DD-02 3章 P01 の属性）。値は鍵そのもの（DD-04 3.1）。
export function deviceCookie(key: string): string {
  return [
    `${DEVICE_COOKIE_NAME}=${key}`,
    `Max-Age=${DEVICE_COOKIE_MAX_AGE_SECONDS}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Strict",
  ].join("; ");
}

// 要求の Cookie の欄から、名前の値を読む。同じ名前が2つ以上あれば最初の値。
export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (header === null) return null;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) {
      return part.slice(index + 1).trim();
    }
  }
  return null;
}

export interface DeniedLogLimiter {
  // この照合値の E03 をログに出してよいか。出してよいときは、出した時刻を覚える。
  shouldLog(keyHash: string): boolean;
}

export function createDeniedLogLimiter(
  clock: Clock,
  intervalMs: number = DENIED_LOG_INTERVAL_MS,
): DeniedLogLimiter {
  const lastLogged = new Map<string, number>();
  return {
    shouldLog(keyHash) {
      const now = clock.now().getTime();
      // 間隔を過ぎた照合値を捨てる（覚える数が増え続けないように）。
      for (const [hash, at] of lastLogged) {
        if (now - at >= intervalMs) lastLogged.delete(hash);
      }
      if (lastLogged.has(keyHash)) return false;
      lastLogged.set(keyHash, now);
      return true;
    },
  };
}

// 端末の API の入口が使うもの。Web サーバのプロセスで1つ作る（E03 のログの抑えを要求をまたいで持つ）。
export interface DeviceApiContext {
  clock: Clock;
  logger: Logger;
  // NEXUS のオリジン（DD-09 の設定 NEXUS_ORIGIN）。
  origin: string;
  deviceKeys: DeviceKeyVerifier;
  deniedLog: DeniedLogLimiter;
}

export function createDeviceApiContext(deps: {
  clock: Clock;
  logger: Logger;
  origin: string;
  deviceKeys: DeviceKeyVerifier;
}): DeviceApiContext {
  return { ...deps, deniedLog: createDeniedLogLimiter(deps.clock) };
}

export interface DeviceRequestInfo {
  device: VerifiedDevice;
  requestId: string;
}

export interface DeviceApiOptions {
  // ログの `target`（FN の番号）。
  target?: string;
  // 状態の番号ごとの、この操作の MSG（DD-04 3.4。例: `setRead` の 500 は MSG-003）。
  messages?: Partial<Record<ApiErrorStatus, MessageRef>>;
}

export type DeviceApiHandler<C> = (
  request: Request,
  info: DeviceRequestInfo,
  routeContext: C,
) => Response | Promise<Response>;

// handler を P01 で包み、Route Handler の形にする。
export function deviceApi<C = unknown>(
  context: DeviceApiContext,
  handler: DeviceApiHandler<C>,
  options: DeviceApiOptions = {},
): (request: Request, routeContext: C) => Promise<Response> {
  return async (request, routeContext) => {
    const requestId = createRequestId();
    const { logger } = context;
    const mapping = {
      logger,
      requestId,
      target: options.target,
      messages: options.messages,
    };

    let key: string | null = null;
    let response: Response;
    try {
      key = readCookie(request, DEVICE_COOKIE_NAME);
      const result = context.deviceKeys.verify(key);
      if (!result.ok) {
        if (
          result.keyHash === null ||
          context.deniedLog.shouldLog(result.keyHash)
        ) {
          logger.log({
            level: logLevelOf("AUTH_DENIED"),
            code: "AUTH_DENIED",
            msg: "MSG-020",
            target: options.target,
            requestId,
          });
        }
        return errorResponse(401, "unauthorized", "MSG-020");
      }

      const { device } = result;
      if (result.lastUsedError !== undefined) {
        // 続けてよい失敗。分類を決めてログに出してから続ける（DD-06 1章）。
        const code =
          result.lastUsedError instanceof NexusError
            ? result.lastUsedError.code
            : "INTERNAL";
        logger.log({
          level: logLevelOf(code),
          code,
          target: options.target,
          requestId,
          deviceId: device.deviceId,
          detail: "端末の鍵の最後に使った日時を変えられない",
          error: result.lastUsedError,
        });
      }

      if (
        ORIGIN_CHECKED_METHODS.has(request.method.toUpperCase()) &&
        request.headers.get("origin") !== context.origin
      ) {
        logger.log({
          level: logLevelOf("ORIGIN_DENIED"),
          code: "ORIGIN_DENIED",
          msg: "MSG-019",
          target: options.target,
          requestId,
          deviceId: device.deviceId,
        });
        response = errorResponse(403, "forbidden_origin", "MSG-019");
      } else {
        try {
          response = await handler(
            request,
            { device, requestId },
            routeContext,
          );
        } catch (error) {
          response = toErrorResponse(error, mapping);
        }
      }
    } catch (error) {
      // 鍵を確かめる途中の失敗（DB が使えないなど）。鍵は通っていないので Cookie を付けない。
      return toErrorResponse(error, mapping);
    }

    return withDeviceCookie(response, key);
  };
}

// 応答に Cookie を付け直す。Response.redirect などの欄は変えられないので、写してから付ける。
function withDeviceCookie(response: Response, key: string | null): Response {
  if (key === null) return response;
  const copy = new Response(response.body, response);
  copy.headers.append("Set-Cookie", deviceCookie(key));
  return copy;
}
