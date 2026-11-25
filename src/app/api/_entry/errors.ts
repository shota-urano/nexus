import {
  NexusError,
  errorClassOf,
  type ErrorClass,
  type ErrorCode,
} from "../../../server/shared/errors";
import type { Logger } from "../../../server/shared/logger";
import {
  formatMessage,
  type MessageId,
  type MessageValues,
} from "../../../server/shared/messages";

// エラーから状態の番号と MSG への変換（DD-01 M11。DD-04 3.4、DD-06 2章）。
// 応答の形は `openapi.yaml` の `Error`（`{ "error": { "code", "message", "messageId" } }`）。
// 内部のエラーコードと理由は応答に入れず、ログにだけ出す（DD-06 1章）。

export type ApiErrorCode =
  | "bad_request"
  | "unauthorized"
  | "forbidden_origin"
  | "not_found"
  | "reply_in_progress"
  | "payload_too_large"
  | "internal";

export type ApiErrorStatus = 400 | 401 | 403 | 404 | 409 | 413 | 500;

interface StatusAndCode {
  status: ApiErrorStatus;
  code: ApiErrorCode;
}

const INTERNAL: StatusAndCode = { status: 500, code: "internal" };

// DD-04 3.4 の表の「分類（DD-06）」の列から引く。表に無い分類（AI、バックアップ、起動の分類）は
// Web サーバの応答では起きないはずのものなので、予期しない失敗（500 `internal`）として返す。
const STATUS_OF_CLASS: Partial<Record<ErrorClass, StatusAndCode>> = {
  E01: { status: 400, code: "bad_request" },
  E02: { status: 413, code: "payload_too_large" },
  E03: { status: 401, code: "unauthorized" },
  E04: { status: 403, code: "forbidden_origin" },
  E05: { status: 404, code: "not_found" },
  E06: { status: 409, code: "reply_in_progress" },
  E07: { status: 400, code: "bad_request" },
  E08: INTERNAL,
  E16: INTERNAL,
};

export function statusOfErrorCode(code: ErrorCode): StatusAndCode {
  return STATUS_OF_CLASS[errorClassOf(code)] ?? INTERNAL;
}

// 差し込む値のある MSG は値と組にして渡す。
export type MessageRef = MessageId | { id: MessageId; values?: MessageValues };

// 端末の API の状態の番号ごとの MSG（DD-04 3.4 の「画面で出す MSG」）。
// 操作ごとに違う MSG（`getArticle` の 404 は MSG-002、`setRead` の 500 は MSG-003 など）は、
// handler が ErrorMappingOptions の messages で渡すか、NexusError の msg で渡す。
const DEVICE_API_MESSAGES: Record<ApiErrorStatus, MessageId> = {
  400: "MSG-019",
  401: "MSG-020",
  403: "MSG-019",
  404: "MSG-019",
  409: "MSG-019",
  413: "MSG-019",
  500: "MSG-019",
};

export interface ErrorMappingOptions {
  logger: Logger;
  requestId: string;
  // ログの `target`（FN、IF の番号）。
  target?: string;
  // 状態の番号ごとの、この操作の MSG（DD-04 3.4）。
  messages?: Partial<Record<ApiErrorStatus, MessageRef>>;
}

// エラーの本文を作る。
export function errorResponse(
  status: ApiErrorStatus,
  code: ApiErrorCode,
  message: MessageRef,
): Response {
  const { id, values } =
    typeof message === "string" ? { id: message, values: undefined } : message;
  return Response.json(
    {
      error: { code, message: formatMessage(id, values), messageId: id },
    },
    { status },
  );
}

// handler が投げた例外を、ログに出してから DD-04 3.4 の応答に変える。
// NexusError でない例外は DD-06 E16（予期しない失敗）として扱う。
export function toErrorResponse(
  error: unknown,
  options: ErrorMappingOptions,
): Response {
  const nexusError = error instanceof NexusError ? error : null;
  const errorCode: ErrorCode = nexusError?.code ?? "INTERNAL";
  const { status, code } = statusOfErrorCode(errorCode);
  const message: MessageRef =
    nexusError?.msg ??
    options.messages?.[status] ??
    DEVICE_API_MESSAGES[status];
  const msgId = typeof message === "string" ? message : message.id;

  options.logger.log({
    level: nexusError?.level ?? "error",
    code: errorCode,
    msg: msgId,
    target: options.target,
    requestId: options.requestId,
    error,
  });
  return errorResponse(status, code, message);
}
