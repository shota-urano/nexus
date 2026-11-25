import { registerHooks } from "node:module";
import { parentPort, workerData } from "node:worker_threads";

// TC122 の枠の1つの代わり（tests/04-ai-runner-relate.test.ts から Worker で動かす）。
// 自分の DB の接続で M20 の待ち行列を用意し、もう1つの Worker と待ち合わせてから、
// 次を拾う処理を呼ぶ。拾った実行ID（拾えなければ null）を親に返す。

// src の中の拡張子の無い相対の読み込みを `.ts` で解決する（src/cli/main.ts と同じ）。
registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      const relative =
        specifier.startsWith("./") || specifier.startsWith("../");
      if (!relative || /\.[cm]?[jt]s$/.test(specifier)) throw error;
      return nextResolve(`${specifier}.ts`, context);
    }
  },
});

interface Input {
  path: string;
  // 待ち合わせの数え。[0] に用意のできた Worker の数を入れる。
  barrier: SharedArrayBuffer;
  parties: number;
}

const { path, barrier, parties } = workerData as Input;

const { openDatabase } = (await import(
  new URL("../src/server/db/connection.ts", import.meta.url).href
)) as typeof import("../src/server/db/connection");
const { createAiQueue } = (await import(
  new URL("../src/server/ai-jobs/index.ts", import.meta.url).href
)) as typeof import("../src/server/ai-jobs");
const { createFakeClock } = (await import(
  new URL("../src/server/shared/clock.ts", import.meta.url).href
)) as typeof import("../src/server/shared/clock");

// 接続を先に開いておき、待ち合わせのあとは拾う処理だけが走るようにする。
const db = openDatabase(path);
const queue = createAiQueue(db, createFakeClock("2026-12-01T08:00:01+09:00"));

const count = new Int32Array(barrier);
Atomics.add(count, 0, 1);
Atomics.notify(count, 0);
for (;;) {
  const ready = Atomics.load(count, 0);
  if (ready >= parties) break;
  Atomics.wait(count, 0, ready);
}

const picked = queue.pickNext();
db.close();
parentPort?.postMessage({ picked: picked === null ? null : picked.aiRunId });
