import type { Config } from "../../server/shared/config";
import { createFakeAi, defaultFakeScript, type FakeScriptSource } from "./fake";
import { createAiProviderWith } from "./provider";
import type { AiProvider } from "./types";

// AI の呼び出し（DD-01 M26）。M25 はここから読み込む。

export type * from "./types";
export {
  ANSWER_TOOLS,
  buildClaudeArgs,
  buildClaudeEnv,
  buildClaudeLaunchSpec,
} from "./claude-command";
export { parseEventLine } from "./events";
export {
  createFakeAi,
  defaultFakeScript,
  type FakeAi,
  type FakeCall,
  type FakeScript,
  type FakeScriptSource,
  type FakeStep,
} from "./fake";
export {
  KILL_GRACE_MS,
  createAiProviderWith,
  type AiProviderOptions,
  type Timers,
} from "./provider";

// 設定（DD-09 2.3）から AI の呼び方を決める。`fake` は偽の AI（DD-09 2.2）。
export function createAiProvider(
  config: Config,
  options: {
    fakeScript?: FakeScriptSource;
    env?: Readonly<Record<string, string | undefined>>;
  } = {},
): AiProvider {
  const common = {
    dataDir: config.dataDir,
    brainHarnessDir: config.brainHarnessDir,
    aiEventLogDir: config.aiEventLogDir,
    env: options.env,
  };
  if (config.aiProvider === "claude") {
    // 設定の読み込み（M23）が、claude のときは道があることを確かめている。
    if (config.claudeBin === null)
      throw new Error("設定 NEXUS_CLAUDE_BIN が無い");
    return createAiProviderWith({ ...common, claudeBin: config.claudeBin });
  }
  return createFakeAi(options.fakeScript ?? defaultFakeScript, {
    ...common,
    claudeBin: config.claudeBin ?? "claude",
  }).provider;
}
