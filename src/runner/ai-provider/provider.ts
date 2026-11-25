import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { redact } from "../../server/shared/logger";
import { buildClaudeLaunchSpec } from "./claude-command";
import { parseEventLine } from "./events";
import { spawnLauncher } from "./launcher";
import type {
  AiCall,
  AiEvent,
  AiExit,
  AiProvider,
  AiRequest,
  Launcher,
} from "./types";

// AI を呼ぶ1か所（DD-01 M26。ADR-005）。

// SIGTERM を送ってから SIGKILL を送るまでの猶予（DD-06 4章、DD-09 2.5）。
export const KILL_GRACE_MS = 5_000;

// 猶予の時計。テストでは偽の時計にする（DD-10 1章「値を渡す口は M26 の作りに含める」）。
export interface Timers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const systemTimers: Timers = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) =>
    clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface AiProviderOptions {
  claudeBin: string;
  dataDir: string;
  brainHarnessDir: string | null;
  // 試験のときだけ、標準出力の全ての行を `<実行ID>.jsonl` に残す置き場所（DD-09 2.5 AC22 の 1）。
  aiEventLogDir?: string | null;
  launcher?: Launcher;
  // 渡す環境変数を絞る元（AI Runner の環境変数）。
  env?: Readonly<Record<string, string | undefined>>;
  timers?: Timers;
  killGraceMs?: number;
}

export function createAiProviderWith(options: AiProviderOptions): AiProvider {
  const launcher = options.launcher ?? spawnLauncher;
  const sourceEnv = options.env ?? process.env;
  const timers = options.timers ?? systemTimers;
  const graceMs = options.killGraceMs ?? KILL_GRACE_MS;

  return {
    call(request: AiRequest): AiCall {
      const spec = buildClaudeLaunchSpec(request.purpose, options, sourceEnv);
      const eventLog = eventLogPath(options.aiEventLogDir ?? null, request);
      const signal = request.signal;

      if (signal?.aborted) {
        return {
          events: (async function* () {})(),
          exit: Promise.resolve({
            kind: "stopped",
            killed: false,
            signal: null,
          }),
        };
      }

      const child = launcher(spec);
      let ended = false;
      let stopped = false;
      let killed = false;
      let graceTimer: unknown = undefined;

      const stop = () => {
        if (ended || stopped) return;
        stopped = true;
        child.kill("SIGTERM");
        graceTimer = timers.setTimeout(() => {
          graceTimer = undefined;
          if (ended) return;
          killed = true;
          child.kill("SIGKILL");
        }, graceMs);
      };
      signal?.addEventListener("abort", stop, { once: true });

      const exit = child.ended.then((end): AiExit => {
        ended = true;
        signal?.removeEventListener("abort", stop);
        if (graceTimer !== undefined) timers.clearTimeout(graceTimer);
        if (end.launchError !== null)
          return { kind: "launch_failed", reason: end.launchError };
        if (stopped) return { kind: "stopped", killed, signal: end.signal };
        return {
          kind: "exited",
          exitCode: end.code,
          signal: end.signal,
          stderr: redact(child.stderr()),
        };
      });

      child.writeInput(request.input);

      async function* events(): AsyncGenerator<AiEvent> {
        for await (const line of child.lines) {
          if (eventLog !== null) appendEventLine(eventLog, line);
          const event = parseEventLine(line);
          if (event !== null) yield event;
        }
      }

      return { events: events(), exit };
    },
  };
}

function eventLogPath(dir: string | null, request: AiRequest): string | null {
  if (dir === null || request.runId === undefined) return null;
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return join(dir, `${request.runId}.jsonl`);
}

function appendEventLine(path: string, line: string): void {
  appendFileSync(path, `${line}\n`, { encoding: "utf8", mode: 0o600 });
}
