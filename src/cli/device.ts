import {
  type Devices,
  deviceExistsMessage,
  unknownDeviceMessage,
} from "../server/auth/devices";
import { NexusError } from "../server/shared/errors";
import type { CommandOutput } from "./sender-key";

// 管理のコマンド M30 の `device add|list|revoke`（DD-01 M30。DD-02 FN-023）。
// 登録の URL は作ったときに1回だけ出す。一覧に鍵と照合値は出さない。

export interface DeviceCommandDeps {
  devices: Devices;
  // NEXUS のオリジン（DD-09 の設定 NEXUS_ORIGIN）。登録の URL の頭にする。
  origin: string;
  output: CommandOutput;
}

const USAGE =
  "使い方: device add <端末の名前> | device list | device revoke <端末の名前>";

// 登録の URL（`openRegistration` の道。DD-04 2章）。
export function registrationUrl(origin: string, code: string): string {
  return `${origin}/register?code=${encodeURIComponent(code)}`;
}

// `device` の後の引数を受け、終了コードを返す。
export function runDeviceCommand(
  args: readonly string[],
  deps: DeviceCommandDeps,
): number {
  const { devices, origin, output } = deps;
  const [subcommand, ...rest] = args;
  const name = rest.length === 1 && rest[0] !== "" ? rest[0] : null;
  try {
    if (subcommand === "add" && name !== null) {
      const { code } = devices.add(name);
      output.out(registrationUrl(origin, code));
      return 0;
    }
    if (subcommand === "list" && rest.length === 0) {
      for (const entry of devices.list()) {
        output.out(
          `${entry.deviceName}\t${entry.registeredAt}\t${entry.lastUsedAt}`,
        );
      }
      return 0;
    }
    if (subcommand === "revoke" && name !== null) {
      devices.revoke(name);
      return 0;
    }
  } catch (error) {
    // E07（同じ名前の端末がある）は MSG-043、E05（端末の名前が無い）は MSG-042。どちらも終了コード 1（DD-06 2章）。
    if (error instanceof NexusError && name !== null) {
      if (error.msg === "MSG-043") {
        output.err(deviceExistsMessage(name));
        return 1;
      }
      if (error.msg === "MSG-042") {
        output.err(unknownDeviceMessage(name));
        return 1;
      }
    }
    throw error;
  }
  output.err(USAGE);
  return 1;
}
