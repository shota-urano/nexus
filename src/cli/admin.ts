import { type Devices, openDevices } from "../server/auth/devices";
import { type SenderKeys, openSenderKeys } from "../server/auth/sender-key";
import { type Clock, systemClock } from "../server/shared/clock";
import { type Config, loadConfig } from "../server/shared/config";
import { NexusError } from "../server/shared/errors";
import { createLogger } from "../server/shared/logger";
import { runDeviceCommand } from "./device";
import { type CommandOutput, runSenderKeyCommand } from "./sender-key";

// 管理のコマンドの入口（DD-01 M30）。最初の引数でコマンドを選び、終了コードを返す。
// 業務層（M12）の部品と出力の先は、呼ぶ側が渡す（DD-10 1章。テストは一時の DB で動かす）。

export interface AdminCommandDeps {
  senderKeys: SenderKeys;
  // `device` のコマンドが使う部品と NEXUS のオリジン（DD-09 の設定 NEXUS_ORIGIN）。
  device?: { devices: Devices; origin: string };
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
  if (command === "device") {
    if (deps.device === undefined) {
      throw new Error("device のコマンドの部品が渡されていない");
    }
    return runDeviceCommand(args, { ...deps.device, output: deps.output });
  }
  deps.output.err(
    "使い方: device add|list|revoke | sender-key issue|list|revoke",
  );
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
  let devices: ReturnType<typeof openDevices>;
  try {
    senderKeys = openSenderKeys({ dataDir: config.dataDir, clock });
    try {
      devices = openDevices({ dataDir: config.dataDir, clock });
    } catch (error) {
      senderKeys.close();
      throw error;
    }
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
    return runAdminCommand(argv, {
      senderKeys,
      device: { devices, origin: config.origin },
      output,
    });
  } finally {
    senderKeys.close();
    devices.close();
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
