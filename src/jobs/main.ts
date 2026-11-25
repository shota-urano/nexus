import { registerHooks } from "node:module";

// 定期ジョブのプロセスの入口（DD-01 M27）。launchd が起動し、本人も手で動かす（DD-09 2.6）。
//   node src/jobs/main.ts backup
// 設定は環境変数から読む（DD-09 2.3）。流れは process.ts に書く。終了コードは 0、1、2（BD-02 5.4）。
//
// Node.js は TypeScript の型を取り除いて動かすが、拡張子の無い相対の読み込みを解決しない。
// src の中の読み込みは拡張子を書かない決まりなので、見つからないときだけ `.ts` を足して解決する（src/runner/main.ts と同じ）。
// フォルダを指す読み込み（`./backup` など）は、そのフォルダの `index.ts` で解決する。
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

const { runJobProcess } = (await import(
  new URL("./process.ts", import.meta.url).href
)) as typeof import("./process");

process.exitCode = await runJobProcess(process.argv.slice(2), {
  env: process.env,
});
