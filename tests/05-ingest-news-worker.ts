import { registerHooks } from "node:module";
import { parentPort, workerData } from "node:worker_threads";

// TC120、TC121 の接続の1つの代わり（tests/05-ingest-news-batch.test.ts、
// tests/05-ingest-english-set.test.ts から Worker で動かす）。
// 自分の DB の接続で `postNewsBatch`（`entry` が english なら `postEnglishSet`）を用意し、
// もう1つの Worker と待ち合わせてから送る。
// 応答の状態の番号と本文を親に返す。

// src の中の拡張子の無い相対の読み込みを `.ts` か、フォルダの `index.ts` で解決する。
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
  // 送る時刻（届いた日時で、どちらの送信かを見分ける）。
  now: string;
  key: string;
  body: string;
  // 待ち合わせの数え。[0] に用意のできた Worker の数を入れる。
  barrier: SharedArrayBuffer;
  parties: number;
  // 送る操作。省くと news。
  entry?: "news" | "english";
}

const { path, logDir, now, key, body, barrier, parties, entry } =
  workerData as Input;

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
const { postEnglishSet } = (await import(
  src("app/api/_entry/english-set.ts")
)) as typeof import("../src/app/api/_entry/english-set");

// 接続と handler を先に用意しておき、待ち合わせのあとは送る処理だけが走るようにする。
const db = openDatabase(path);
const clock = createFakeClock(now);
const logger = createLogger({ process: "web", clock, dir: logDir });
const handler = (entry === "english" ? postEnglishSet : postNewsBatch)({
  logger,
  senderKeys: createSenderKeys({ db, clock }),
  ingest: createIngest({ db, clock, logger }),
});
const url =
  entry === "english"
    ? "http://127.0.0.1:48400/api/learning/sets"
    : "http://127.0.0.1:48400/api/inbox/batches";
const request = new Request(url, {
  method: "POST",
  headers: {
    authorization: `Bearer ${key}`,
    "content-type": "application/json",
  },
  body,
});

const count = new Int32Array(barrier);
Atomics.add(count, 0, 1);
Atomics.notify(count, 0);
for (;;) {
  const ready = Atomics.load(count, 0);
  if (ready >= parties) break;
  Atomics.wait(count, 0, ready);
}

const response = await handler(request);
const json = (await response.json()) as unknown;
db.close();
parentPort?.postMessage({ status: response.status, json });
