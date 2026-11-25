import { isAbsolute, join, resolve } from "node:path";
import { NexusError } from "./errors";

// 設定の読み込み（DD-09 2.3）。全てのプロセスは設定を環境変数から読み、ここで確かめる。
// 足りないか形が違えば DD-06 E17（STARTUP_MISMATCH）で止まる。
// 試験と開発は DD-09 2.2 の値を既定にし、Git で管理しない設定のファイルを要らないようにする（DD-09 5章）。

export type NexusEnv = "production" | "test" | "development";
export type AiProvider = "claude" | "fake";

export interface Config {
  env: NexusEnv;
  dataDir: string;
  // null のときは標準出力に出す（DD-09 2.2 開発）。
  logDir: string | null;
  port: number;
  origin: string;
  backupDir: string;
  aiProvider: AiProvider;
  claudeBin: string | null;
  brainHarnessDir: string | null;
  // 試験のときだけ設定する（DD-09 2.5）。
  aiEventLogDir: string | null;
}

type Env = Readonly<Record<string, string | undefined>>;

export interface LoadConfigOptions {
  // 開発のデータの置き場所 `.data/dev/` を決める、リポジトリの根（DD-09 2.2）。
  cwd?: string;
}

const ENVS: readonly NexusEnv[] = ["production", "test", "development"];
const PROVIDERS: readonly AiProvider[] = ["claude", "fake"];
const TIME_ZONE = "Asia/Tokyo";

// DD-09 2.2 の試験と開発の値。
const LOCAL_DEFAULTS = {
  test: { port: 48401, origin: "http://localhost:48401" },
  development: { port: 48402, origin: "http://localhost:48402" },
} as const;

export function loadConfig(
  env: Env = process.env,
  options: LoadConfigOptions = {},
): Config {
  const read = (name: string): string | undefined => {
    const value = env[name];
    return value === undefined || value === "" ? undefined : value;
  };
  const required = (name: string): string => {
    const value = read(name);
    if (value === undefined) throw mismatch(`設定 ${name} が無い`);
    return value;
  };
  const oneOf = <T extends string>(
    name: string,
    value: string,
    allowed: readonly T[],
  ): T => {
    if (!(allowed as readonly string[]).includes(value)) {
      throw mismatch(`設定 ${name} は ${allowed.join("、")} のどれかにする`);
    }
    return value as T;
  };
  const absolute = (name: string, value: string): string => {
    if (!isAbsolute(value)) throw mismatch(`設定 ${name} は絶対の道で書く`);
    return value;
  };

  const nexusEnv = oneOf("NEXUS_ENV", required("NEXUS_ENV"), ENVS);
  const production = nexusEnv === "production";

  const tz = production ? required("TZ") : read("TZ");
  if (tz !== undefined && tz !== TIME_ZONE)
    throw mismatch(`設定 TZ は ${TIME_ZONE} にする`);

  const optionalPath = (name: string): string | null => {
    const value = read(name);
    return value === undefined ? null : absolute(name, value);
  };
  const requiredPath = (name: string): string => absolute(name, required(name));

  let dataDir: string;
  let logDir: string | null;
  let backupDir: string;
  let port: number;
  let origin: string;
  let aiProvider: AiProvider;

  if (production) {
    dataDir = requiredPath("NEXUS_DATA_DIR");
    logDir = requiredPath("NEXUS_LOG_DIR");
    backupDir = requiredPath("NEXUS_BACKUP_DIR");
    port = parsePort(required("NEXUS_PORT"));
    origin = parseOrigin(required("NEXUS_ORIGIN"));
    aiProvider = oneOf(
      "NEXUS_AI_PROVIDER",
      required("NEXUS_AI_PROVIDER"),
      PROVIDERS,
    );
  } else {
    const defaults = LOCAL_DEFAULTS[nexusEnv];
    // 試験のデータの置き場所は、テストのコマンドが一時のフォルダに作って渡す（DD-09 2.2）。
    dataDir =
      nexusEnv === "test"
        ? requiredPath("NEXUS_DATA_DIR")
        : (optionalPath("NEXUS_DATA_DIR") ??
          resolve(options.cwd ?? process.cwd(), ".data/dev"));
    logDir =
      optionalPath("NEXUS_LOG_DIR") ??
      (nexusEnv === "test" ? join(dataDir, "logs") : null);
    backupDir = optionalPath("NEXUS_BACKUP_DIR") ?? join(dataDir, "backup");
    const portValue = read("NEXUS_PORT");
    port = portValue === undefined ? defaults.port : parsePort(portValue);
    const originValue = read("NEXUS_ORIGIN");
    origin =
      originValue === undefined ? defaults.origin : parseOrigin(originValue);
    const providerValue = read("NEXUS_AI_PROVIDER");
    aiProvider =
      providerValue === undefined
        ? "fake"
        : oneOf("NEXUS_AI_PROVIDER", providerValue, PROVIDERS);
  }

  // CLI の道と決めたフォルダは、本当の CLI を使うときだけ要る（DD-09 2.2 の偽の AI では使わない）。
  const claude = aiProvider === "claude";
  const claudeBin = claude
    ? requiredPath("NEXUS_CLAUDE_BIN")
    : optionalPath("NEXUS_CLAUDE_BIN");
  const brainHarnessDir = claude
    ? requiredPath("NEXUS_BRAIN_HARNESS_DIR")
    : optionalPath("NEXUS_BRAIN_HARNESS_DIR");

  // AI の出来事の記録は会話の中身を含むので、本番では設定させない（DD-09 2.5 AC22 の 1）。
  const aiEventLogDir = optionalPath("NEXUS_AI_EVENT_LOG_DIR");
  if (production && aiEventLogDir !== null)
    throw mismatch("設定 NEXUS_AI_EVENT_LOG_DIR は本番では設定しない");

  return {
    env: nexusEnv,
    dataDir,
    logDir,
    port,
    origin,
    backupDir,
    aiProvider,
    claudeBin,
    brainHarnessDir,
    aiEventLogDir,
  };
}

function parsePort(value: string): number {
  const port = /^\d{1,5}$/.test(value) ? Number(value) : NaN;
  if (!(port >= 1 && port <= 65535))
    throw mismatch("設定 NEXUS_PORT は 1〜65535 の数にする");
  return port;
}

function parseOrigin(value: string): string {
  let url: URL | undefined;
  try {
    url = new URL(value);
  } catch {
    url = undefined;
  }
  if (
    !url ||
    !["http:", "https:"].includes(url.protocol) ||
    url.origin !== value
  ) {
    throw mismatch(
      "設定 NEXUS_ORIGIN はオリジン（例 https://nexus.example.ts.net）にする",
    );
  }
  return value;
}

function mismatch(reason: string): NexusError {
  return new NexusError("STARTUP_MISMATCH", reason);
}
