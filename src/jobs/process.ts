import { type BackupResult, type RunBackupDeps, runBackup } from "./backup";
import { type JobName, createJobLock, openJobDatabase } from "./lock";
import { type Clock, systemClock } from "../server/shared/clock";
import { type Config, loadConfig } from "../server/shared/config";
import { NexusError } from "../server/shared/errors";
import {
  type Logger,
  createLogger,
  describeError,
} from "../server/shared/logger";
import { type MessageId, formatMessage } from "../server/shared/messages";

// 定期ジョブの入口（DD-01 M27。DD-02 FN-021 手順 1、DD-05 4章、BD-02 5.4）。
// launchd も本人の手も、同じ入口で `node dist/jobs/main.js <バッチの名前>` と動かす（DD-09 2.6）。
// 1. 起動の引数でバッチを決める。設定を読み（DD-09 2.3）、DB の `schema_migration` の番号を確かめる（DD-03 5章）。
// 2. M31 で多重起動の印を取る。同じバッチが動いていたら、何もせずにログに残し、終了コード 0 で終わる。
// 3. 開始をログに出し、バッチを動かし、件数と結果をログに出す。
// 4. 印を消し（異常で終わるときも）、終了をログに出し、終了コード（0、1、2）を返す。
// ログを書けないときは、標準エラーに出して続け（印は必ず消す）、終了コードを 2 にする（DD-05 4章、BD-02 5.4）。

type Env = Readonly<Record<string, string | undefined>>;

// 終了コード（BD-02 5.4 リターンコード）。
export const EXIT_OK = 0;
export const EXIT_WARNING = 1;
export const EXIT_ERROR = 2;

export interface RunJobProcessOptions {
  env: Env;
  clock?: Clock;
  // ログの関数が使えないとき（引数が違う、設定が読めない）の出し先。launchd の標準エラーのファイル（DD-09 2.6）。
  stderr?: (line: string) => void;
  // 印に書くプロセスの番号。省くとこのプロセスの番号。試験で、2つのプロセスの代わりに渡す（DD-10 TC118）。
  pid?: number;
  // `schema_migration` と比べる番号。試験で、番号の違うプロセスの代わりに渡す。
  knownVersion?: number;
  // BAT-001 の写し方。試験で写している間を作るときに渡す（DD-10 TC89）。
  backupCopy?: RunBackupDeps["copy"];
}

interface JobContext {
  db: RunBackupDeps["db"];
  clock: Clock;
  config: Config;
  logger: Logger;
  options: RunJobProcessOptions;
}

interface JobDefinition {
  // ログの target に書く番号（BD-02 5.1）。
  target: string;
  title: string;
  // 予期しない失敗と DB の失敗のときに出す MSG（DD-06 E08、E16 のバッチ）。
  failureMsg: MessageId;
  run(context: JobContext): Promise<number>;
}

const JOBS: Partial<Record<JobName, JobDefinition>> = {
  backup: {
    target: "BAT-001",
    title: "データのバックアップ",
    failureMsg: "MSG-039",
    run: runBackupJob,
  },
};

function jobOf(name: string | undefined): [JobName, JobDefinition] | null {
  if (name === undefined || !Object.hasOwn(JOBS, name)) return null;
  const job = JOBS[name as JobName];
  return job === undefined ? null : [name as JobName, job];
}

export async function runJobProcess(
  argv: readonly string[],
  options: RunJobProcessOptions,
): Promise<number> {
  const clock = options.clock ?? systemClock;
  const stderr =
    options.stderr ?? ((line: string) => process.stderr.write(`${line}\n`));
  const pid = options.pid ?? process.pid;

  const found = argv.length === 1 ? jobOf(argv[0]) : null;
  if (found === null) {
    stderr(`使い方: ${Object.keys(JOBS).join("|")}`);
    return EXIT_ERROR;
  }
  const [name, job] = found;

  let config: Config;
  try {
    config = loadConfig(options.env);
  } catch (error) {
    stderr(`NEXUS の定期ジョブを起動できない: ${reasonOf(error)}`);
    return EXIT_ERROR;
  }
  const logger = guardLogger(
    createLogger({ process: "job", clock, dir: config.logDir }),
    job,
    stderr,
  );
  const exitCode = await runJob(name, job, {
    clock,
    config,
    logger,
    options,
    pid,
  });
  return logger.failed() ? EXIT_ERROR : exitCode;
}

async function runJob(
  name: JobName,
  job: JobDefinition,
  context: {
    clock: Clock;
    config: Config;
    logger: Logger;
    options: RunJobProcessOptions;
    pid: number;
  },
): Promise<number> {
  const { clock, config, logger, options, pid } = context;

  let db: JobContext["db"];
  try {
    db = openJobDatabase({
      dataDir: config.dataDir,
      knownVersion: options.knownVersion,
    });
  } catch (error) {
    // `schema_migration` の番号が違う（E17）ときは、プロセスが動き出さない（MSG は無い。DD-06 E17）。
    if (error instanceof NexusError && error.code === "STARTUP_MISMATCH") {
      logger.log({
        level: error.level,
        code: error.code,
        target: job.target,
        detail: `${job.target} を起動できない`,
        error,
      });
    } else {
      // DB を開けない（E08 の SQLITE_CANTOPEN など）か予期しない失敗（E16）。MSG-039 と終了コード 2（DD-06 2章）。
      logFailure(logger, job, error);
    }
    return EXIT_ERROR;
  }

  try {
    const lock = createJobLock({ db, clock });
    let acquired: ReturnType<typeof lock.acquire>;
    try {
      acquired = lock.acquire(name, pid);
    } catch (error) {
      logFailure(logger, job, error);
      return EXIT_ERROR;
    }
    if (!acquired.acquired) {
      logger.log({
        level: "info",
        target: job.target,
        detail: `${job.target} はプロセス ${acquired.holderPid} で動いているので、何もせずに終わる`,
      });
      return EXIT_OK;
    }

    let exitCode = EXIT_ERROR;
    try {
      logger.log({
        level: "info",
        target: job.target,
        detail: `${job.target} ${job.title}を始めた`,
      });
      exitCode = await job.run({ db, clock, config, logger, options });
    } catch (error) {
      logFailure(logger, job, error);
      exitCode = EXIT_ERROR;
    } finally {
      // 異常で終わるときも、自分の番号の印だけを消す（DD-05 4章）。
      try {
        lock.release(name, pid);
      } catch (error) {
        logFailure(logger, job, error);
        exitCode = EXIT_ERROR;
      }
    }
    logger.log({
      level: "info",
      target: job.target,
      detail: `${job.target} ${job.title}を終えた（終了コード ${exitCode}）`,
    });
    return exitCode;
  } finally {
    db.close();
  }
}

// BAT-001（DD-02 FN-021 手順 2〜7）。M28 の結果を、ログと終了コードに変える（DD-06 E14、E15）。
async function runBackupJob(context: JobContext): Promise<number> {
  const { db, clock, config, logger, options } = context;
  const result: BackupResult = await runBackup({
    db,
    clock,
    backupDir: config.backupDir,
    copy: options.backupCopy,
  });
  const target = "BAT-001";
  switch (result.kind) {
    case "done":
      logger.log({
        level: "info",
        msg: "MSG-038",
        target,
        detail: `${formatMessage("MSG-038", { 置き場所: result.path })} 写しの大きさ ${result.size} バイト。古い写しを ${result.removed} 件消した`,
      });
      return EXIT_OK;
    case "cleanup_failed":
      logger.log({
        level: "warn",
        code: "BACKUP_CLEANUP_FAILED",
        msg: "MSG-039",
        target,
        detail: `${formatMessage("MSG-039", { 理由: "古い写しを消せない" })} 今日の写し ${result.path}（${result.size} バイト）は残した。古い写しを ${result.removed} 件消し、${result.failed.length} 件消せなかった（${result.failed.join("、")}）`,
        error: result.error,
      });
      return EXIT_WARNING;
    case "failed":
      logger.log({
        level: "error",
        code: result.code,
        msg: "MSG-039",
        target,
        detail: formatMessage("MSG-039", { 理由: result.reason }),
        error: result.error,
      });
      return EXIT_ERROR;
  }
}

// ログを書けない（置き場所が使えないなど）ときも、印を消して終わるために、例外を外に出さない。
// 書けなかったことを標準エラー（launchd の標準エラーのファイル。DD-09 2.6）に出し、終了コードを 2 にする。
// 標準エラーには、書けなかった行の中身を出さず、行の level・code・msg・target と原因の種類だけを出す。
function guardLogger(
  logger: Logger,
  job: JobDefinition,
  stderr: (line: string) => void,
): Logger & { failed(): boolean } {
  let failed = false;
  return {
    log(entry) {
      try {
        logger.log(entry);
      } catch (error) {
        failed = true;
        const fields = [entry.level, entry.code, entry.msg, entry.target]
          .filter((value) => value !== undefined)
          .join(" ");
        try {
          stderr(
            `NEXUS の定期ジョブ ${job.target} のログを書けない（${fields}）: ${describeError(error)}`,
          );
        } catch {
          // 標準エラーにも出せないときは、終了コード 2 だけで知らせる。
        }
      }
    },
    failed: () => failed,
  };
}

// DB が使えない（E08）か予期しない失敗（E16）。バッチは MSG を出して終了コード 2（DD-06 2章）。
function logFailure(logger: Logger, job: JobDefinition, error: unknown): void {
  const code =
    error instanceof NexusError && error.code === "DB_UNAVAILABLE"
      ? "DB_UNAVAILABLE"
      : "INTERNAL";
  const reason = code === "DB_UNAVAILABLE" ? "DB が使えない" : "予期しない失敗";
  logger.log({
    level: "error",
    code,
    msg: job.failureMsg,
    target: job.target,
    detail: formatMessage(job.failureMsg, { 理由: reason }),
    error,
  });
}

// NexusError の文は内部の短い理由で、鍵と本文を含まない（DD-06 1章）。
function reasonOf(error: unknown): string {
  return error instanceof NexusError
    ? `${error.code}: ${error.message}`
    : "INTERNAL";
}
