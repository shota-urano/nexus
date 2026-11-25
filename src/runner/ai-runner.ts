import type { AiQueue, PickedRun } from "../server/ai-jobs";
import type { Logger } from "../server/shared/logger";

// AI Runner の拾う処理（DD-01 M24。DD-02 3章 P06 手順 2）。
// 空いている枠（同時に2つまで。NFR-017）に M20 から実行を拾わせ、M25 に渡す。

// 同時に動かす実行の数（NFR-017）。
export const AI_RUNNER_SLOTS = 2;
// 拾う間隔（DD-02 3章 P06 手順 2）。
export const AI_RUNNER_POLL_MS = 500;

export interface AiRunnerOptions {
  queue: AiQueue;
  // M25 の実行する（実行 → 完了、失敗、中止）。
  execute(run: PickedRun): Promise<void>;
  logger: Logger;
  slots?: number;
  pollIntervalMs?: number;
}

export interface AiRunner {
  // 空いている枠の数だけ拾って動かし、拾った実行が全て終わるまで待つ。
  runOnce(): Promise<void>;
  // 500 ミリ秒ごとに拾い始める。
  start(): void;
  // 拾うのをやめ、動いている実行が終わるまで待つ。
  stop(): Promise<void>;
  // 動いている実行の数。
  running(): number;
}

export function createAiRunner(options: AiRunnerOptions): AiRunner {
  const { queue, execute, logger } = options;
  const slots = options.slots ?? AI_RUNNER_SLOTS;
  const pollIntervalMs = options.pollIntervalMs ?? AI_RUNNER_POLL_MS;
  const inFlight = new Set<Promise<void>>();
  let timer: ReturnType<typeof setInterval> | null = null;

  // 処理中の数が枠の数より少ない間、M20 で次を拾い、M25 に渡す。拾った実行の終わりを返す。
  const fill = (): Promise<void>[] => {
    const started: Promise<void>[] = [];
    while (inFlight.size < slots) {
      let run: PickedRun | null;
      try {
        run = queue.pickNext();
      } catch (error) {
        logger.log({
          level: "error",
          detail: "AI の実行を拾えなかった",
          error,
        });
        break;
      }
      if (run === null) break;
      const picked = run;
      const task = execute(picked)
        .catch((error: unknown) => {
          logger.log({
            level: "error",
            aiRunId: picked.aiRunId,
            detail: "AI の実行の処理が失敗した",
            error,
          });
        })
        .finally(() => {
          inFlight.delete(task);
        });
      inFlight.add(task);
      started.push(task);
    }
    return started;
  };

  return {
    async runOnce() {
      await Promise.all(fill());
    },
    start() {
      if (timer !== null) return;
      fill();
      timer = setInterval(fill, pollIntervalMs);
    },
    async stop() {
      if (timer !== null) clearInterval(timer);
      timer = null;
      await Promise.all([...inFlight]);
    },
    running: () => inFlight.size,
  };
}
