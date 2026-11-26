import { registerHooks } from "node:module";

// AI Runner のプロセスの入口（DD-01 M24）。launchd が起動し、止める（DD-09 2.6）。
//   node dist/runner/main.js（開発中は node src/runner/main.ts）
// 設定は環境変数から読む（DD-09 2.3）。流れは process.ts に書く。
//
// Node.js は TypeScript の型を取り除いて動かすが、拡張子の無い相対の読み込みを解決しない。
// src の中の読み込みは拡張子を書かない決まりなので、見つからないときだけ、読み込む側のファイルと同じ拡張子
// （`src` の `.ts` を動かすときは `.ts`、JavaScript に変えた `dist` の `.js` を動かすときは `.js`）を足して解決する（src/jobs/main.ts と同じ）。
// フォルダを指す読み込み（`./ai-provider` など）は、そのフォルダの `index` で解決する。
const SOURCE_EXTENSION = /\.[cm]?[jt]s$/;

function extensionOf(url: string | undefined): string {
  return (
    SOURCE_EXTENSION.exec(new URL(url ?? import.meta.url).pathname)?.[0] ??
    ".js"
  );
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      const relative =
        specifier.startsWith("./") || specifier.startsWith("../");
      if (!relative || SOURCE_EXTENSION.test(specifier)) throw error;
      const extension = extensionOf(context.parentURL);
      try {
        return nextResolve(`${specifier}${extension}`, context);
      } catch {
        return nextResolve(`${specifier}/index${extension}`, context);
      }
    }
  },
});

const { runAiRunnerProcess } = (await import(
  new URL(`./process${extensionOf(import.meta.url)}`, import.meta.url).href
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
