import { readFileSync, statSync } from "node:fs";
import {
  RESEARCH_REPORT_MAX_BYTES,
  RESEARCH_SOURCE,
  checkResearchReportPayload,
} from "../../contracts/research";
import { type Clock, systemClock } from "../../server/shared/clock";
import { logLevelOf } from "../../server/shared/errors";
import { type Logger, createLogger } from "../../server/shared/logger";
import { formatMessage } from "../../server/shared/messages";

// 送信のコマンド `nexus-send`（DD-01 M34、DD-02 FN-028、DD-09 2.7。CR-020）。
//   nexus-send --source brain-research --kind research-report <ファイル>
// 引数 → ファイルの大きさ → JSON → 形（M10 の ResearchReportPayload）→ 環境変数 の順に確かめ（DD-02 2章 C11）、
// 最初の外れで MSG-049 を出して終了コード 2 で止める（送らない）。
// 通ったら NEXUS_SEND_URL の `/api/research/reports` に `Authorization: Bearer <鍵>` を付けて本文を POST する。
// 待つのは 30 秒まで。自動で送り直さない。鍵は出力とログに出さない（NFR-019）。
// 業務層とデータ層は使わず、M10 と M23 だけを使う（DD-01 M34）。

// 終了コード（DD-09 2.7）。
export const EXIT_ACCEPTED = 0;
export const EXIT_REFUSED = 1;
export const EXIT_NOT_SENT = 2;

// 待つ時間（DD-02 FN-028 手順 5、DD-09 2.7）。
export const SEND_TIMEOUT_MS = 30_000;

export const SEND_KIND = "research-report";
export const SEND_PATH = "/api/research/reports";

// MSG-049 の {項目} に使う、ファイルの引数の名前（DD-09 2.7 の書き方 `<ファイル>`）。
const FILE_ARGUMENT = "<ファイル>";

export interface SendOutput {
  out: (line: string) => void;
  err: (line: string) => void;
}

export interface SendCommandDeps {
  env: Readonly<Record<string, string | undefined>>;
  output: SendOutput;
  fetch?: typeof fetch;
  clock?: Clock;
  timeoutMs?: number;
}

type Checked =
  | { ok: true; body: string; url: string; key: string }
  | { ok: false; item: string };

interface Args {
  source?: string;
  kind?: string;
  file?: string;
}

// 引数を読む。知らない引数、値の無い `--source` と `--kind`、2つ目のファイルは、その引数を外れとする。
function parseArgs(argv: readonly string[]): Args | { invalid: string } {
  const args: Args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--source" || arg === "--kind") {
      const value = argv[i + 1];
      if (value === undefined) return { invalid: arg };
      if (arg === "--source") args.source = value;
      else args.kind = value;
      i += 1;
      continue;
    }
    if (arg.startsWith("-") || args.file !== undefined) return { invalid: arg };
    args.file = arg;
  }
  return args;
}

function isFile(path: string): number | null {
  try {
    const stat = statSync(path);
    return stat.isFile() ? stat.size : null;
  } catch {
    return null;
  }
}

function nonEmpty(value: string | undefined): string | null {
  return value === undefined || value === "" ? null : value;
}

// 送り先の道。NEXUS_SEND_URL は配信元の API の根（DD-09 2.7）。http か https の URL でなければ外れ。
function sendUrl(base: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(base);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  return `${base.replace(/\/+$/, "")}${SEND_PATH}`;
}

// 送る前の確かめ（DD-02 FN-028 手順 2〜4、2章 C11）。
function check(argv: readonly string[], env: SendCommandDeps["env"]): Checked {
  const args = parseArgs(argv);
  if ("invalid" in args) return { ok: false, item: args.invalid };
  if (args.source !== RESEARCH_SOURCE) return { ok: false, item: "--source" };
  if (args.kind !== SEND_KIND) return { ok: false, item: "--kind" };
  if (args.file === undefined) return { ok: false, item: FILE_ARGUMENT };
  const size = isFile(args.file);
  if (size === null) return { ok: false, item: FILE_ARGUMENT };

  if (size > RESEARCH_REPORT_MAX_BYTES) {
    return { ok: false, item: "全体の大きさ" };
  }
  let body: string;
  try {
    body = readFileSync(args.file, "utf8");
  } catch {
    return { ok: false, item: FILE_ARGUMENT };
  }
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return { ok: false, item: "本文" };
  }
  const shape = checkResearchReportPayload(payload);
  if (!shape.ok) return { ok: false, item: shape.field };

  const key = nonEmpty(env.NEXUS_SENDER_KEY);
  if (key === null) return { ok: false, item: "NEXUS_SENDER_KEY" };
  const base = nonEmpty(env.NEXUS_SEND_URL);
  const url = base === null ? null : sendUrl(base);
  if (url === null) return { ok: false, item: "NEXUS_SEND_URL" };
  return { ok: true, body, url, key };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function isTimeout(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "TimeoutError" || error.name === "AbortError")
  );
}

export async function runSendCommand(
  argv: readonly string[],
  deps: SendCommandDeps,
): Promise<number> {
  const { env, output } = deps;
  const checked = check(argv, env);
  if (!checked.ok) {
    output.err(formatMessage("MSG-049", { 項目: checked.item }));
    return EXIT_NOT_SENT;
  }

  const logger: Logger = createLogger({
    process: "cli",
    clock: deps.clock ?? systemClock,
    dir: nonEmpty(env.NEXUS_LOG_DIR),
  });
  const send = deps.fetch ?? fetch;
  const timeoutMs = deps.timeoutMs ?? SEND_TIMEOUT_MS;
  const signal = AbortSignal.timeout(timeoutMs);

  let status: number;
  let text: string;
  try {
    const response = await send(checked.url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${checked.key}`,
        "content-type": "application/json",
      },
      body: checked.body,
      signal,
    });
    status = response.status;
    text = await response.text();
  } catch (error) {
    // つながらないか 30 秒を超えた（DD-06 E18 `SEND_UNREACHABLE`。ログの重さは警告）。送り直さない。
    const reason = isTimeout(error)
      ? `${timeoutMs / 1000} 秒待っても答えがありませんでした`
      : "つながりませんでした";
    logger.log({
      level: logLevelOf("SEND_UNREACHABLE"),
      code: "SEND_UNREACHABLE",
      msg: "MSG-050",
      target: SEND_PATH,
      detail: "送り先につながらない（E18）",
      error,
    });
    output.err(formatMessage("MSG-050", { 理由: reason }));
    return EXIT_REFUSED;
  }

  const result = parseJson(text);
  if (status === 200) {
    output.out(formatMessage("MSG-031", { 配信元: RESEARCH_SOURCE, 件数: 1 }));
    if (isRecord(result)) {
      output.out(
        `topicId: ${String(result.topicId)} week: ${String(result.week)} replaced: ${String(result.replaced)}`,
      );
    }
    return EXIT_ACCEPTED;
  }

  // NEXUS が断った（4xx か 5xx）。応答の error.message（MSG-032〜MSG-034、MSG-046）を出す。
  const error = isRecord(result) ? result.error : undefined;
  const message =
    isRecord(error) && typeof error.message === "string"
      ? error.message
      : `NEXUS が状態 ${status} を返しました。`;
  output.err(message);
  return EXIT_REFUSED;
}
