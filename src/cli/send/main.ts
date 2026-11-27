import { registerHooks } from "node:module";

// 送信のコマンド `nexus-send` のプロセスの入口（DD-01 M34、DD-09 2.7。CR-020）。送り手のユーザで打つ。
//   node dist/cli/send/main.js --source brain-research --kind research-report <ファイル>
// 本番では `deploy/nexus-send` の雛形から作った `bin/nexus-send` がこれを呼ぶ。
// 設定は送り手の側の環境変数（NEXUS_SEND_URL、NEXUS_SENDER_KEY）だけから読む。NEXUS の env のファイルは読まない。
//
// 拡張子の無い相対の読み込みは、読み込む側のファイルと同じ拡張子を足して解決する（src/cli/main.ts と同じ）。
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

const { runSendCommand } = (await import(
  new URL(`./send${extensionOf(import.meta.url)}`, import.meta.url).href
)) as typeof import("./send");

process.exitCode = await runSendCommand(process.argv.slice(2), {
  env: process.env,
  output: {
    out: (line) => process.stdout.write(`${line}\n`),
    err: (line) => process.stderr.write(`${line}\n`),
  },
});
