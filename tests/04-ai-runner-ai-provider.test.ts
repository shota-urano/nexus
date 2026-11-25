import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ANSWER_TOOLS,
  KILL_GRACE_MS,
  createAiProvider,
  createAiProviderWith,
  createFakeAi,
  parseEventLine,
  type AiCall,
  type AiEvent,
  type Timers,
} from "../src/runner/ai-provider";
import { loadConfig } from "../src/server/shared/config";

// 04-ai-runner の実装単位1: AI の呼び出し M26（偽の AI の筋書き、`claude -p` の引数の配列と設定と環境変数、
// stream-json の読み取り、SIGTERM と SIGKILL での止め方）。IF-004、DD-01 M26、DD-04 4.2、DD-09 2.5、DD-06 4章。
// 受け入れ基準は TC56、TC127。

let dir: string;
let dataDir: string;
const brainHarnessDir = "/Users/nexus/projects/brain-harness";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-ai-provider-"));
  dataDir = join(dir, "data");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

// AI Runner の環境変数（ANTHROPIC_ で始まるものと、関係の無いものを入れておく）。
const RUNNER_ENV = {
  HOME: "/Users/nexus",
  USER: "nexus",
  LOGNAME: "nexus",
  TMPDIR: "/var/folders/xx/T/",
  TZ: "Asia/Tokyo",
  PATH: "/opt/homebrew/bin:/usr/bin:/bin",
  LANG: "en_US.UTF-8",
  ANTHROPIC_API_KEY: "sk-ant-api03-test",
  ANTHROPIC_BASE_URL: "https://example.invalid",
  NEXUS_ENV: "production",
  NEXUS_DATA_DIR: "/Users/nexus/Library/Application Support/nexus",
};

async function drain(call: AiCall): Promise<AiEvent[]> {
  const events: AiEvent[] = [];
  for await (const event of call.events) events.push(event);
  return events;
}

const settingsPath = () => join(dataDir, "claude-settings.json");

const commonArgs = () => [
  "-p",
  "--output-format",
  "stream-json",
  "--verbose",
  "--include-partial-messages",
  "--input-format",
  "text",
];
const settingArgs = () => [
  "--permission-mode",
  "dontAsk",
  "--safe-mode",
  "--setting-sources",
  "project",
  "--settings",
  settingsPath(),
  "--strict-mcp-config",
  "--no-session-persistence",
];

describe("TC56 CLI の引数と設定と環境変数（DD-09 2.5、DD-04 4.2）", () => {
  it("TC56 answer と relate の引数が配列で決まりどおりになり、ANTHROPIC_ で始まる環境変数を渡さない", async () => {
    const fake = createFakeAi(
      { steps: [{ result: "ok" }] },
      {
        claudeBin: "/Users/nexus/.local/bin/claude",
        dataDir,
        brainHarnessDir,
        env: RUNNER_ENV,
      },
    );

    await drain(fake.provider.call({ purpose: "answer", input: "質問" }));
    await drain(fake.provider.call({ purpose: "relate", input: "記事" }));
    expect(fake.calls).toHaveLength(2);
    const [answer, relate] = fake.calls;

    // answer
    expect(answer.command).toBe("/Users/nexus/.local/bin/claude");
    expect(Array.isArray(answer.args)).toBe(true);
    expect(answer.args.every((arg) => typeof arg === "string")).toBe(true);
    expect(answer.args).toEqual([
      ...commonArgs(),
      "--tools",
      "WebSearch,WebFetch,Read,Glob,Grep",
      "--disallowedTools",
      "mcp__*",
      "--add-dir",
      brainHarnessDir,
      ...settingArgs(),
    ]);
    expect(ANSWER_TOOLS).toBe("WebSearch,WebFetch,Read,Glob,Grep");
    expect(answer.cwd).toBe(join(dataDir, "ai-workdir"));
    expect(answer.stdin).toBe("質問");

    // relate はツールを使わせず、--add-dir を付けない。
    expect(relate.args).toEqual([
      ...commonArgs(),
      "--tools",
      "",
      "--disallowedTools",
      "mcp__*",
      ...settingArgs(),
    ]);
    expect(relate.args).not.toContain("--add-dir");
    expect(relate.args[relate.args.indexOf("--tools") + 1]).toBe("");
    expect(relate.stdin).toBe("記事");

    // 渡した環境変数は決めたものだけで、ANTHROPIC_ で始まるものが無い。
    for (const call of fake.calls) {
      expect(
        Object.keys(call.env).filter((name) => name.startsWith("ANTHROPIC_")),
      ).toEqual([]);
      expect(call.env).toEqual({
        HOME: "/Users/nexus",
        USER: "nexus",
        LOGNAME: "nexus",
        TMPDIR: "/var/folders/xx/T/",
        TZ: "Asia/Tokyo",
        PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
        LANG: "ja_JP.UTF-8",
        DISABLE_AUTOUPDATER: "1",
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
      });
    }
  });

  it("TC56 本物の起動の口は、シェルを通さずに引数の配列と絞った環境変数で CLI を起動する", async () => {
    const cli = writeFakeCli({ ignoreSigterm: false, exitAfterInput: true });
    const provider = createAiProviderWith({
      claudeBin: cli.path,
      dataDir,
      brainHarnessDir: "/tmp/$(touch pwned); echo nope",
      env: RUNNER_ENV,
    });
    const call = provider.call({ purpose: "answer", input: "質問の文" });
    await drain(call);
    expect(await call.exit).toEqual({
      kind: "exited",
      exitCode: 0,
      signal: null,
      stderr: "",
    });

    const seen = JSON.parse(readFileSync(cli.argvFile, "utf8")) as {
      argv: string[];
      env: Record<string, string>;
      cwd: string;
    };
    // シェルの記号を含む値も、1つの引数としてそのまま届く。
    expect(seen.argv).toEqual([
      ...commonArgs(),
      "--tools",
      ANSWER_TOOLS,
      "--disallowedTools",
      "mcp__*",
      "--add-dir",
      "/tmp/$(touch pwned); echo nope",
      ...settingArgs(),
    ]);
    expect(
      Object.keys(seen.env).filter((name) => name.startsWith("ANTHROPIC_")),
    ).toEqual([]);
    expect(seen.env.PATH).toBe("/usr/bin:/bin:/usr/sbin:/sbin");
    expect(seen.env.NEXUS_ENV).toBeUndefined();
    expect(readFileSync(cli.stdinFile, "utf8")).toBe("質問の文");
    // 作業の場所は本人のユーザだけが使える空のフォルダ（DD-09 2.5）。
    const workdir = join(dataDir, "ai-workdir");
    expect(statSync(workdir).mode & 0o777).toBe(0o700);
    expect(existsSync(join(workdir, "pwned"))).toBe(false);
  });
});

describe("TC127 SIGTERM と SIGKILL での止め方（DD-06 4章）", () => {
  it("TC127 SIGTERM を無視する CLI には、5 秒たっても終わらないので SIGKILL を送る", async () => {
    const cli = writeFakeCli({ ignoreSigterm: true, exitAfterInput: false });
    const timers = createManualTimers();
    const provider = createAiProviderWith({
      claudeBin: cli.path,
      dataDir,
      brainHarnessDir: null,
      env: RUNNER_ENV,
      timers,
    });
    const controller = new AbortController();
    const call = provider.call({
      purpose: "relate",
      input: "記事",
      signal: controller.signal,
    });
    const events = drain(call);
    let settled = false;
    void call.exit.then(() => {
      settled = true;
    });

    await waitFor(() => markers(cli).includes("READY"));
    controller.abort();
    await waitFor(() => markers(cli).includes("TERM"));

    // SIGTERM を受けたが終わらない。猶予の時計は 5 秒で、まだ SIGKILL を送っていない。
    expect(KILL_GRACE_MS).toBe(5_000);
    expect(timers.pending().map((timer) => timer.ms)).toEqual([5_000]);
    await settle();
    expect(settled).toBe(false);

    // 偽の時計で 5 秒を過ぎさせる。
    timers.fireAll();
    expect(await call.exit).toEqual({
      kind: "stopped",
      killed: true,
      signal: "SIGKILL",
    });
    await events;
  });

  it("TC127 SIGTERM で終わる CLI には SIGKILL を送らず、猶予の時計を止める", async () => {
    const cli = writeFakeCli({ ignoreSigterm: false, exitAfterInput: false });
    const timers = createManualTimers();
    const provider = createAiProviderWith({
      claudeBin: cli.path,
      dataDir,
      brainHarnessDir: null,
      env: RUNNER_ENV,
      timers,
    });
    const controller = new AbortController();
    const call = provider.call({
      purpose: "relate",
      input: "記事",
      signal: controller.signal,
    });
    const events = drain(call);
    await waitFor(() => markers(cli).includes("READY"));
    controller.abort();
    expect(await call.exit).toEqual({
      kind: "stopped",
      killed: false,
      signal: "SIGTERM",
    });
    expect(timers.pending()).toEqual([]);
    await events;
  });

  it("TC127 偽の AI の筋書きでも、SIGTERM を無視すれば SIGKILL で止まる", async () => {
    const timers = createManualTimers();
    const fake = createFakeAi(
      { steps: [{ text: "途中" }, { hang: true }], ignoreSigterm: true },
      { dataDir, brainHarnessDir: null, env: RUNNER_ENV, timers },
    );
    const controller = new AbortController();
    const call = fake.provider.call({
      purpose: "answer",
      input: "質問",
      signal: controller.signal,
    });
    const iterator = call.events[Symbol.asyncIterator]();
    expect((await iterator.next()).value).toEqual({
      type: "text",
      text: "途中",
    });
    controller.abort();
    expect(fake.calls[0].signals).toEqual(["SIGTERM"]);
    timers.fireAll();
    expect(await call.exit).toEqual({
      kind: "stopped",
      killed: true,
      signal: "SIGKILL",
    });
    expect(fake.calls[0].signals).toEqual(["SIGTERM", "SIGKILL"]);
  });
});

describe("stream-json の読み取り（DD-04 4.2）", () => {
  it("文の続き、ツール、error、終わり、api_retry を読み、ほかは読み捨てる", () => {
    const line = (value: unknown) => JSON.stringify(value);
    expect(
      parseEventLine(
        line({
          type: "stream_event",
          event: {
            type: "content_block_delta",
            delta: { type: "text_delta", text: "今日" },
          },
        }),
      ),
    ).toEqual({ type: "text", text: "今日" });
    expect(
      parseEventLine(
        line({
          type: "stream_event",
          event: {
            type: "content_block_start",
            content_block: { type: "tool_use", name: "WebSearch" },
          },
        }),
      ),
    ).toEqual({ type: "tool_use", name: "WebSearch" });
    expect(
      parseEventLine(line({ type: "assistant", error: "rate_limit" })),
    ).toEqual({ type: "assistant_error", error: "rate_limit" });
    expect(
      parseEventLine(
        line({
          type: "result",
          subtype: "success",
          is_error: false,
          result: "{}",
        }),
      ),
    ).toEqual({
      type: "result",
      ok: true,
      subtype: "success",
      result: "{}",
      errors: [],
    });
    expect(
      parseEventLine(
        line({
          type: "result",
          subtype: "success",
          is_error: true,
          errors: ["x"],
        }),
      ),
    ).toMatchObject({ type: "result", ok: false, errors: ["x"] });
    expect(
      parseEventLine(line({ type: "result", subtype: "error_max_turns" })),
    ).toMatchObject({ type: "result", ok: false });
    expect(
      parseEventLine(line({ type: "system", subtype: "api_retry" })),
    ).toEqual({ type: "api_retry" });
    expect(parseEventLine(line({ type: "system", subtype: "init" }))).toBe(
      null,
    );
    expect(parseEventLine(line({ type: "user", message: {} }))).toBe(null);
    expect(
      parseEventLine(
        line({ type: "assistant", message: { role: "assistant" } }),
      ),
    ).toBe(null);
    expect(
      parseEventLine(
        line({ type: "stream_event", event: { type: "message_stop" } }),
      ),
    ).toBe(null);
    expect(parseEventLine("これは JSON ではない")).toEqual({
      type: "bad_line",
    });
    expect(parseEventLine("[1,2]")).toEqual({ type: "bad_line" });
    expect(parseEventLine("")).toBe(null);
  });
});

describe("偽の AI の筋書き（DD-10 3章）", () => {
  const fakeOf = (
    source: Parameters<typeof createFakeAi>[0],
    extra: { aiEventLogDir?: string } = {},
  ) =>
    createFakeAi(source, {
      dataDir,
      brainHarnessDir,
      env: RUNNER_ENV,
      ...extra,
    });

  it("少しずつ文を返し、ツールを使った出来事を返して成功する", async () => {
    const fake = fakeOf({
      steps: [
        { tool: "WebSearch" },
        { text: "今日" },
        { text: "は" },
        { text: "晴れ" },
        { result: "今日は晴れ" },
      ],
    });
    const call = fake.provider.call({ purpose: "answer", input: "天気は" });
    expect(await drain(call)).toEqual([
      { type: "tool_use", name: "WebSearch" },
      { type: "text", text: "今日" },
      { type: "text", text: "は" },
      { type: "text", text: "晴れ" },
      {
        type: "result",
        ok: true,
        subtype: "success",
        result: "今日は晴れ",
        errors: [],
      },
    ]);
    expect(await call.exit).toEqual({
      kind: "exited",
      exitCode: 0,
      signal: null,
      stderr: "",
    });
  });

  it("JSON でない文、error、0 でない終了コードを返す", async () => {
    const fake = fakeOf({
      steps: [
        { raw: "not json" },
        { error: "authentication_failed" },
        { failure: "落ちた" },
      ],
      exitCode: 1,
    });
    const call = fake.provider.call({ purpose: "relate", input: "記事" });
    expect(await drain(call)).toEqual([
      { type: "bad_line" },
      { type: "assistant_error", error: "authentication_failed" },
      {
        type: "result",
        ok: false,
        subtype: "error_during_execution",
        result: null,
        errors: ["落ちた"],
      },
    ]);
    expect(await call.exit).toMatchObject({ kind: "exited", exitCode: 1 });
  });

  it("筋書きの並びは呼んだ順に使い、終わらない筋書きは止めると SIGTERM で終わる", async () => {
    const fake = fakeOf([
      { steps: [{ hang: true }] },
      { steps: [{ result: "2回目" }] },
    ]);
    const controller = new AbortController();
    const first = fake.provider.call({
      purpose: "answer",
      input: "1",
      signal: controller.signal,
    });
    const firstEvents = drain(first);
    await settle();
    controller.abort();
    expect(await first.exit).toEqual({
      kind: "stopped",
      killed: false,
      signal: "SIGTERM",
    });
    expect(await firstEvents).toEqual([]);
    expect(fake.calls[0].signals).toEqual(["SIGTERM"]);

    const second = fake.provider.call({ purpose: "answer", input: "2" });
    expect(await drain(second)).toMatchObject([{ result: "2回目" }]);
  });

  it("止める合図が先に来ていれば起動しない", async () => {
    const fake = fakeOf({ steps: [{ result: "x" }] });
    const controller = new AbortController();
    controller.abort();
    const call = fake.provider.call({
      purpose: "answer",
      input: "1",
      signal: controller.signal,
    });
    expect(await drain(call)).toEqual([]);
    expect(await call.exit).toMatchObject({ kind: "stopped" });
    expect(fake.calls).toEqual([]);
  });

  it("試験のときだけ、標準出力の全ての行を <実行ID>.jsonl（0600）に残す", async () => {
    const logDir = join(dir, "evidence", "ac22", "2026-12-01");
    const fake = fakeOf(
      { steps: [{ text: "a" }, { raw: "not json" }, { result: "a" }] },
      { aiEventLogDir: logDir },
    );
    await drain(
      fake.provider.call({ purpose: "answer", input: "q", runId: 7 }),
    );
    const file = join(logDir, "7.jsonl");
    const lines = readFileSync(file, "utf8").trimEnd().split("\n");
    expect(lines).toHaveLength(4);
    expect(JSON.parse(lines[0])).toMatchObject({
      type: "system",
      subtype: "init",
    });
    expect(lines[2]).toBe("not json");
    expect(statSync(file).mode & 0o777).toBe(0o600);

    // 置き場所が無ければ残さない。
    const plain = fakeOf({ steps: [{ result: "a" }] });
    await drain(
      plain.provider.call({ purpose: "answer", input: "q", runId: 8 }),
    );
    expect(existsSync(join(logDir, "8.jsonl"))).toBe(false);
  });

  it("設定の NEXUS_AI_PROVIDER=fake では偽の AI の決まった応答を返す", async () => {
    const config = loadConfig({ NEXUS_ENV: "test", NEXUS_DATA_DIR: dataDir });
    const provider = createAiProvider(config);
    const relate = await drain(
      provider.call({ purpose: "relate", input: "記事" }),
    );
    expect(relate.at(-1)).toMatchObject({
      type: "result",
      ok: true,
      result: '{"relations":[]}',
    });
    const answer = await drain(
      provider.call({ purpose: "answer", input: "質問" }),
    );
    expect(answer.at(-1)).toMatchObject({ type: "result", ok: true });
  });
});

describe("CLI を起動できない（DD-06 E12）", () => {
  it("コマンドが無ければ launch_failed で終わる", async () => {
    const provider = createAiProviderWith({
      claudeBin: join(dir, "no-such-claude"),
      dataDir,
      brainHarnessDir: null,
      env: RUNNER_ENV,
    });
    const call = provider.call({ purpose: "relate", input: "記事" });
    expect(await drain(call)).toEqual([]);
    expect(await call.exit).toEqual({
      kind: "launch_failed",
      reason: "ENOENT",
    });
  });

  it("標準エラーの鍵の形を伏せて返す（DD-06 5章）", async () => {
    const cli = writeFakeCli({
      ignoreSigterm: false,
      exitAfterInput: true,
      stderr:
        "token sk-ant-secret and AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      exitCode: 3,
    });
    const provider = createAiProviderWith({
      claudeBin: cli.path,
      dataDir,
      brainHarnessDir: null,
      env: RUNNER_ENV,
    });
    const call = provider.call({ purpose: "relate", input: "記事" });
    await drain(call);
    const exit = await call.exit;
    expect(exit).toMatchObject({ kind: "exited", exitCode: 3 });
    if (exit.kind !== "exited") throw new Error("exited でない");
    expect(exit.stderr).not.toContain("sk-ant-secret");
    expect(exit.stderr).not.toContain("A".repeat(43));
  });
});

// --- テストの道具 ---

interface FakeCli {
  path: string;
  markerFile: string;
  argvFile: string;
  stdinFile: string;
}

// 本物の子のプロセスとして動く偽の CLI。シェルを通さず起動されるので、shebang で node を指す。
function writeFakeCli(options: {
  ignoreSigterm: boolean;
  exitAfterInput: boolean;
  stderr?: string;
  exitCode?: number;
}): FakeCli {
  const path = join(dir, "fake-claude.cjs");
  const markerFile = join(dir, "marker.txt");
  const argvFile = join(dir, "argv.json");
  const stdinFile = join(dir, "stdin.txt");
  const script = `#!${process.execPath}
const fs = require("node:fs");
fs.writeFileSync(${JSON.stringify(argvFile)}, JSON.stringify({ argv: process.argv.slice(2), env: process.env, cwd: process.cwd() }));
${options.ignoreSigterm ? `process.on("SIGTERM", () => fs.appendFileSync(${JSON.stringify(markerFile)}, "TERM\\n"));` : ""}
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  fs.writeFileSync(${JSON.stringify(stdinFile)}, input);
  ${options.stderr ? `process.stderr.write(${JSON.stringify(options.stderr)});` : ""}
  ${options.exitAfterInput ? `process.stdout.write(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "ok" }) + "\\n", () => process.exit(${options.exitCode ?? 0}));` : ""}
});
process.stdout.write(JSON.stringify({ type: "system", subtype: "init" }) + "\\n");
fs.appendFileSync(${JSON.stringify(markerFile)}, "READY\\n");
${options.exitAfterInput ? "" : "setInterval(() => {}, 1000);"}
`;
  writeFileSync(path, script);
  chmodSync(path, 0o755);
  return { path, markerFile, argvFile, stdinFile };
}

function markers(cli: FakeCli): string[] {
  return existsSync(cli.markerFile)
    ? readFileSync(cli.markerFile, "utf8").trim().split("\n")
    : [];
}

async function waitFor(check: () => boolean, ms = 10_000): Promise<void> {
  const until = Date.now() + ms;
  while (!check()) {
    if (Date.now() > until) throw new Error("待っても条件にならない");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1)
    await new Promise((resolve) => setImmediate(resolve));
}

interface ManualTimer {
  callback: () => void;
  ms: number;
}

// 偽の時計の猶予（テストが進める）。
function createManualTimers(): Timers & {
  pending(): ManualTimer[];
  fireAll(): void;
} {
  const timers = new Set<ManualTimer>();
  return {
    setTimeout: (callback, ms) => {
      const timer = { callback, ms };
      timers.add(timer);
      return timer;
    },
    clearTimeout: (handle) => {
      timers.delete(handle as ManualTimer);
    },
    pending: () => [...timers],
    fireAll: () => {
      for (const timer of [...timers]) {
        timers.delete(timer);
        timer.callback();
      }
    },
  };
}
