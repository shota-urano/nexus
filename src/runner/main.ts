import { registerHooks } from "node:module";

// AI Runner のプロセスの入口（DD-01 M24）。launchd が起動し、止める（DD-09 2.6）。
//   node src/runner/main.ts
// 設定は環境変数から読む（DD-09 2.3）。流れは process.ts に書く。
//
// Node.js は TypeScript の型を取り除いて動かすが、拡張子の無い相対の読み込みを解決しない。
// src の中の読み込みは拡張子を書かない決まりなので、見つからないときだけ `.ts` を足して解決する（src/cli/main.ts と同じ）。
// フォルダを指す読み込み（`./ai-provider` など）は、そのフォルダの `index.ts` で解決する。
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

const { runAiRunnerProcess } = (await import(
  new URL("./process.ts", import.meta.url).href
)) as typeof import("./process");

// launchd は SIGTERM で止める。ターミナルから動かしたときの Ctrl+C（SIGINT）も同じに扱う。
const stopRequested = new Promise<void>((resolve) => {
  process.once("SIGTERM", () => resolve());
  process.once("SIGINT", () => resolve());
});

process.exitCode = await runAiRunnerProcess({
  env: process.env,
  stopRequested,
});
