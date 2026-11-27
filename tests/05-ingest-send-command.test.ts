import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import {
  type IncomingMessage,
  type Server,
  type ServerResponse,
  createServer,
} from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { postResearchReport } from "../src/app/api/_entry/research-report";
import { spawnLauncher } from "../src/runner/ai-provider/launcher";
import { createSenderKeys } from "../src/server/auth/sender-key";
import { type Database, openDatabase } from "../src/server/db/connection";
import { createIngest } from "../src/server/ingest";
import { createFakeClock } from "../src/server/shared/clock";
import { createLogger } from "../src/server/shared/logger";
import { formatMessage } from "../src/server/shared/messages";
import { DIST, REPO, withBuild } from "./fixtures/build";
import { NOW, migrate } from "./fixtures/news";

// 05-ingest の実装単位5: 送信のコマンド M34 `nexus-send`（引数とファイルと環境変数の確かめ、
// M10 の `ResearchReportPayload` での形の確かめ、IF-005 への送信、終了コード）と、
// `npm run build` で `dist/cli/send/main.js` を作ることと、`deploy/nexus-send` の雛形
// （FN-028、DD-01 M34、DD-02 FN-028、DD-06 E18、DD-09 2.7、CR-020）。
// 受け入れ基準は TC146、TC147、TC148 と、`deploy/nexus-send` の雛形に Node.js の道と
// `dist/cli/send/main.js` の道を書き込む場所があること。
//
// コマンドは送り手のユーザで別のプロセスとして動くので（DD-01 M34、DD-09 2.7）、試験も子のプロセスで動かし、
// 引数、環境変数、標準出力、標準エラー出力、終了コードだけを見る。入口は `src/cli/send/main.ts`（DD-09 2.7）。
// 子の環境変数は試験が決めたものだけにする（試験を動かす人の環境変数を渡さない）。
//
// - TC146 の「試験の Web サーバ」は、一時のポートで待ち受け、`/api/research/reports` を
//   本物の `postResearchReport`（一時のフォルダの空の DB）に渡す HTTP のサーバにする。
// - TC147、TC148 の送り先は、一時のポートで待ち受ける偽のサーバにする（DD-10 3章 外部の相手の代わり）。
//   決めた状態の番号を返し、呼ばれた回数と `Authorization` の欄を記録し、答えずに待つこともできる。
// - TC148 の「30 秒を超えて答えない送り先（時計は偽）」: コマンドは別のプロセスなので、試験から時計を差し替える
//   口が書類に無い。差し替えの口を推測で決めず、本当に答えない送り先を相手に、30 秒で諦めることを本物の時間で確かめる。
// - 雛形に書き込む場所の名前は、`deploy/` のほかの雛形と構築のスクリプト（deploy/setup.sh）が使う
//   `__NODE__`（Node.js の絶対の道）と `__REPO__`（リポジトリ）に合わせる（DD-09 2.6・2.7・4章 手順 3）。
//   `dist/cli/send/main.js` の道は `__REPO__/dist/cli/send/main.js` と書く（launchd の雛形と同じ書き方）。

const SEND_MAIN = join(REPO, "src/cli/send/main.ts");
const TEMPLATE = join(REPO, "deploy/nexus-send");
const KIB = 1024;
const REPORT_MAX_BYTES = 256 * KIB;
const TEST_KEY = "nexus-send-test-key-0123456789abcdef";

let work: string;

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "nexus-send-"));
});

afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

// ---- 週報の本文（IF-005） ----

function report(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    source: "brain-research",
    topicId: "second-brain",
    topicTitle: "RAG の評価",
    week: 7,
    sentOn: "2026-12-01",
    status: "active",
    answerMd: "ＲＡＧ は評価の軸を先に決める。",
    approaches: [
      {
        title: "評価の軸を決める",
        howToMd: "正しさと網羅の2つの軸を先に決める。",
        sourceUrls: ["https://example.com/research/axis-1"],
        marks: ["added"],
        counterMd: null,
      },
      {
        title: "人が読む",
        howToMd: "週に 20 件を人が読んで確かめる。",
        sourceUrls: [],
        marks: [],
        counterMd: null,
      },
    ],
    unknownsMd: "人の評価との差はまだ分からない。",
    changesMd: "変化なし",
    ...patch,
  };
}

function writeFile(name: string, text: string): string {
  const path = join(work, name);
  writeFileSync(path, text);
  return path;
}

function writeReport(name = "report.json", body = report()): string {
  return writeFile(name, JSON.stringify(body));
}

// 形の正しい週報を、末尾の空白で埋めてちょうど bytes バイトにしたファイル。
function writeReportOfBytes(name: string, bytes: number): string {
  const text = JSON.stringify(report());
  const padded = text + " ".repeat(bytes - Buffer.byteLength(text, "utf8"));
  if (Buffer.byteLength(padded, "utf8") !== bytes) throw new Error("大きさ");
  return writeFile(name, padded);
}

// ---- コマンドを動かす ----

interface Result {
  code: number | null;
  stdout: string;
  stderr: string;
  ms: number;
}

async function runCommand(
  command: string,
  args: string[],
  env: Record<string, string>,
  timeoutMs = 60_000,
): Promise<Result> {
  const started = Date.now();
  const child = spawnLauncher({
    command,
    args,
    env: { PATH: "/usr/bin:/bin", HOME: work, TMPDIR: work, ...env },
    cwd: work,
  });
  const lines: string[] = [];
  const reading = (async () => {
    for await (const line of child.lines) lines.push(line);
  })();
  const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
  child.writeInput("");
  await reading;
  const end = await child.ended;
  clearTimeout(timer);
  if (end.launchError !== null) throw new Error(end.launchError);
  return {
    code: end.code,
    stdout: lines.join("\n"),
    stderr: child.stderr(),
    ms: Date.now() - started,
  };
}

// `nexus-send <args>` を `node src/cli/send/main.ts <args>` で動かす。
function nexusSend(
  args: string[],
  env: Record<string, string>,
  timeoutMs?: number,
): Promise<Result> {
  return runCommand(process.execPath, [SEND_MAIN, ...args], env, timeoutMs);
}

const sendArgs = (file: string) => [
  "--source",
  "brain-research",
  "--kind",
  "research-report",
  file,
];

// ---- 送り先 ----

interface Call {
  method: string;
  path: string;
  authorization: string | undefined;
  body: string;
}

interface Target {
  url: string;
  calls: Call[];
  close: () => Promise<void>;
}

async function listen(
  handle: (req: IncomingMessage, res: ServerResponse, call: Call) => void,
): Promise<Target> {
  const calls: Call[] = [];
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const call: Call = {
        method: req.method ?? "",
        path: new URL(req.url ?? "/", "http://127.0.0.1").pathname,
        authorization: req.headers.authorization,
        body: Buffer.concat(chunks).toString("utf8"),
      };
      calls.push(call);
      handle(req, res, call);
    });
  });
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve()),
  );
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    calls,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

// 決めた状態の番号と本文を返す偽のサーバ。
function fakeTarget(status: number, body: unknown): Promise<Target> {
  return listen((_req, res) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  });
}

// 受け取るが答えずに待つ偽のサーバ。
function silentTarget(): Promise<Target> {
  return listen(() => {
    // 答えない。
  });
}

// 止まっている送り先（待ち受けていたポートを閉じた後の URL）。
async function stoppedTarget(): Promise<string> {
  const target = await listen(() => undefined);
  await target.close();
  return target.url;
}

const acceptedBody = {
  source: "brain-research",
  topicId: "second-brain",
  week: 7,
  receivedAt: "2026-12-01T08:00:00+09:00",
  replaced: false,
};

const errorBody = (
  code: string,
  id: "MSG-032" | "MSG-034" | "MSG-046",
  values?: Record<string, string>,
) => ({
  error: { code, message: formatMessage(id, values), messageId: id },
});

// MSG-049 の前と後ろ（{項目} の名前が書類で決まっていないときに使う）。
const MSG049_HEAD = "週報を送りませんでした。";
const MSG049_TAIL = " の形が正しくありません。";
// MSG-050 の前と後ろ（{理由} は失敗ごとに変わる）。
const MSG050_HEAD = "NEXUS に送れませんでした（";
const MSG050_TAIL =
  "）。NEXUS が動いているかを確かめてから送り直してください。";

function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  });
}

// ---- TC146 ----

describe("TC146 形の正しい週報を試験の Web サーバに送ると受け取られる（FN-028、DD-02 FN-028、DD-09 2.7）", () => {
  let db: Database;
  let KR: string;
  let serverLogDir: string;
  let cliLogDir: string;
  let server: Target;
  const clock = createFakeClock(NOW);

  beforeEach(async () => {
    clock.set(NOW);
    db = openDatabase(join(work, "nexus.db"));
    migrate(db);
    KR = createSenderKeys({ db, clock }).issue("brain-research").key;
    serverLogDir = join(work, "server-logs");
    cliLogDir = join(work, "cli-logs");
    const logger = createLogger({ process: "web", clock, dir: serverLogDir });
    const handler = postResearchReport({
      logger,
      senderKeys: createSenderKeys({ db, clock }),
      ingest: createIngest({ db, clock, logger }),
    });
    server = await listen((req, res, call) => {
      if (call.path !== "/api/research/reports" || call.method !== "POST") {
        res.writeHead(404).end();
        return;
      }
      const headers = new Headers();
      for (const [name, value] of Object.entries(req.headers)) {
        if (typeof value === "string") headers.set(name, value);
      }
      void handler(
        new Request(`http://127.0.0.1:48400${call.path}`, {
          method: "POST",
          headers,
          body: call.body,
        }),
      ).then(async (response) => {
        res.writeHead(response.status, {
          "content-type": response.headers.get("content-type") ?? "",
        });
        res.end(await response.text());
      });
    });
  });

  afterEach(async () => {
    await server.close();
    if (db.isOpen) db.close();
  });

  it("終了コード 0、標準出力に MSG-031 と topicId と week。NEXUS に週報が残り、鍵がどこにも出ない", async () => {
    const file = writeReport();
    const result = await nexusSend(sendArgs(file), {
      NEXUS_SEND_URL: server.url,
      NEXUS_SENDER_KEY: KR,
      NEXUS_LOG_DIR: cliLogDir,
    });

    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain(
      formatMessage("MSG-031", { 配信元: "brain-research", 件数: "1" }),
    );
    expect(result.stdout).toContain("second-brain");
    expect(result.stdout).toContain("7");

    // 送り先は `NEXUS_SEND_URL` の `/api/research/reports` で、鍵は Bearer で付ける（DD-02 FN-028 手順 5）。
    expect(server.calls).toHaveLength(1);
    expect(server.calls[0].path).toBe("/api/research/reports");
    expect(server.calls[0].authorization).toBe(`Bearer ${KR}`);

    // NEXUS に週報が残る。
    const row = db
      .prepare(
        `SELECT t.topic_key AS topicKey, r.week AS week
           FROM research_report r JOIN research_topic t ON t.topic_id = r.topic_id`,
      )
      .all() as { topicKey: string; week: number }[];
    expect(row).toEqual([{ topicKey: "second-brain", week: 7 }]);

    // 鍵は標準出力、標準エラー出力、ログに出さない（NFR-019、DD-02 FN-028 手順 7）。
    expect(result.stdout).not.toContain(KR);
    expect(result.stderr).not.toContain(KR);
    for (const path of [
      ...filesUnder(serverLogDir),
      ...filesUnder(cliLogDir),
    ]) {
      expect(readFileSync(path, "utf8"), path).not.toContain(KR);
    }
  }, 60_000);
});

// ---- TC147 ----

describe("TC147 送る前の確かめに外れたら MSG-049 と終了コード 2 で、送り先を呼ばない（FN-028 異常系、DD-02 2章 C11）", () => {
  let target: Target;

  beforeEach(async () => {
    target = await fakeTarget(200, acceptedBody);
  });

  afterEach(async () => {
    await target.close();
  });

  const env = () => ({
    NEXUS_SEND_URL: target.url,
    NEXUS_SENDER_KEY: TEST_KEY,
  });

  async function expectRefused(
    args: string[],
    childEnv: Record<string, string>,
    item: string | null,
  ): Promise<void> {
    const result = await nexusSend(args, childEnv);
    const output = result.stdout + result.stderr;
    expect(result.code, output).toBe(2);
    if (item === null) {
      expect(output).toContain(MSG049_HEAD);
      expect(output).toContain(MSG049_TAIL);
    } else {
      expect(output).toContain(formatMessage("MSG-049", { 項目: item }));
    }
    expect(output).not.toContain(TEST_KEY);
    expect(target.calls).toHaveLength(0);
  }

  it("必須の項目（topicTitle）の無いファイルは、項目 topicTitle", async () => {
    const body = report();
    delete body.topicTitle;
    await expectRefused(
      sendArgs(writeReport("no-title.json", body)),
      env(),
      "topicTitle",
    );
  }, 60_000);

  it("256 KiB を超えるファイルは、項目「全体の大きさ」", async () => {
    const file = writeReportOfBytes("large.json", REPORT_MAX_BYTES + 1);
    await expectRefused(sendArgs(file), env(), "全体の大きさ");
  }, 60_000);

  it("JSON でないファイルは、項目「本文」", async () => {
    const file = writeFile("broken.json", "{ これは JSON ではない");
    await expectRefused(sendArgs(file), env(), "本文");
  }, 60_000);

  it("無いファイルは MSG-049", async () => {
    // {項目}「外れた引数」の名前（ファイルの引数をどう呼ぶか）は書類に無いので、MSG-049 の前と後ろで確かめる。
    await expectRefused(sendArgs(join(work, "missing.json")), env(), null);
  }, 60_000);

  it("--source brain-harness は、項目 --source", async () => {
    await expectRefused(
      ["--source", "brain-harness", "--kind", "research-report", writeReport()],
      env(),
      "--source",
    );
  }, 60_000);

  it("--kind news は、項目 --kind", async () => {
    await expectRefused(
      ["--source", "brain-research", "--kind", "news", writeReport()],
      env(),
      "--kind",
    );
  }, 60_000);

  it("NEXUS_SENDER_KEY の無い環境は、項目 NEXUS_SENDER_KEY", async () => {
    await expectRefused(
      sendArgs(writeReport()),
      { NEXUS_SEND_URL: target.url },
      "NEXUS_SENDER_KEY",
    );
  }, 60_000);

  it("NEXUS_SEND_URL の無い環境は、項目 NEXUS_SEND_URL（DD-02 FN-028 手順 4）", async () => {
    await expectRefused(
      sendArgs(writeReport()),
      { NEXUS_SENDER_KEY: TEST_KEY },
      "NEXUS_SEND_URL",
    );
  }, 60_000);

  it("ちょうど 256 KiB の形の正しいファイルは送る（超えたときだけ止める）", async () => {
    const file = writeReportOfBytes("just.json", REPORT_MAX_BYTES);
    const result = await nexusSend(sendArgs(file), env());
    expect(result.code, result.stdout + result.stderr).toBe(0);
    expect(target.calls).toHaveLength(1);
  }, 60_000);
});

// ---- TC148 ----

describe("TC148 NEXUS が断ったか、つながらないときは終了コード 1 で、送り直さない（FN-028 異常系、DD-06 E18）", () => {
  it.each([
    {
      status: 401,
      body: errorBody("unauthorized", "MSG-032"),
      message: formatMessage("MSG-032"),
    },
    {
      status: 413,
      body: errorBody("payload_too_large", "MSG-034"),
      message: formatMessage("MSG-034"),
    },
    {
      status: 500,
      body: errorBody("internal", "MSG-046", { 理由: "試験の失敗" }),
      message: formatMessage("MSG-046", { 理由: "試験の失敗" }),
    },
  ])(
    "$status は応答の MSG を標準エラー出力に出し、終了コード 1。呼ばれたのは1回",
    async ({ status, body, message }) => {
      const target = await fakeTarget(status, body);
      try {
        const result = await nexusSend(sendArgs(writeReport()), {
          NEXUS_SEND_URL: target.url,
          NEXUS_SENDER_KEY: TEST_KEY,
        });
        expect(result.code, result.stdout + result.stderr).toBe(1);
        expect(result.stderr).toContain(message);
        expect(result.stdout + result.stderr).not.toContain(TEST_KEY);
        expect(target.calls).toHaveLength(1);
        expect(target.calls[0].path).toBe("/api/research/reports");
        expect(target.calls[0].authorization).toBe(`Bearer ${TEST_KEY}`);
      } finally {
        await target.close();
      }
    },
    60_000,
  );

  it("止まっている送り先は MSG-050 と終了コード 1", async () => {
    const url = await stoppedTarget();
    const result = await nexusSend(sendArgs(writeReport()), {
      NEXUS_SEND_URL: url,
      NEXUS_SENDER_KEY: TEST_KEY,
    });
    const output = result.stdout + result.stderr;
    expect(result.code, output).toBe(1);
    expect(output).toContain(MSG050_HEAD);
    expect(output).toContain(MSG050_TAIL);
    expect(output).not.toContain(TEST_KEY);
  }, 60_000);

  it("30 秒を超えて答えない送り先は、30 秒で諦めて MSG-050 と終了コード 1。呼ばれたのは1回", async () => {
    const target = await silentTarget();
    try {
      const result = await nexusSend(
        sendArgs(writeReport()),
        { NEXUS_SEND_URL: target.url, NEXUS_SENDER_KEY: TEST_KEY },
        90_000,
      );
      const output = result.stdout + result.stderr;
      expect(result.code, output).toBe(1);
      expect(output).toContain(MSG050_HEAD);
      expect(output).toContain(MSG050_TAIL);
      expect(output).not.toContain(TEST_KEY);
      // 待つのは 30 秒まで（DD-02 FN-028 手順 5、DD-09 2.7）。プロセスの起動の分だけ幅を持たせる。
      expect(result.ms).toBeGreaterThanOrEqual(29_500);
      expect(result.ms).toBeLessThan(45_000);
      expect(target.calls).toHaveLength(1);
    } finally {
      await target.close();
    }
  }, 120_000);
});

// ---- npm run build と deploy/nexus-send の雛形 ----

describe("npm run build が dist/cli/send/main.js を作り、deploy/nexus-send の雛形から nexus-send を作れる（DD-09 2.7・4章 手順 2、3）", () => {
  it("deploy/nexus-send の雛形に、Node.js の道（__NODE__）と dist/cli/send/main.js の道（__REPO__/dist/cli/send/main.js）を書き込む場所がある", () => {
    expect(existsSync(TEMPLATE)).toBe(true);
    expect(statSync(TEMPLATE).isFile()).toBe(true);
    const text = readFileSync(TEMPLATE, "utf8");
    expect(text).toContain("__NODE__");
    expect(text).toContain("__REPO__/dist/cli/send/main.js");
  });

  it("npm run build の後に dist/cli/send/main.js があり、雛形に2つの道を書き込んだ実行のファイルが nexus-send として動く", async () => {
    const target = await fakeTarget(200, acceptedBody);
    try {
      await withBuild(async () => {
        const main = join(DIST, "cli/send/main.js");
        expect(existsSync(main) && statSync(main).isFile()).toBe(true);

        // dist の入口を node で直に動かしても、送る前の確かめが働く。
        const direct = await runCommand(
          process.execPath,
          [
            main,
            "--source",
            "brain-harness",
            "--kind",
            "research-report",
            writeReport(),
          ],
          { NEXUS_SEND_URL: target.url, NEXUS_SENDER_KEY: TEST_KEY },
        );
        expect(direct.code, direct.stdout + direct.stderr).toBe(2);
        expect(direct.stdout + direct.stderr).toContain(
          formatMessage("MSG-049", { 項目: "--source" }),
        );
        expect(target.calls).toHaveLength(0);

        // 構築のとき（DD-09 4章 手順 3）と同じく、Node.js の絶対の道とリポジトリの絶対の道を書き込み、
        // 実行の権限を付けて、その絶対の道で呼ぶ（`PATH` に node が無くても動く）。
        const filled = readFileSync(TEMPLATE, "utf8")
          .replaceAll("__NODE__", process.execPath)
          .replaceAll("__REPO__", REPO);
        expect(filled).not.toMatch(/__[A-Z_]+__/);
        const bin = join(work, "nexus-send");
        writeFileSync(bin, filled);
        chmodSync(bin, 0o755);

        const sent = await runCommand(bin, sendArgs(writeReport()), {
          NEXUS_SEND_URL: target.url,
          NEXUS_SENDER_KEY: TEST_KEY,
        });
        expect(sent.code, sent.stdout + sent.stderr).toBe(0);
        expect(sent.stdout).toContain(
          formatMessage("MSG-031", { 配信元: "brain-research", 件数: "1" }),
        );
        expect(target.calls).toHaveLength(1);
        expect(target.calls[0].authorization).toBe(`Bearer ${TEST_KEY}`);
        expect(JSON.parse(target.calls[0].body)).toEqual(report());
      });
    } finally {
      await target.close();
    }
  }, 600_000);
});
