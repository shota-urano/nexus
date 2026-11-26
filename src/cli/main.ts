import { registerHooks } from "node:module";

// 管理のコマンドのプロセスの入口（DD-01 M30）。Mac mini の本人のユーザでターミナルから打つ（DD-09 2.1）。
//   node src/cli/main.ts device add|list|revoke ... / sender-key issue|list|revoke ...
// 設定は環境変数から読む（DD-09 2.3）。終了コードはコマンドの結果（DD-06 E07 は 1）。
//
// Node.js は TypeScript の型を取り除いて動かすが、拡張子の無い相対の読み込みを解決しない。
// src の中の読み込みは拡張子を書かない決まりなので、見つからないときだけ、読み込む側のファイルと同じ拡張子
// （`src` の `.ts` を動かすときは `.ts`、JavaScript に変えた `dist` の `.js` を動かすときは `.js`）を足して解決する（src/jobs/main.ts と同じ）。
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
      return nextResolve(
        `${specifier}${extensionOf(context.parentURL)}`,
        context,
      );
    }
  },
});

const { runAdminProcess } = (await import(
  new URL(`./admin${extensionOf(import.meta.url)}`, import.meta.url).href
)) as typeof import("./admin");

process.exitCode = runAdminProcess(process.argv.slice(2), {
  env: process.env,
  output: {
    out: (line) => process.stdout.write(`${line}\n`),
    err: (line) => process.stderr.write(`${line}\n`),
  },
});
