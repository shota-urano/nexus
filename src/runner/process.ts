import { type Clock, systemClock } from "../server/shared/clock";
import { createAiRunner, failInterruptedRuns } from "./ai-runner";
import { createPurposesFromConfig } from "./purposes";
import { type BootAiRunnerOptions, bootAiRunner } from "./startup";

// AI Runner のプロセスの流れ（DD-01 M24。launchd が `node dist/runner/main.js` で起動する。DD-09 2.6）。
// 1. 起動の確かめ（設定と `schema_migration` の番号。DD-03 5章、DD-06 E17）。合わなければ終了コード 1 で終わる。
// 2. 処理中のまま残った実行を失敗にし、失敗の扱いを当てる（DD-02 3章 P06 手順 1。NFR-005）。
// 3. 拾い始める（P06 手順 2）。
// 4. 止める求め（launchd の SIGTERM）が来たら、拾うのをやめ、動いている実行が終わるのを待って、終了コード 0 で終わる。

export interface RunAiRunnerProcessOptions {
  env: BootAiRunnerOptions["env"];
  stderr?: BootAiRunnerOptions["stderr"];
  clock?: Clock;
  // 止める求めが来たら解決する。
  stopRequested: Promise<void>;
}

export async function runAiRunnerProcess(
  options: RunAiRunnerProcessOptions,
): Promise<number> {
  const clock = options.clock ?? systemClock;
  const boot = bootAiRunner({
    env: options.env,
    clock,
    stderr: options.stderr,
  });
  if (!boot.ok) return boot.exitCode;
  const { config, logger, aiJobs } = boot;

  try {
    const purposes = createPurposesFromConfig(config, {
      db: aiJobs.db,
      clock,
      logger,
    });
    const interrupted = failInterruptedRuns({
      queue: aiJobs.queue,
      fail: purposes.fail,
    });
    const runner = createAiRunner({
      queue: aiJobs.queue,
      execute: purposes.execute,
      logger,
    });
    runner.start();
    logger.log({
      level: "info",
      detail: `AI Runner を起動した（途中で止まった実行 ${interrupted} 件を失敗にした）`,
    });

    await options.stopRequested;
    await runner.stop();
    logger.log({ level: "info", detail: "AI Runner を止めた" });
    return 0;
  } finally {
    aiJobs.close();
  }
}
