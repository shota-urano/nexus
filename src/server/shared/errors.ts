import type { MessageId } from "./messages";

// エラーの分類と内部のエラーコード（DD-06 2章）。ログの重さは DD-06 5章の段階。

export type LogLevel = "info" | "warn" | "error" | "fatal";

export const ERROR_CLASSES = {
  E01: { code: "INPUT_INVALID", level: "info" },
  E02: { code: "INPUT_TOO_LARGE", level: "info" },
  E03: { code: "AUTH_DENIED", level: "warn" },
  E04: { code: "ORIGIN_DENIED", level: "warn" },
  E05: { code: "NOT_FOUND", level: "info" },
  E06: { code: "STATE_CONFLICT", level: "info" },
  E07: { code: "RULE_VIOLATION", level: "info" },
  E08: { code: "DB_UNAVAILABLE", level: "error" },
  E09: { code: "AI_TIMEOUT", level: "warn" },
  E10: { code: "AI_BAD_OUTPUT", level: "warn" },
  E11: { code: "AI_INTERRUPTED", level: "warn" },
  E12: { code: "AI_UNAVAILABLE", level: "error" },
  E13: { code: "AI_INPUT_TOO_LARGE", level: "error" },
  E14: { code: "BACKUP_TARGET_UNAVAILABLE", level: "error" },
  E15: { code: "BACKUP_CLEANUP_FAILED", level: "warn" },
  E16: { code: "INTERNAL", level: "error" },
  E17: { code: "STARTUP_MISMATCH", level: "fatal" },
} as const satisfies Record<string, { code: string; level: LogLevel }>;

export type ErrorClass = keyof typeof ERROR_CLASSES;
export type ErrorCode = (typeof ERROR_CLASSES)[ErrorClass]["code"];

const CLASS_OF_CODE = Object.fromEntries(
  Object.entries(ERROR_CLASSES).map(([klass, { code }]) => [code, klass]),
) as Record<ErrorCode, ErrorClass>;

export function errorClassOf(code: ErrorCode): ErrorClass {
  return CLASS_OF_CODE[code];
}

export function logLevelOf(code: ErrorCode): LogLevel {
  return ERROR_CLASSES[errorClassOf(code)].level;
}

export interface NexusErrorOptions {
  // 利用者に見せる MSG（あれば）。内部のエラーコードと理由は画面と API に出さない（DD-06 1章）。
  msg?: MessageId;
  cause?: unknown;
}

// NEXUS のエラーの型。message は内部の短い理由で、ログと `failure_reason` にだけ使う。
export class NexusError extends Error {
  readonly code: ErrorCode;
  readonly msg: MessageId | undefined;

  constructor(
    code: ErrorCode,
    message: string,
    options: NexusErrorOptions = {},
  ) {
    super(
      message,
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = "NexusError";
    this.code = code;
    this.msg = options.msg;
  }

  get errorClass(): ErrorClass {
    return errorClassOf(this.code);
  }

  get level(): LogLevel {
    return logLevelOf(this.code);
  }
}
