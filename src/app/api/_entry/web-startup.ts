import { NexusError } from "../../../server/shared/errors";
import { webContext } from "./web-context";

// Web サーバの起動の処理（DD-01 M11、DD-03 5章、DD-09 2.1）。
// 要求を受け付ける前に部品を作り、まだ当てていないマイグレーションを全て当てる。
// 起動の条件が合わない（DD-06 E17）か DB が使えないときは、プロセスを終わらせる。launchd が起動し直す。
// ログの関数が使えないとき（設定が読めないなど）は、launchd の標準エラーのファイルに出す（DD-09 2.6）。
export function startWebServer(): void {
  try {
    webContext();
  } catch (error) {
    // NexusError の文は内部の短い理由で、鍵と本文を含まない（DD-06 1章）。
    const reason =
      error instanceof NexusError
        ? `${error.code}: ${error.message}`
        : "INTERNAL";
    process.stderr.write(`NEXUS の Web サーバを起動できない: ${reason}\n`);
    process.exit(1);
  }
}
