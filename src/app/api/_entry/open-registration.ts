import type { Devices } from "../../../server/auth/devices";
import { logLevelOf } from "../../../server/shared/errors";
import type { Logger } from "../../../server/shared/logger";
import { createRequestId } from "../../../server/shared/secret";
import { deviceCookie } from "./device-api";
import { toErrorResponse } from "./errors";

// 登録の URL を開く `openRegistration`（GET `/register?code=…`。DD-01 M11、DD-02 FN-023 手順 2、DD-04）。
// 端末の鍵は求めない。登録コードが有効な期限の前で、まだ使っていなければ端末を作り、
// 3章 P01 の属性の Cookie で端末の鍵を渡して `/` へ移す。登録できなければ Cookie を渡さず、
// `/?notice=MSG-021` へ移す（DD-04 3.1、DD-06 E03）。

const TARGET = "FN-023";
// `openapi.yaml` の `code` の長さの上限。
const CODE_MAX_LENGTH = 200;
export const REGISTRATION_FAILED_LOCATION = "/?notice=MSG-021";

export interface OpenRegistrationContext {
  logger: Logger;
  devices: Pick<Devices, "register">;
}

function seeOther(location: string, cookie?: string): Response {
  const headers = new Headers({ Location: location });
  if (cookie !== undefined) headers.append("Set-Cookie", cookie);
  return new Response(null, { status: 303, headers });
}

export function openRegistration(
  context: OpenRegistrationContext,
): (request: Request) => Promise<Response> {
  return async (request) => {
    const requestId = createRequestId();
    const { logger } = context;
    try {
      const code = new URL(request.url).searchParams.get("code");
      if (code === null || code === "" || code.length > CODE_MAX_LENGTH) {
        // 形が違うコードは、照合値で見つからないコードと同じに扱う（DD-04 3.1）。
        logger.log({
          level: logLevelOf("INPUT_INVALID"),
          code: "INPUT_INVALID",
          msg: "MSG-021",
          target: TARGET,
          requestId,
        });
        return seeOther(REGISTRATION_FAILED_LOCATION);
      }

      const result = context.devices.register(code);
      if (!result.ok) {
        const errorCode =
          result.reason === "name_taken" ? "RULE_VIOLATION" : "AUTH_DENIED";
        logger.log({
          level: logLevelOf(errorCode),
          code: errorCode,
          msg: "MSG-021",
          target: TARGET,
          requestId,
        });
        return seeOther(REGISTRATION_FAILED_LOCATION);
      }
      return seeOther("/", deviceCookie(result.key));
    } catch (error) {
      // DB が使えないなど（DD-06 E08、E16）。500 `internal`（DD-04 3.4）。
      return toErrorResponse(error, { logger, requestId, target: TARGET });
    }
  };
}
