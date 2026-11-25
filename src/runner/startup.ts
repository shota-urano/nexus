import { type OpenedAiJobs, openAiJobs } from "../server/ai-jobs";
import { type Clock, systemClock } from "../server/shared/clock";
import { type Config, loadConfig } from "../server/shared/config";
import { NexusError } from "../server/shared/errors";
import { createLogger, type Logger } from "../server/shared/logger";

// AI Runner の起動のときの確かめ（DD-01 M24、DD-03 5章、DD-06 E17）。
// 設定を読み（DD-09 2.3）、DB の `schema_migration` の最後の番号が、このプロセスの知る番号と同じかを確かめる。
// 違えば何もせずにログに残して終わる（終了コード 1）。launchd が起動し直す（BD-01 4章）。
// マイグレーションは当てない（当てるのは Web サーバだけ。DD-03 5章）。

type Env = Readonly<Record<string, string | undefined>>;

// 起動の条件が合わないときの終了コード。
export const STARTUP_FAILED_EXIT_CODE = 1;

export interface BootAiRunnerOptions {
  env: Env;
  clock?: Clock;
  // 試験で、番号の違う AI Runner の代わりに渡す（DD-10 TC108）。
  knownVersion?: number;
  // ログの関数が使えないとき（設定が読めない）の出し先。launchd の標準エラーのファイル（DD-09 2.6）。
  stderr?: (line: string) => void;
}

export type BootAiRunnerResult =
  | { ok: true; config: Config; logger: Logger; aiJobs: OpenedAiJobs }
  | { ok: false; exitCode: number };

export function bootAiRunner(options: BootAiRunnerOptions): BootAiRunnerResult {
  const clock = options.clock ?? systemClock;
  const stderr =
    options.stderr ?? ((line: string) => process.stderr.write(`${line}\n`));

  let config: Config;
  try {
    config = loadConfig(options.env);
  } catch (error) {
    stderr(`NEXUS の AI Runner を起動できない: ${reasonOf(error)}`);
    return { ok: false, exitCode: STARTUP_FAILED_EXIT_CODE };
  }
  const logger = createLogger({ process: "runner", clock, dir: config.logDir });

  try {
    const aiJobs = openAiJobs({
      dataDir: config.dataDir,
      clock,
      startup: "check",
      knownVersion: options.knownVersion,
    });
    return { ok: true, config, logger, aiJobs };
  } catch (error) {
    logger.log({
      level: error instanceof NexusError ? error.level : "error",
      code: error instanceof NexusError ? error.code : "INTERNAL",
      detail: "AI Runner を起動できない",
      error,
    });
    return { ok: false, exitCode: STARTUP_FAILED_EXIT_CODE };
  }
}

// NexusError の文は内部の短い理由で、鍵と本文を含まない（DD-06 1章）。
function reasonOf(error: unknown): string {
  return error instanceof NexusError
    ? `${error.code}: ${error.message}`
    : "INTERNAL";
}
