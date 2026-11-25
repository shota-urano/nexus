import { type Devices, openDevices } from "../../../server/auth/devices";
import { systemClock } from "../../../server/shared/clock";
import { loadConfig } from "../../../server/shared/config";
import { createLogger, type Logger } from "../../../server/shared/logger";

// Web サーバのプロセスが使う部品（DD-01 M11）。設定を環境変数から読み（DD-09 2.3）、
// NEXUS_DATA_DIR の DB の接続をプロセスに1つだけ作る（DD-01 2.1）。
// 最初の要求で作り、あとの要求は同じものを使う。設定が読めないか、
// マイグレーションの番号が違えば（DD-06 E17）作らずに投げ、次の要求でもう一度作る。

export interface WebContext {
  logger: Logger;
  devices: Devices;
}

let context: WebContext | null = null;

export function webContext(): WebContext {
  if (context === null) {
    const config = loadConfig(process.env);
    const clock = systemClock;
    context = {
      logger: createLogger({ process: "web", clock, dir: config.logDir }),
      devices: openDevices({ dataDir: config.dataDir, clock }),
    };
  }
  return context;
}
