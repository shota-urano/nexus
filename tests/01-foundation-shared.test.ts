import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createFakeClock } from "../src/server/shared/clock";
import { loadConfig } from "../src/server/shared/config";
import {
  daysBetween,
  formatDate,
  formatDateTime,
} from "../src/server/shared/datetime";
import {
  ERROR_CLASSES,
  NexusError,
  logLevelOf,
} from "../src/server/shared/errors";
import { REDACTED, createLogger } from "../src/server/shared/logger";
import { MESSAGES, formatMessage } from "../src/server/shared/messages";
import {
  createRequestId,
  createSecret,
  hashSecret,
} from "../src/server/shared/secret";

// 共通層 M23（DD-01）のテスト。受け入れ基準は TC106 と TC111（DD-10 横断）。

const DAY_MS = 24 * 60 * 60 * 1000;
const dirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "nexus-m23-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

function readLines(dir: string, name: string): Record<string, unknown>[] {
  return readFileSync(join(dir, name), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe("TC106 ログに残してはいけない項目（DD-06 5章、NFR-019）", () => {
  it("鍵と sk- の文字は伏せられ、質問の本文は出ない", () => {
    const dir = tempDir();
    const clock = createFakeClock("2026-12-01T08:00:00.000+09:00");
    const logger = createLogger({ process: "runner", clock, dir });

    const key = createSecret();
    expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const apiKey = "sk-ant-api03-AbCdEf_123-xyz";
    const question = "私的な質問の本文: 来月の通院の予定を整理して";

    // 例外の文に鍵と sk- の文字があり、例外と、ログに渡す値に質問の本文がある。
    const error = Object.assign(
      new NexusError(
        "AI_INTERRUPTED",
        `CLI の標準エラー: key=${key} token ${apiKey} で失敗`,
        {
          cause: new Error(question),
        },
      ),
      { question, input: { body: question } },
    );
    const entry = {
      level: "warn" as const,
      code: error.code,
      target: "FN-015",
      aiRunId: 12,
      detail: `Bearer ${key}`,
      error,
      // 型に無い欄で本文を渡しても書かない。
      question,
      body: question,
    };
    logger.log(entry);

    const text = readFileSync(join(dir, "runner-2026-12-01.log"), "utf8");
    expect(text).not.toContain(key);
    expect(text).not.toContain("sk-ant");
    expect(text).not.toContain(question);
    expect(text).not.toContain("通院");
    expect(text).toContain(REDACTED);

    const [line] = readLines(dir, "runner-2026-12-01.log");
    expect(Object.keys(line).sort()).toEqual(
      ["aiRunId", "at", "code", "detail", "level", "process", "target"].sort(),
    );
    expect(line).toMatchObject({
      at: "2026-12-01T08:00:00.000+09:00",
      level: "warn",
      process: "runner",
      code: "AI_INTERRUPTED",
      target: "FN-015",
      aiRunId: 12,
    });
    expect(line.detail).toContain("NexusError(AI_INTERRUPTED)");
  });

  it("例外の文にある質問の本文と照合値は、NexusError でも残さない", () => {
    const dir = tempDir();
    const clock = createFakeClock("2026-12-01T08:00:00.000+09:00");
    const logger = createLogger({ process: "web", clock, dir });
    const question = "私的な質問の本文: 来月の通院の予定を整理して";
    const key = createSecret();
    const hash = hashSecret(key);

    // 外の部品の例外（文に本文と照合値。SQLite の形）。
    const sqlite = Object.assign(
      new Error(`fts5: syntax error near "${question}" ${hash}`),
      { code: "SQLITE_ERROR", errstr: "SQL logic error" },
    );
    logger.log({ level: "error", code: "INTERNAL", error: sqlite });
    // 文に本文を入れた種類の名前と符号。
    const odd = Object.assign(new Error(question), {
      code: question,
      errstr: question,
    });
    odd.name = question;
    logger.log({ level: "error", code: "INTERNAL", error: odd });
    // NexusError の文にある照合値も伏せる。
    logger.log({
      level: "warn",
      code: "AUTH_DENIED",
      error: new NexusError("AUTH_DENIED", `照合値 ${hash} が無い`),
    });
    // NexusError の文に質問の本文を入れてしまっても書かない（DD-10 TC106）。
    logger.log({
      level: "error",
      code: "INTERNAL",
      error: new NexusError("INTERNAL", question),
    });
    // 渡した detail にある照合値も伏せる。
    logger.log({ level: "warn", detail: `hash=${hash}` });

    const text = readFileSync(join(dir, "web-2026-12-01.log"), "utf8");
    expect(text).not.toContain(question);
    expect(text).not.toContain("通院");
    expect(text).not.toContain(hash);
    expect(text).not.toContain(key);
    const lines = readLines(dir, "web-2026-12-01.log");
    expect(lines[0].detail).toBe(
      "Error(SQLITE_ERROR) [SQL logic error]（文は残さない）",
    );
    expect(lines[1].detail).toBe("Error（文は残さない）");
    expect(lines[2].detail).toBe("NexusError(AUTH_DENIED)（文は残さない）");
    expect(lines[3].detail).toBe("NexusError(INTERNAL)（文は残さない）");
    expect(lines[4].detail).toBe(`hash=${REDACTED}`);
  });

  it("例外でない値は中身を書かない", () => {
    const dir = tempDir();
    const clock = createFakeClock("2026-12-01T08:00:00.000+09:00");
    const logger = createLogger({ process: "web", clock, dir });
    logger.log({ level: "error", code: "INTERNAL", error: "質問の本文" });
    expect(readFileSync(join(dir, "web-2026-12-01.log"), "utf8")).not.toContain(
      "質問の本文",
    );
  });
});

describe("TC111 日ごとのログと古いファイルの削除（DD-09 2.6、CR-013）", () => {
  it("日が替わると 31 日前のファイルだけが消え、今日のファイルに書かれる", () => {
    const dir = tempDir();
    // 前の日に書いている途中で、日本時間の 0 時をまたぐ。
    const clock = createFakeClock("2026-11-30T23:59:59.000+09:00");
    const logger = createLogger({ process: "web", clock, dir });
    logger.log({ level: "info", target: "FN-001" });
    expect(readdirSync(dir)).toEqual(["web-2026-11-30.log"]);

    const today = "2026-12-01";
    const daysAgo = (n: number) =>
      formatDate(
        new Date(new Date(`${today}T12:00:00+09:00`).getTime() - n * DAY_MS),
      );
    const old = [29, 30, 31].map((n) => `web-${daysAgo(n)}.log`);
    expect(old).toEqual([
      "web-2026-11-02.log",
      "web-2026-11-01.log",
      "web-2026-10-31.log",
    ]);
    for (const name of old) writeFileSync(join(dir, name), "{}\n");
    // ほかのプロセスのファイルと launchd のファイルは、このプロセスでは消さない。
    writeFileSync(join(dir, `runner-${daysAgo(31)}.log`), "{}\n");
    writeFileSync(join(dir, "launchd-web.log"), "");

    clock.advance(1000);
    logger.log({ level: "info", target: "FN-003", msg: "MSG-031" });

    expect(existsSync(join(dir, "web-2026-11-02.log"))).toBe(true);
    expect(existsSync(join(dir, "web-2026-11-01.log"))).toBe(true);
    expect(existsSync(join(dir, "web-2026-10-31.log"))).toBe(false);
    expect(existsSync(join(dir, "runner-2026-10-31.log"))).toBe(true);
    expect(existsSync(join(dir, "launchd-web.log"))).toBe(true);
    expect(existsSync(join(dir, "web-2026-11-30.log"))).toBe(true);

    expect(readLines(dir, `web-${today}.log`)).toEqual([
      {
        at: "2026-12-01T00:00:00.000+09:00",
        level: "info",
        process: "web",
        msg: "MSG-031",
        target: "FN-003",
      },
    ]);
    expect(readLines(dir, "web-2026-11-30.log")).toHaveLength(1);
  });
});

describe("M23 時計と日時の形（DD-02 3章 P09）", () => {
  it("日本時間で YYYY-MM-DDTHH:MM:SS.sss+09:00 の形にする", () => {
    const at = new Date("2026-11-30T15:04:05.007Z");
    expect(formatDateTime(at)).toBe("2026-12-01T00:04:05.007+09:00");
    expect(formatDate(at)).toBe("2026-12-01");
    expect(formatDate(new Date("2026-11-30T14:59:59.999Z"))).toBe("2026-11-30");
  });

  it("偽の時計は決めた今を返し、進められる", () => {
    const clock = createFakeClock("2026-12-01T08:00:00.000+09:00");
    expect(formatDateTime(clock.now())).toBe("2026-12-01T08:00:00.000+09:00");
    clock.advance(5 * 60 * 1000);
    expect(formatDateTime(clock.now())).toBe("2026-12-01T08:05:00.000+09:00");
    clock.set("2026-12-02T07:00:00.000+09:00");
    expect(formatDate(clock.now())).toBe("2026-12-02");
    expect(() => createFakeClock("not a date")).toThrow(RangeError);
  });

  it("日付の間の日数を数え、存在しない日付は null にする", () => {
    expect(daysBetween("2026-10-31", "2026-12-01")).toBe(31);
    expect(daysBetween("2026-02-30", "2026-12-01")).toBeNull();
    expect(daysBetween("2026-13-01", "2026-12-01")).toBeNull();
    expect(daysBetween("2026-00-01", "2026-12-01")).toBeNull();
  });
});

describe("M23 乱数と照合値（DD-02 3章 P05）", () => {
  it("鍵は 43 文字の base64url で、照合値は SHA-256 の16進の小文字 64 文字", () => {
    const a = createSecret();
    const b = createSecret();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
    expect(hashSecret("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(hashSecret(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(createRequestId()).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe("M23 MSG の一覧（BD-09 1章）", () => {
  it("BD-09 の MSG を全て持ち、差し込む値を埋める", () => {
    const ids = Object.keys(MESSAGES);
    // BD-09 1章の MSG-001〜MSG-021、MSG-031〜MSG-050（MSG-046〜MSG-050 は CR-020）。
    expect(ids).toHaveLength(41);
    expect(ids).toContain("MSG-021");
    expect(ids).toContain("MSG-045");
    for (const id of ["MSG-046", "MSG-047", "MSG-048", "MSG-049", "MSG-050"]) {
      expect(ids).toContain(id);
    }
    expect(
      formatMessage("MSG-046", {
        理由: "予期しない失敗",
      }),
    ).toBe(
      "週報を残せませんでした（予期しない失敗）。この週報は残していません。送り直してください。",
    );
    expect(formatMessage("MSG-047")).toBe("調査の週報はまだ届いていません。");
    expect(formatMessage("MSG-048")).toBe("週報が見つかりません。");
    expect(formatMessage("MSG-049", { 項目: "answerMd" })).toBe(
      "週報を送りませんでした。answerMd の形が正しくありません。",
    );
    expect(
      formatMessage("MSG-050", {
        理由: "接続を断られた",
      }),
    ).toBe(
      "NEXUS に送れませんでした（接続を断られた）。NEXUS が動いているかを確かめてから送り直してください。",
    );
    expect(
      formatMessage("MSG-031", { 配信元: "brain-harness", 件数: 10 }),
    ).toBe("brain-harness から 10 件を受け取りました。");
    expect(formatMessage("MSG-002")).toBe("記事が見つかりません。");
    expect(() => formatMessage("MSG-037")).toThrow();
  });
});

describe("M23 エラーの型と内部のエラーコード（DD-06 2章）", () => {
  it("E01〜E17 に内部のエラーコードとログの重さがある", () => {
    expect(Object.keys(ERROR_CLASSES)).toHaveLength(17);
    expect(logLevelOf("STARTUP_MISMATCH")).toBe("fatal");
    const error = new NexusError("DB_UNAVAILABLE", "SQLITE_BUSY", {
      msg: "MSG-003",
    });
    expect(error).toBeInstanceOf(Error);
    expect(error.errorClass).toBe("E08");
    expect(error.level).toBe("error");
    expect(error.msg).toBe("MSG-003");
  });
});

describe("M23 設定の読み込み（DD-09 2.3）", () => {
  const production = {
    NEXUS_ENV: "production",
    NEXUS_DATA_DIR: "/Users/me/Library/Application Support/nexus",
    NEXUS_LOG_DIR: "/Users/me/Library/Logs/nexus",
    NEXUS_PORT: "48400",
    NEXUS_ORIGIN: "https://nexus.example.ts.net",
    NEXUS_BACKUP_DIR: "/Volumes/disk/nexus-backup",
    NEXUS_AI_PROVIDER: "claude",
    NEXUS_CLAUDE_BIN: "/Users/me/.local/bin/claude",
    NEXUS_BRAIN_HARNESS_DIR: "/Users/me/projects/brain-harness",
    TZ: "Asia/Tokyo",
  };

  it("本番の設定を読む", () => {
    expect(loadConfig(production)).toEqual({
      env: "production",
      dataDir: production.NEXUS_DATA_DIR,
      logDir: production.NEXUS_LOG_DIR,
      port: 48400,
      origin: production.NEXUS_ORIGIN,
      backupDir: production.NEXUS_BACKUP_DIR,
      aiProvider: "claude",
      claudeBin: production.NEXUS_CLAUDE_BIN,
      brainHarnessDir: production.NEXUS_BRAIN_HARNESS_DIR,
      aiEventLogDir: null,
    });
  });

  it.each([
    ["NEXUS_ENV が無い", { ...production, NEXUS_ENV: undefined }],
    ["NEXUS_LOG_DIR が無い", { ...production, NEXUS_LOG_DIR: undefined }],
    ["道が絶対でない", { ...production, NEXUS_DATA_DIR: "nexus" }],
    ["ポートが数でない", { ...production, NEXUS_PORT: "48400a" }],
    [
      "オリジンに道がある",
      { ...production, NEXUS_ORIGIN: "https://nexus.example.ts.net/x" },
    ],
    ["TZ が違う", { ...production, TZ: "UTC" }],
    ["CLI の道が無い", { ...production, NEXUS_CLAUDE_BIN: "" }],
  ])("%s ときは E17（STARTUP_MISMATCH）で止まる", (_, env) => {
    let caught: unknown;
    try {
      loadConfig(env);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(NexusError);
    expect((caught as NexusError).code).toBe("STARTUP_MISMATCH");
  });

  it.each([
    ["本番", { ...production, NEXUS_AI_EVENT_LOG_DIR: "/tmp/evidence" }],
    [
      "開発",
      { NEXUS_ENV: "development", NEXUS_AI_EVENT_LOG_DIR: "/tmp/evidence" },
    ],
  ])(
    "試験だけの NEXUS_AI_EVENT_LOG_DIR は%sでは E17 で止まる（DD-09 2.3、2.5）",
    (_, env) => {
      let caught: unknown;
      try {
        loadConfig(env, { cwd: "/repo" });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(NexusError);
      expect((caught as NexusError).code).toBe("STARTUP_MISMATCH");
    },
  );

  it("試験だけの NEXUS_AI_EVENT_LOG_DIR は試験では読む（DD-09 2.5）", () => {
    expect(
      loadConfig({
        NEXUS_ENV: "test",
        NEXUS_DATA_DIR: "/tmp/nexus-test",
        NEXUS_AI_EVENT_LOG_DIR: "/tmp/nexus-test/evidence/ac22/2026-12-01",
      }).aiEventLogDir,
    ).toBe("/tmp/nexus-test/evidence/ac22/2026-12-01");
  });

  it("開発と試験は DD-09 2.2 の値を既定にする", () => {
    const dev = loadConfig({ NEXUS_ENV: "development" }, { cwd: "/repo" });
    expect(dev).toMatchObject({
      dataDir: "/repo/.data/dev",
      logDir: null,
      port: 48402,
      origin: "http://localhost:48402",
      backupDir: "/repo/.data/dev/backup",
      aiProvider: "fake",
    });
    const test = loadConfig({
      NEXUS_ENV: "test",
      NEXUS_DATA_DIR: "/tmp/nexus-test",
    });
    expect(test).toMatchObject({
      logDir: "/tmp/nexus-test/logs",
      port: 48401,
      origin: "http://localhost:48401",
      backupDir: "/tmp/nexus-test/backup",
      aiProvider: "fake",
    });
    expect(() => loadConfig({ NEXUS_ENV: "test" })).toThrow(NexusError);
  });
});
