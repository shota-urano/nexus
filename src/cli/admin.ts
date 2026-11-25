import type { SenderKeys } from "../server/auth/sender-key";
import { type CommandOutput, runSenderKeyCommand } from "./sender-key";

// 管理のコマンドの入口（DD-01 M30）。最初の引数でコマンドを選び、終了コードを返す。
// 業務層（M12）の部品と出力の先は、呼ぶ側が渡す（DD-10 1章。テストは一時の DB で動かす）。

export interface AdminCommandDeps {
  senderKeys: SenderKeys;
  output: CommandOutput;
}

export function runAdminCommand(
  argv: readonly string[],
  deps: AdminCommandDeps,
): number {
  const [command, ...args] = argv;
  if (command === "sender-key") {
    return runSenderKeyCommand(args, deps);
  }
  deps.output.err("使い方: sender-key issue|list|revoke");
  return 1;
}
