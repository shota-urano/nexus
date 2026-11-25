import { type SenderKeys, openSenderKeys } from "../server/auth/sender-key";
import { type Clock, systemClock } from "../server/shared/clock";
import { type Config, loadConfig } from "../server/shared/config";
import { NexusError } from "../server/shared/errors";
import { createLogger } from "../server/shared/logger";
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

export interface AdminProcessDeps {
  env: Readonly<Record<string, string | undefined>>;
  output: CommandOutput;
  clock?: Clock;
}

// プロセスとしての管理のコマンド（src/cli/main.ts から呼ぶ）。
// 設定を環境変数から読み（DD-09 2.1、2.3）、NEXUS_DATA_DIR の DB を開いてコマンドを動かす。
// 設定が読めないか、DB のマイグレーションの番号が違えば（DD-03 5章）、何もせずに失敗で終わる（DD-06 E17）。
export function runAdminProcess(
  argv: readonly string[],
  deps: AdminProcessDeps,
): number {
  const { env, output } = deps;
  const clock = deps.clock ?? systemClock;
  let config: Config;
  try {
    config = loadConfig(env);
  } catch (error) {
    return startupMismatch(error, output);
  }
  let senderKeys: ReturnType<typeof openSenderKeys>;
  try {
    senderKeys = openSenderKeys({ dataDir: config.dataDir, clock });
  } catch (error) {
    if (error instanceof NexusError) {
      createLogger({ process: "cli", clock, dir: config.logDir }).log({
        level: error.level,
        code: error.code,
        error,
      });
    }
    return startupMismatch(error, output);
  }
  try {
    return runAdminCommand(argv, { senderKeys, output });
  } finally {
    senderKeys.close();
  }
}

// 設定が読めないときと、DB の番号が違うとき（DD-06 E17。DD-06 3章「コマンドが失敗を出す」）。
function startupMismatch(error: unknown, output: CommandOutput): number {
  if (error instanceof NexusError && error.code === "STARTUP_MISMATCH") {
    output.err(`起動の条件が合わない: ${error.message}`);
    return 1;
  }
  throw error;
}
