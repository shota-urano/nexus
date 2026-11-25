import { registerHooks } from "node:module";

// 管理のコマンドのプロセスの入口（DD-01 M30）。Mac mini の本人のユーザでターミナルから打つ（DD-09 2.1）。
//   node src/cli/main.ts sender-key issue|list|revoke ...
// 設定は環境変数から読む（DD-09 2.3）。終了コードはコマンドの結果（DD-06 E07 は 1）。
//
// Node.js は TypeScript の型を取り除いて動かすが、拡張子の無い相対の読み込みを解決しない。
// src の中の読み込みは拡張子を書かない決まりなので、見つからないときだけ `.ts` を足して解決する。
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

const { runAdminProcess } = (await import(
  new URL("./admin.ts", import.meta.url).href
)) as typeof import("./admin");

process.exitCode = runAdminProcess(process.argv.slice(2), {
  env: process.env,
  output: {
    out: (line) => process.stdout.write(`${line}\n`),
    err: (line) => process.stderr.write(`${line}\n`),
  },
});
