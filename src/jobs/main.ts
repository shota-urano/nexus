import { registerHooks } from "node:module";

// 定期ジョブのプロセスの入口（DD-01 M27）。launchd が起動し、本人も手で動かす（DD-09 2.6）。
//   node dist/jobs/main.js backup
// 設定は環境変数から読む（DD-09 2.3）。流れは process.ts に書く。終了コードは 0、1、2（BD-02 5.4）。
//
// Node.js は TypeScript の型を取り除いて動かすが、拡張子の無い相対の読み込みを解決しない。
// src の中の読み込みは拡張子を書かない決まりなので、見つからないときだけ、読み込む側のファイルと同じ拡張子
// （`src` の `.ts` を動かすときは `.ts`、JavaScript に変えた `dist` の `.js` を動かすときは `.js`）を足して解決する。
// フォルダを指す読み込み（`./backup` など）は、そのフォルダの `index` で解決する。
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

const { runJobProcess } = (await import(
  new URL(`./process${extensionOf(import.meta.url)}`, import.meta.url).href
)) as typeof import("./process");

process.exitCode = await runJobProcess(process.argv.slice(2), {
  env: process.env,
});
