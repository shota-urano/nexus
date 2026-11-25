import { appendFileSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { Clock } from "./clock";
import { daysBetween, formatDate, formatDateTime } from "./datetime";
import { NexusError, type ErrorCode, type LogLevel } from "./errors";
import type { MessageId } from "./messages";

// ログの関数（DD-06 5章、DD-09 2.6。CR-013）。
// 1行に1つの JSON を、`<置き場所>/<プロセスの名前>-YYYY-MM-DD.log` に書く。
// 日が替わったら新しいファイルに書き、30 日より古い日のファイルを消す（NFR-025）。
// 置き場所が無い（開発）ときは標準出力に出す（DD-09 2.2）。

export type ProcessName = "web" | "runner" | "job" | "cli";

// 対象の ID（DD-06 5章）。数だけを受け、文を混ぜられないようにする。
export interface LogTargetIds {
  aiRunId?: number;
  contentId?: number;
  conversationId?: number;
  messageId?: number;
  deliveryId?: number;
  deviceId?: number;
}

// 残す項目（DD-06 5章）。ここに無い項目は書かない。鍵、照合値、本文を渡す欄は作らない。
export interface LogEntry extends LogTargetIds {
  level: LogLevel;
  code?: ErrorCode;
  msg?: MessageId;
  target?: string;
  requestId?: string;
  // 原因の詳細（例外の種類と文、SQLite のエラーの名前）。
  detail?: string;
  // 原因の例外。種類と文だけを detail に入れ、例外が持つほかの値は書かない。
  error?: unknown;
}

export interface Logger {
  log(entry: LogEntry): void;
}

export interface LoggerOptions {
  process: ProcessName;
  clock: Clock;
  // null なら標準出力に出す。
  dir: string | null;
  // 残す日数。この日数より古い日のファイルを消す。
  keepDays?: number;
}

const KEEP_DAYS = 30;
const ID_KEYS = [
  "aiRunId",
  "contentId",
  "conversationId",
  "messageId",
  "deliveryId",
  "deviceId",
] as const satisfies readonly (keyof LogTargetIds)[];

// 鍵の形（43 文字の base64url）と、`sk-` で始まる文字列を伏せる（DD-06 5章、NFR-019）。
const SECRET_PATTERNS = [
  /(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/g,
  /(?<![A-Za-z0-9_-])sk-[A-Za-z0-9_-]*/g,
];
export const REDACTED = "[REDACTED]";

export function redact(text: string): string {
  return SECRET_PATTERNS.reduce(
    (result, pattern) => result.replace(pattern, REDACTED),
    text,
  );
}

export function createLogger(options: LoggerOptions): Logger {
  const { process: processName, clock, dir } = options;
  const keepDays = options.keepDays ?? KEEP_DAYS;
  let currentDate: string | null = null;

  const write = (line: string, date: string) => {
    if (dir === null) {
      process.stdout.write(`${line}\n`);
      return;
    }
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, `${processName}-${date}.log`), `${line}\n`);
  };

  // 日が替わったときの処理: 古い日のファイルを消す。消せなくても書くことは続け、警告をログに残す。
  const removeOldFiles = (today: string, at: Date) => {
    if (dir === null) return;
    const pattern = new RegExp(`^${processName}-(\\d{4}-\\d{2}-\\d{2})\\.log$`);
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch (error) {
      if (isNotFound(error)) return;
      write(
        format(
          { level: "warn", detail: "古いログのファイルを探せない", error },
          at,
        ),
        today,
      );
      return;
    }
    for (const name of names) {
      const fileDate = pattern.exec(name)?.[1];
      if (fileDate === undefined) continue;
      const age = daysBetween(fileDate, today);
      if (age === null || age <= keepDays) continue;
      try {
        unlinkSync(join(dir, name));
      } catch (error) {
        write(
          format(
            {
              level: "warn",
              detail: `古いログのファイル ${name} を消せない`,
              error,
            },
            at,
          ),
          today,
        );
      }
    }
  };

  const format = (entry: LogEntry, at: Date): string => {
    const line: Record<string, string | number> = {
      at: formatDateTime(at),
      level: entry.level,
      process: processName,
    };
    if (entry.code !== undefined) line.code = entry.code;
    if (entry.msg !== undefined) line.msg = entry.msg;
    if (entry.target !== undefined) line.target = redact(entry.target);
    if (entry.requestId !== undefined) line.requestId = redact(entry.requestId);
    for (const key of ID_KEYS) {
      const value = entry[key];
      if (typeof value === "number" && Number.isFinite(value))
        line[key] = value;
    }
    const detail = [entry.detail, describeError(entry.error)]
      .filter(Boolean)
      .join(" / ");
    if (detail !== "") line.detail = redact(detail);
    return JSON.stringify(line);
  };

  return {
    log(entry) {
      const at = clock.now();
      const today = formatDate(at);
      if (today !== currentDate) {
        currentDate = today;
        removeOldFiles(today, at);
      }
      write(format(entry, at), today);
    },
  };
}

// 例外の種類と文だけを取り出す。SQLite の例外はエラーの名前（errstr）も足す。
function describeError(error: unknown): string {
  if (error === undefined) return "";
  // 例外でない値は中身を書かない（本文が入っていることがあるため）。
  if (!(error instanceof Error)) return `例外でない値（${typeof error}）`;
  const kind =
    error instanceof NexusError ? `${error.name}(${error.code})` : error.name;
  const errstr = (error as { errstr?: unknown }).errstr;
  const sqlite = typeof errstr === "string" ? ` [${errstr}]` : "";
  return `${kind}: ${error.message}${sqlite}`;
}

function isNotFound(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === "ENOENT";
}
