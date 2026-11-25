import { registerHooks } from "node:module";
import { parentPort, workerData } from "node:worker_threads";

// TC118 の「2つのプロセス」の印を取る処理（tests/12-batch-backup.test.ts から Worker で動かす）。
// 自分の DB の接続で M31 を用意し、もう1つの Worker と待ち合わせてから、渡された番号で印を取る。
// 取れたかを親に返す。印は消さない（もう片方が取ろうとする間、印を持ち続けるため）。

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      const relative =
        specifier.startsWith("./") || specifier.startsWith("../");
      if (!relative || /\.[cm]?[jt]s$/.test(specifier)) throw error;
      try {
        return nextResolve(`${specifier}.ts`, context);
      } catch {
        return nextResolve(`${specifier}/index.ts`, context);
      }
    }
  },
});

interface Input {
  path: string;
  now: string;
  pid: number;
  // 待ち合わせの数え。[0] に用意のできた Worker の数を入れる。
  barrier: SharedArrayBuffer;
  parties: number;
}

const { path, now, pid, barrier, parties } = workerData as Input;

const src = (file: string) => new URL(`../src/${file}`, import.meta.url).href;

const { openDatabase } = (await import(
  src("server/db/connection.ts")
)) as typeof import("../src/server/db/connection");
const { createFakeClock } = (await import(
  src("server/shared/clock.ts")
)) as typeof import("../src/server/shared/clock");
const { createJobLock } = (await import(
  src("jobs/lock/index.ts")
)) as typeof import("../src/jobs/lock");

const db = openDatabase(path);
const lock = createJobLock({ db, clock: createFakeClock(now) });

const count = new Int32Array(barrier);
Atomics.add(count, 0, 1);
Atomics.notify(count, 0);
for (;;) {
  const ready = Atomics.load(count, 0);
  if (ready >= parties) break;
  Atomics.wait(count, 0, ready);
}

const result = lock.acquire("backup", pid);
db.close();
parentPort?.postMessage(result);
