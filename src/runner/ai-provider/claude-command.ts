import { join } from "node:path";
import type { AiPurpose, LaunchSpec } from "./types";

// `claude -p` の起動のしかた（DD-09 2.5。X-04 Q-082 の答え）。引数は配列で、シェルを通さない（X-07 3章）。

export interface ClaudeCommandOptions {
  // `NEXUS_CLAUDE_BIN` の道。
  claudeBin: string;
  // `NEXUS_DATA_DIR`。作業の場所 `ai-workdir` と設定 `claude-settings.json` を置く。
  dataDir: string;
  // `NEXUS_BRAIN_HARNESS_DIR`。質問の応答でだけ `--add-dir` で足す（CR-005）。
  brainHarnessDir: string | null;
}

// 質問の応答で使わせるツール（DD-09 2.5）。
export const ANSWER_TOOLS = "WebSearch,WebFetch,Read,Glob,Grep";

// 渡す環境変数の固定の値（DD-09 2.5）。
const FIXED_ENV = {
  PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
  LANG: "ja_JP.UTF-8",
  DISABLE_AUTOUPDATER: "1",
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
} as const;
// AI Runner の環境変数から引き継ぐもの（DD-09 2.5）。ほかは引き継がない。
const INHERITED_ENV = ["HOME", "USER", "LOGNAME", "TMPDIR", "TZ"] as const;

export function aiWorkdir(dataDir: string): string {
  return join(dataDir, "ai-workdir");
}

export function claudeSettingsPath(dataDir: string): string {
  return join(dataDir, "claude-settings.json");
}

export function buildClaudeArgs(
  purpose: AiPurpose,
  options: Pick<ClaudeCommandOptions, "dataDir" | "brainHarnessDir">,
): string[] {
  const args = [
    "-p",
    // 出力の形と渡す内容（DD-04 4.2）。
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--input-format",
    "text",
  ];
  if (purpose === "answer") {
    args.push("--tools", ANSWER_TOOLS, "--disallowedTools", "mcp__*");
    if (options.brainHarnessDir !== null)
      args.push("--add-dir", options.brainHarnessDir);
  } else {
    // 記事の関係の判定と会話の要約ではツールを使わせない。`--add-dir` を付けない。
    args.push("--tools", "", "--disallowedTools", "mcp__*");
  }
  args.push(
    "--permission-mode",
    "dontAsk",
    "--safe-mode",
    "--setting-sources",
    "project",
    "--settings",
    claudeSettingsPath(options.dataDir),
    "--strict-mcp-config",
    "--no-session-persistence",
  );
  return args;
}

// 渡す環境変数を絞る。`ANTHROPIC_` で始まるものは決して渡さない（NFR-009、BD-10 T08）。
export function buildClaudeEnv(
  source: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of INHERITED_ENV) {
    const value = source[name];
    if (value !== undefined && value !== "") env[name] = value;
  }
  Object.assign(env, FIXED_ENV);
  for (const name of Object.keys(env)) {
    if (name.startsWith("ANTHROPIC_")) delete env[name];
  }
  return env;
}

export function buildClaudeLaunchSpec(
  purpose: AiPurpose,
  options: ClaudeCommandOptions,
  sourceEnv: Readonly<Record<string, string | undefined>>,
): LaunchSpec {
  return {
    command: options.claudeBin,
    args: buildClaudeArgs(purpose, options),
    env: buildClaudeEnv(sourceEnv),
    cwd: aiWorkdir(options.dataDir),
  };
}
