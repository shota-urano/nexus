import type { AiQueue, PickedRun } from "../server/ai-jobs";
import { NexusError } from "../server/shared/errors";
import type { Logger } from "../server/shared/logger";
import type { ExecuteContext } from "./purposes/context";
import { RunStopRequested, timeoutError } from "./purposes/outcome";

// AI Runner の拾う処理（DD-01 M24。DD-02 3章 P06 手順 2、3）。
// 空いている枠（同時に2つまで。NFR-017）に M20 から実行を拾わせ、M25 に渡す。

// 同時に動かす実行の数（NFR-017）。
export const AI_RUNNER_SLOTS = 2;
// 拾う間隔（DD-02 3章 P06 手順 2）。
export const AI_RUNNER_POLL_MS = 500;
// 1回の実行の時間の上限（NFR-017。DD-02 3章 P06 手順 3）。
export const AI_RUN_TIMEOUT_MS = 5 * 60 * 1000;
// 止める求め（`stop_requested`）を読む間隔（DD-02 3章 P06 手順 3）。
export const AI_RUN_STOP_CHECK_MS = 1000;

export interface AiRunnerOptions {
  queue: AiQueue;
  // M25 の実行する（実行 → 完了、失敗、中止）。
  execute(run: PickedRun, context: ExecuteContext): Promise<void>;
  logger: Logger;
  slots?: number;
  pollIntervalMs?: number;
  // 時間の上限。テストでは小さい値にする（DD-10 TC15）。
  timeoutMs?: number;
  // 止める求めを読む間隔。テストでは小さい値にする。
  stopCheckIntervalMs?: number;
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
  const timeoutMs = options.timeoutMs ?? AI_RUN_TIMEOUT_MS;
  const stopCheckIntervalMs =
    options.stopCheckIntervalMs ?? AI_RUN_STOP_CHECK_MS;
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
      // 見張る（DD-02 3章 P06 手順 3）: 拾った実行ごとに時計を持ち、上限を超えたら
      // 止める合図を送る。M26 が CLI を止め、M25 が失敗（E09）にする。
      const controller = new AbortController();
      const timer = setTimeout(() => {
        controller.abort(timeoutError());
      }, timeoutMs);
      // 止める求めを 1 秒ごとに読み、1 なら止める合図を送る。M26 が CLI を止め、M25 が中止にする
      // （answer の発言も中止にし、本文は残す）。読めなかった回は、次の回にもう一度読む。
      const watcher = setInterval(() => {
        if (controller.signal.aborted) return;
        try {
          if (queue.isStopRequested(picked.aiRunId)) {
            controller.abort(new RunStopRequested());
          }
        } catch (error) {
          logger.log({
            level: "warn",
            aiRunId: picked.aiRunId,
            detail: "止める求めを読めなかった",
            error,
          });
        }
      }, stopCheckIntervalMs);
      const task = execute(picked, { signal: controller.signal })
        .catch((error: unknown) => {
          logger.log({
            level: "error",
            aiRunId: picked.aiRunId,
            detail: "AI の実行の処理が失敗した",
            error,
          });
        })
        .finally(() => {
          clearTimeout(timer);
          clearInterval(watcher);
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

// 起動したときの処理（DD-02 3章 P06 手順 1。NFR-005）。
// 処理中のまま残った実行を全て、失敗（E11、理由「途中で止まった」）にし、手順 5 の失敗の扱いを当てる。
// 拾い始める前に呼ぶ。失敗にした実行の数を返す。
export function failInterruptedRuns(deps: {
  queue: AiQueue;
  fail(run: PickedRun, error: unknown): void;
}): number {
  const runs = deps.queue.listRunning();
  for (const run of runs) {
    deps.fail(run, new NexusError("AI_INTERRUPTED", "途中で止まった"));
  }
  return runs.length;
}
