import { registerHooks } from "node:module";
import { parentPort, workerData } from "node:worker_threads";

// TC89 の「別の接続」（tests/12-batch-backup.test.ts から Worker で動かす）。
// 自分の DB の接続で `postNewsBatch` を用意して親に知らせ、親がバックアップの途中で合図したら送る。
// 送り終えたら、応答の状態の番号を共有の場所に書いて親を起こし、状態の番号と本文を親に返す。

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
  logDir: string;
  now: string;
  key: string;
  body: string;
  // [0] 親が送る合図に 1 を入れる。[1] 送った応答の状態の番号。[2] 送り終えたら 1。
  signal: SharedArrayBuffer;
}

const { path, logDir, now, key, body, signal } = workerData as Input;

const src = (file: string) => new URL(`../src/${file}`, import.meta.url).href;

const { openDatabase } = (await import(
  src("server/db/connection.ts")
)) as typeof import("../src/server/db/connection");
const { createSenderKeys } = (await import(
  src("server/auth/sender-key.ts")
)) as typeof import("../src/server/auth/sender-key");
const { createIngest } = (await import(
  src("server/ingest/index.ts")
)) as typeof import("../src/server/ingest");
const { createFakeClock } = (await import(
  src("server/shared/clock.ts")
)) as typeof import("../src/server/shared/clock");
const { createLogger } = (await import(
  src("server/shared/logger.ts")
)) as typeof import("../src/server/shared/logger");
const { postNewsBatch } = (await import(
  src("app/api/_entry/news-batch.ts")
)) as typeof import("../src/app/api/_entry/news-batch");

const db = openDatabase(path);
const clock = createFakeClock(now);
const logger = createLogger({ process: "web", clock, dir: logDir });
const handler = postNewsBatch({
  logger,
  senderKeys: createSenderKeys({ db, clock }),
  ingest: createIngest({ db, clock, logger }),
});
const request = new Request("http://127.0.0.1:48400/api/inbox/batches", {
  method: "POST",
  headers: {
    authorization: `Bearer ${key}`,
    "content-type": "application/json",
  },
  body,
});

const shared = new Int32Array(signal);
parentPort?.postMessage({ ready: true });
while (Atomics.load(shared, 0) === 0) Atomics.wait(shared, 0, 0);

const response = await handler(request);
const json = (await response.json()) as unknown;
db.close();
Atomics.store(shared, 1, response.status);
Atomics.store(shared, 2, 1);
Atomics.notify(shared, 2);
parentPort?.postMessage({ status: response.status, json });
