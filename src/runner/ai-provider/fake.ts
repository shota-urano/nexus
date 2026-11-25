import { createAiProviderWith, type AiProviderOptions } from "./provider";
import type {
  AiProvider,
  AiPurpose,
  AiRequest,
  LaunchSpec,
  LaunchedProcess,
  ProcessEnd,
  ProcessSignal,
} from "./types";

// 偽の AI（DD-01 M26 の `fake`。DD-10 3章）。子のプロセスを作らず、筋書きのとおりに
// stream-json の行を返し、渡された引数と環境変数と標準入力を記録する。
// 本番と同じ引数の組み立てと出来事の読み取りを通すので、偽の起動の口（TC56）にもなる。

// 筋書きの1歩。
export type FakeStep =
  // 文を少し返す（`content_block_delta` の `text_delta`）。
  | { text: string }
  // ツールを使った出来事（`content_block_start` の `tool_use`）。
  | { tool: string }
  // `assistant` の出来事の `error`（`authentication_failed`、`rate_limit` など）。
  | { error: string }
  // 成功の終わりの出来事。
  | { result: string }
  // 失敗の終わりの出来事（`is_error` が真）。
  | { failure: string; subtype?: string }
  // そのままの1行（JSON でない文など）。
  | { raw: string }
  // 止められるまで終わらない。
  | { hang: true }
  // 次の歩みの前に、ミリ秒だけ待つ（文を少しずつ返すため）。
  | { wait: number };

export interface FakeScript {
  steps: readonly FakeStep[];
  // 筋書きを最後まで返した後の終了コード。既定は 0。
  exitCode?: number;
  // SIGTERM を無視する（SIGKILL でだけ終わる）。
  ignoreSigterm?: boolean;
}

// 筋書きの渡し方。1つ（毎回同じ）、並び（呼んだ順に使い、尽きたら最後のものを使う）、関数（呼び出しごとに決める）。
export type FakeScriptSource =
  FakeScript | readonly FakeScript[] | ((request: AiRequest) => FakeScript);

// 偽の AI が記録した1回の呼び出し。
export interface FakeCall {
  purpose: AiPurpose;
  command: string;
  args: readonly string[];
  env: Readonly<Record<string, string>>;
  cwd: string;
  stdin: string;
  signals: ProcessSignal[];
}

export interface FakeAi {
  provider: AiProvider;
  calls: FakeCall[];
}

// 開発の環境で使う決まった応答（DD-09 2.2）。relate は関係の無い JSON（DD-02 3章 P07）。
export function defaultFakeScript(request: AiRequest): FakeScript {
  return request.purpose === "relate"
    ? { steps: [{ result: '{"relations":[]}' }] }
    : {
        steps: [
          { text: "偽の AI の応答です。" },
          { result: "偽の AI の応答です。" },
        ],
      };
}

export function createFakeAi(
  source: FakeScriptSource,
  options: Omit<AiProviderOptions, "launcher" | "claudeBin"> & {
    claudeBin?: string;
  },
): FakeAi {
  const calls: FakeCall[] = [];
  let used = 0;
  const pick = (request: AiRequest): FakeScript => {
    if (typeof source === "function") return source(request);
    if (isScriptList(source)) {
      const script = source[Math.min(used, source.length - 1)];
      used += 1;
      if (script === undefined) throw new Error("偽の AI の筋書きが空である");
      return script;
    }
    return source;
  };

  const provider: AiProvider = {
    call(request) {
      const script = pick(request);
      return createAiProviderWith({
        ...options,
        claudeBin: options.claudeBin ?? "claude",
        launcher: (spec) => {
          const call: FakeCall = {
            purpose: request.purpose,
            command: spec.command,
            args: [...spec.args],
            env: { ...spec.env },
            cwd: spec.cwd,
            stdin: "",
            signals: [],
          };
          calls.push(call);
          return launchFake(spec, script, call);
        },
      }).call(request);
    },
  };
  return { provider, calls };
}

function isScriptList(
  source: FakeScriptSource,
): source is readonly FakeScript[] {
  return Array.isArray(source);
}

function launchFake(
  _spec: LaunchSpec,
  script: FakeScript,
  call: FakeCall,
): LaunchedProcess {
  const lines = createLineQueue();
  let finish!: (end: ProcessEnd) => void;
  const ended = new Promise<ProcessEnd>((resolve) => {
    finish = resolve;
  });
  let terminated = false;
  let onTerminated: () => void = () => {};
  const terminatedSignal = new Promise<void>((resolve) => {
    onTerminated = resolve;
  });
  const terminate = (code: number | null, signal: string | null) => {
    if (terminated) return;
    terminated = true;
    lines.close();
    onTerminated();
    finish({ launchError: null, code, signal });
  };

  let started = false;
  const run = async () => {
    lines.push(JSON.stringify({ type: "system", subtype: "init" }));
    for (const [index, step] of script.steps.entries()) {
      await nextTick();
      if (terminated) return;
      if ("hang" in step) {
        await terminatedSignal;
        return;
      }
      if ("wait" in step) {
        await Promise.race([
          new Promise((resolve) => setTimeout(resolve, step.wait)),
          terminatedSignal,
        ]);
        continue;
      }
      lines.push(lineOf(step, index));
    }
    await nextTick();
    terminate(script.exitCode ?? 0, null);
  };

  return {
    writeInput: (input) => {
      call.stdin += input;
      if (started) return;
      started = true;
      void run();
    },
    lines,
    stderr: () => "",
    kill: (signal) => {
      call.signals.push(signal);
      if (signal === "SIGTERM" && script.ignoreSigterm) return;
      terminate(null, signal);
    },
    ended,
  };
}

function lineOf(
  step: Exclude<FakeStep, { hang: true } | { wait: number }>,
  index: number,
) {
  if ("text" in step)
    return JSON.stringify({
      type: "stream_event",
      event: {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: step.text },
      },
    });
  if ("tool" in step)
    return JSON.stringify({
      type: "stream_event",
      event: {
        type: "content_block_start",
        index: 0,
        content_block: {
          type: "tool_use",
          id: `toolu_fake_${index}`,
          name: step.tool,
          input: {},
        },
      },
    });
  if ("error" in step)
    return JSON.stringify({
      type: "assistant",
      message: { role: "assistant", content: [] },
      error: step.error,
    });
  if ("result" in step)
    return JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      result: step.result,
    });
  if ("failure" in step)
    return JSON.stringify({
      type: "result",
      subtype: step.subtype ?? "error_during_execution",
      is_error: true,
      errors: [step.failure],
    });
  return step.raw;
}

function nextTick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

interface LineQueue extends AsyncIterable<string> {
  push(line: string): void;
  close(): void;
}

function createLineQueue(): LineQueue {
  const buffered: string[] = [];
  let closed = false;
  let wake: (() => void) | null = null;
  const notify = () => {
    const resolve = wake;
    wake = null;
    resolve?.();
  };
  return {
    push(line) {
      if (closed) return;
      buffered.push(line);
      notify();
    },
    close() {
      closed = true;
      notify();
    },
    async *[Symbol.asyncIterator]() {
      for (;;) {
        const line = buffered.shift();
        if (line !== undefined) {
          yield line;
          continue;
        }
        if (closed) return;
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
    },
  };
}
