import { registerHooks } from "node:module";
import { parentPort, workerData } from "node:worker_threads";

// TC95 の端末の1台の代わり（tests/03-auth-and-admin-register-route.test.ts から Worker で動かす）。
// 自分の DB の接続で登録の URL の道（src/app/register/route.ts）を用意し、
// もう1つの Worker と待ち合わせてから、同じ登録コードで GET `/register` を呼ぶ。
// 結果の状態の番号、Location、Set-Cookie の数を親に返す。

// src の中の拡張子の無い相対の読み込みを `.ts` で解決する（src/cli/main.ts と同じ）。
// フォルダを指す読み込み（`../server/ai-jobs` など）は、そのフォルダの `index.ts` で解決する。
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
  url: string;
  // 待ち合わせの数え。[0] に用意のできた Worker の数を入れる。
  barrier: SharedArrayBuffer;
  parties: number;
}

const { url, barrier, parties } = workerData as Input;

const { webContext } = (await import(
  new URL("../src/app/api/_entry/web-context.ts", import.meta.url).href
)) as typeof import("../src/app/api/_entry/web-context");
const { GET } = (await import(
  new URL("../src/app/register/route.ts", import.meta.url).href
)) as typeof import("../src/app/register/route");

// DB の接続を先に開いておき、待ち合わせのあとは要求の処理だけが走るようにする。
webContext();

const count = new Int32Array(barrier);
Atomics.add(count, 0, 1);
Atomics.notify(count, 0);
for (;;) {
  const ready = Atomics.load(count, 0);
  if (ready >= parties) break;
  Atomics.wait(count, 0, ready);
}

const response = await GET(new Request(url, { method: "GET" }));
parentPort?.postMessage({
  status: response.status,
  location: response.headers.get("location"),
  cookies: response.headers.getSetCookie().length,
});
