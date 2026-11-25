import { type OpenedAiJobs, openAiJobs } from "../../../server/ai-jobs";
import { createDevices, type Devices } from "../../../server/auth/devices";
import { type Clock, systemClock } from "../../../server/shared/clock";
import { loadConfig } from "../../../server/shared/config";
import { NexusError } from "../../../server/shared/errors";
import { createLogger, type Logger } from "../../../server/shared/logger";

// Web サーバのプロセスが使う部品（DD-01 M11）。設定を環境変数から読み（DD-09 2.3）、
// NEXUS_DATA_DIR の DB を開く。
// 起動のとき（src/instrumentation.ts）に作り、まだ当てていないマイグレーションを全て当ててから
// 要求を受け付ける（DD-03 5章、DD-09 2.1）。あとの要求は同じものを使う。
// 設定が読めないか、マイグレーションを当てられなければ（DD-06 E17、E08）作らずに投げ、
// 次の要求でもう一度作る。

type Env = Readonly<Record<string, string | undefined>>;

export interface WebContext {
  logger: Logger;
  devices: Devices;
  aiJobs: OpenedAiJobs;
}

let context: WebContext | null = null;

export function webContext(): WebContext {
  if (context === null) context = createWebContext(process.env);
  return context;
}

// 部品を作る。DB を1つだけ開き（DD-01 2.1 M21 の接続はプロセスごとに1つ）、マイグレーションを当ててから
// （DD-03 5章）、端末の部品も同じ接続を使う。
// 失敗したら、ログに出せるときはログに出し（DD-06 E17 は致命的）、開いた DB を閉じて投げる。
export function createWebContext(
  env: Env,
  clock: Clock = systemClock,
): WebContext {
  const config = loadConfig(env);
  const logger = createLogger({ process: "web", clock, dir: config.logDir });
  let aiJobs: OpenedAiJobs | null = null;
  try {
    aiJobs = openAiJobs({ dataDir: config.dataDir, clock, startup: "migrate" });
    const devices = createDevices({ db: aiJobs.db, clock });
    return { logger, devices, aiJobs };
  } catch (error) {
    aiJobs?.close();
    const code = error instanceof NexusError ? error.code : "INTERNAL";
    logger.log({
      level: error instanceof NexusError ? error.level : "error",
      code,
      detail: "Web サーバを起動できない",
      error,
    });
    throw error;
  }
}
