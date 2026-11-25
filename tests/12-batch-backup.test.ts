import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Worker } from "node:worker_threads";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJobLock } from "../src/jobs/lock";
import { runJobProcess } from "../src/jobs/process";
import { spawnLauncher } from "../src/runner/ai-provider/launcher";
import { createSenderKeys } from "../src/server/auth/sender-key";
import {
  type Database,
  databasePath,
  openDatabase,
} from "../src/server/db/connection";
import { createFakeClock } from "../src/server/shared/clock";
import { formatDate } from "../src/server/shared/datetime";
import { formatMessage } from "../src/server/shared/messages";
import { NOW, insertD1News, insertDelivery, migrate } from "./fixtures/news";

// 12-batch の実装単位1: 定期ジョブの入口 M27（バッチの名前の引数、`job_lock` の行での多重起動の防止、
// 開始と終了のログ、終了コード）と、BAT-001 データのバックアップ M28、多重起動の印 M31。
// FN-021、DD-02 FN-021、DD-05 4章、DD-06 E14・E15。受け入れ基準は TC85〜TC89、TC118、TC124。
// 入口（M27）から一時のフォルダと一時の DB で動かす（DD-10 1章）。今は 2026-12-01 08:00（日本時間）。

const TODAY = "2026-12-01";
const MAIN = join(import.meta.dirname, "../src/jobs/main.ts");
const NEWS_WORKER = new URL("./12-batch-news-worker.ts", import.meta.url);
const LOCK_WORKER = new URL("./12-batch-lock-worker.ts", import.meta.url);
const JOB_CHILD = join(import.meta.dirname, "12-batch-job-child.ts");
const SRC = join(import.meta.dirname, "../src");

let dir: string;
let dataDir: string;
let backupDir: string;
let db: Database;
let locked: string[];
const clock = createFakeClock(NOW);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-batch-"));
  dataDir = join(dir, "data");
  backupDir = join(dir, "backup");
  mkdirSync(backupDir);
  clock.set(NOW);
  locked = [];
  db = openDatabase(databasePath(dataDir));
  migrate(db);
  insertD1News(db);
});

afterEach(async () => {
  for (const path of locked) await chflags("nouchg", path);
  if (db.isOpen) db.close();
  rmSync(dir, { recursive: true, force: true });
});

function env(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    NEXUS_ENV: "test",
    NEXUS_DATA_DIR: dataDir,
    NEXUS_BACKUP_DIR: backupDir,
    ...overrides,
  };
}

function runBackupJob(
  options: Partial<Parameters<typeof runJobProcess>[1]> = {},
): Promise<number> {
  return runJobProcess(["backup"], {
    env: env(),
    clock,
    stderr: () => undefined,
    ...options,
  });
}

function logLines(date = TODAY): Record<string, unknown>[] {
  const path = join(dataDir, "logs", `job-${date}.log`);
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

// 置き場所の写しの名前（`nexus-YYYY-MM-DD.db`）と、作りかけの名前（`.partial`）。
function backupNames(): string[] {
  return readdirSync(backupDir)
    .filter((name) => /^nexus-\d{4}-\d{2}-\d{2}\.db$/.test(name))
    .sort();
}
function partialNames(): string[] {
  return readdirSync(backupDir).filter((name) => name.endsWith(".partial"));
}

function placeOldBackups(from: number, to: number): void {
  for (let day = from; day <= to; day += 1) {
    writeFileSync(join(backupDir, `nexus-2026-11-${day}.db`), "old");
  }
}

// 写しを読むだけで開いて、中身を確かめる。
function readCopy<T>(path: string, read: (copy: DatabaseSync) => T): T {
  const copy = new DatabaseSync(path, { readOnly: true });
  try {
    return read(copy);
  } finally {
    copy.close();
  }
}

function countRows(target: DatabaseSync | Database, table: string): number {
  const row = target.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get();
  return Number(row?.n);
}

function lockRows(): { job_name: string; pid: number }[] {
  return db
    .prepare("SELECT job_name, pid FROM job_lock ORDER BY job_name, pid")
    .all()
    .map((row) => ({ job_name: String(row.job_name), pid: Number(row.pid) }));
}

function insertLock(pid: number): void {
  db.prepare(
    "INSERT INTO job_lock (job_name, pid, started_at) VALUES ('backup', ?, ?)",
  ).run(pid, "2026-11-30T03:00:00.000+09:00");
}

// 終わったプロセスの番号（どのプロセスにも当たらない番号を探す）。
function deadPid(): number {
  for (let pid = 4_000_000; pid < 4_100_000; pid += 1) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if ((error as { code?: unknown }).code === "ESRCH") return pid;
    }
  }
  throw new Error("終わったプロセスの番号が見つからない");
}

// macOS のファイルの「変えられない」印（uchg）を付け外しする。付いている間は、フォルダに書けても消せない。
// 子のプロセスを起動するのは M26 の起動の口だけなので（DD-01 1.3）、それを使う。
async function chflags(flag: "uchg" | "nouchg", path: string): Promise<void> {
  const child = spawnLauncher({
    command: "/usr/bin/chflags",
    args: [flag, path],
    env: { PATH: "/usr/bin:/bin" },
    cwd: dir,
  });
  child.writeInput("");
  const { code } = await child.ended;
  if (code !== 0) throw new Error(`chflags ${flag} が ${code} で終わった`);
}

// 子のプロセスを動かして、標準出力の行と終わり方を返す。
function spawnNode(args: string[], cwd: string) {
  const child = spawnLauncher({
    command: process.execPath,
    args,
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin", ...env() },
    cwd,
  });
  child.writeInput("");
  // 最初の1行だけを読む（呼んだときだけ読む）。
  const firstLine = async (): Promise<string> => {
    for await (const line of child.lines) return line;
    throw new Error(`子のプロセスが何も出さずに終わった: ${child.stderr()}`);
  };
  return { child, firstLine };
}

async function waitFor(check: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`${label} を待ちきれない`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

// src の TypeScript を型だけ取り除いて JavaScript（`.js`）にし、`<root>/dist` に同じ形で置く。
// マイグレーションの `.sql` も同じ場所に写す。画面の `.tsx` と試験は含めない。
// 本番の起動のコマンド `node dist/jobs/main.js` を確かめるため（DD-09 2.6）。
function buildDist(root: string): void {
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "package.json"), '{ "type": "module" }\n');
  const walk = (from: string): void => {
    for (const entry of readdirSync(from, { withFileTypes: true })) {
      const path = join(from, entry.name);
      if (entry.isDirectory()) {
        walk(path);
        continue;
      }
      if (entry.name.endsWith(".sql")) {
        const out = join(root, "dist", relative(SRC, path));
        mkdirSync(dirname(out), { recursive: true });
        writeFileSync(out, readFileSync(path));
        continue;
      }
      if (!entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts"))
        continue;
      if (entry.name.endsWith(".d.ts")) continue;
      const out = join(root, "dist", relative(SRC, path)).replace(
        /\.ts$/,
        ".js",
      );
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(
        out,
        stripTypeScriptTypes(readFileSync(path, "utf8"), { mode: "strip" }),
      );
    }
  };
  walk(SRC);
}

describe("TC85 BAT-001 の正常", () => {
  it("今日の写しを権限 0600 で作り、2026-11-24 以前の写しを消して7日分を残し、MSG-038 をログに出して終了コード 0", async () => {
    placeOldBackups(20, 30);

    const code = await runBackupJob();

    expect(code).toBe(0);
    expect(backupNames()).toEqual([
      "nexus-2026-11-25.db",
      "nexus-2026-11-26.db",
      "nexus-2026-11-27.db",
      "nexus-2026-11-28.db",
      "nexus-2026-11-29.db",
      "nexus-2026-11-30.db",
      "nexus-2026-12-01.db",
    ]);
    expect(partialNames()).toEqual([]);
    const copyPath = join(backupDir, "nexus-2026-12-01.db");
    expect(statSync(copyPath).mode & 0o777).toBe(0o600);
    // 写しは DB の全体（DD-02 FN-021 手順 3）。
    readCopy(copyPath, (copy) => {
      expect(countRows(copy, "content")).toBe(countRows(db, "content"));
      expect(
        copy.prepare("PRAGMA integrity_check").get()?.integrity_check,
      ).toBe("ok");
    });

    const lines = logLines();
    const done = lines.filter((line) => line.msg === "MSG-038");
    expect(done).toHaveLength(1);
    expect(done[0]?.level).toBe("info");
    expect(String(done[0]?.detail)).toContain(
      formatMessage("MSG-038", { 置き場所: copyPath }),
    );
    expect(String(done[0]?.detail)).toMatch(/写しの大きさ \d+ バイト/);
    // 開始と終了をログに出す（BD-02 5.4 ログ）。
    const details = lines.map((line) => String(line.detail));
    expect(details[0]).toContain("BAT-001 データのバックアップを始めた");
    expect(details.at(-1)).toContain(
      "BAT-001 データのバックアップを終えた（終了コード 0）",
    );
    expect(lines.every((line) => line.target === "BAT-001")).toBe(true);
    // 終わった後に印が無い。
    expect(lockRows()).toEqual([]);
  });
});

describe("TC85 前の回の作りかけの写し（DD-02 FN-021 手順 3）", () => {
  it("前の日や今日の .partial が残っていると、先に消してから写しを作り、.partial が残らない", async () => {
    writeFileSync(join(backupDir, "nexus-2026-11-30.db.partial"), "half");
    writeFileSync(join(backupDir, "nexus-2026-12-01.db.partial"), "half");

    const code = await runBackupJob();

    expect(code).toBe(0);
    expect(partialNames()).toEqual([]);
    expect(backupNames()).toEqual(["nexus-2026-12-01.db"]);
  });
});

describe("TC86 置き場所が使えない（DD-06 E14）", () => {
  it("置き場所のフォルダが無いと、写しを作らず、MSG-039 をログに出して終了コード 2", async () => {
    const missing = join(dir, "no-disk", "nexus-backup");

    const code = await runBackupJob({
      env: env({ NEXUS_BACKUP_DIR: missing }),
    });

    expect(code).toBe(2);
    expect(existsSync(missing)).toBe(false);
    expect(existsSync(join(dir, "no-disk"))).toBe(false);
    const failed = logLines().filter((line) => line.msg === "MSG-039");
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({
      level: "error",
      code: "BACKUP_TARGET_UNAVAILABLE",
      target: "BAT-001",
    });
    expect(String(failed[0]?.detail)).toContain(
      formatMessage("MSG-039", { 理由: "別のディスクが無いか書けない" }),
    );
    expect(lockRows()).toEqual([]);
  });

  it("置き場所のフォルダに書けないと、写しを作らずに終了コード 2", async () => {
    const readOnly = join(dir, "read-only");
    mkdirSync(readOnly, { mode: 0o500 });
    try {
      const code = await runBackupJob({
        env: env({ NEXUS_BACKUP_DIR: readOnly }),
      });
      expect(code).toBe(2);
      expect(readdirSync(readOnly)).toEqual([]);
      expect(
        logLines().filter(
          (line) =>
            line.msg === "MSG-039" && line.code === "BACKUP_TARGET_UNAVAILABLE",
        ),
      ).toHaveLength(1);
    } finally {
      rmSync(readOnly, { recursive: true, force: true });
    }
  });
});

describe("TC87 古い写しを消せない（DD-06 E15）", () => {
  it("消せない古い写しがあると、今日の写しを残し、ほかの古い写しは消し、MSG-039 を警告で出して終了コード 1", async () => {
    placeOldBackups(20, 21);
    const stuck = join(backupDir, "nexus-2026-11-20.db");
    await chflags("uchg", stuck);
    locked.push(stuck);

    const code = await runBackupJob();

    expect(code).toBe(1);
    expect(backupNames()).toEqual([
      "nexus-2026-11-20.db",
      "nexus-2026-12-01.db",
    ]);
    expect(partialNames()).toEqual([]);
    expect(statSync(join(backupDir, "nexus-2026-12-01.db")).mode & 0o777).toBe(
      0o600,
    );
    const warned = logLines().filter((line) => line.msg === "MSG-039");
    expect(warned).toHaveLength(1);
    expect(warned[0]).toMatchObject({
      level: "warn",
      code: "BACKUP_CLEANUP_FAILED",
      target: "BAT-001",
    });
    expect(String(warned[0]?.detail)).toContain(
      formatMessage("MSG-039", { 理由: "古い写しを消せない" }),
    );
    expect(String(warned[0]?.detail)).toContain("nexus-2026-11-20.db");
    expect(logLines().filter((line) => line.msg === "MSG-038")).toEqual([]);
    expect(String(logLines().at(-1)?.detail)).toContain("終了コード 1");
    expect(lockRows()).toEqual([]);
  });
});

describe("TC88 バッチの多重起動（DD-05 4章）", () => {
  it("生きているプロセスの番号の印があると、何もせずにログに残して終了コード 0 で終わり、その印を消さない", async () => {
    // このテストのプロセスの親（生きている、ジョブとは別のプロセス）が印を持っている。
    const holder = process.ppid;
    insertLock(holder);

    const code = await runBackupJob();

    expect(code).toBe(0);
    expect(backupNames()).toEqual([]);
    expect(partialNames()).toEqual([]);
    const lines = logLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ level: "info", target: "BAT-001" });
    expect(String(lines[0]?.detail)).toContain(
      `プロセス ${holder} で動いているので、何もせずに終わる`,
    );
    expect(lockRows()).toEqual([{ job_name: "backup", pid: holder }]);
  });

  it("終わったプロセスの番号の印があると、印を作り直して写しを作り、終わった後に印が無い", async () => {
    insertLock(deadPid());
    // 写している間の印が、このプロセスの番号に作り直されていることを見る。
    let during: { job_name: string; pid: number }[] = [];

    const code = await runBackupJob({
      backupCopy: {
        pagesPerStep: 1,
        onProgress: () => {
          if (during.length === 0) during = lockRows();
        },
      },
    });

    expect(code).toBe(0);
    expect(during).toEqual([{ job_name: "backup", pid: process.pid }]);
    expect(backupNames()).toEqual(["nexus-2026-12-01.db"]);
    expect(logLines().filter((line) => line.msg === "MSG-038")).toHaveLength(1);
    expect(lockRows()).toEqual([]);
  });

  it("本番と同じ入口（src/jobs/main.ts）を子のプロセスで動かすと、自分の番号で印を取り、写しを作って終了コード 0 で終わる", async () => {
    insertLock(deadPid());
    const child = spawnLauncher({
      command: process.execPath,
      args: [MAIN, "backup"],
      env: { PATH: process.env.PATH ?? "/usr/bin:/bin", ...env() },
      cwd: dir,
    });
    child.writeInput("");
    const { code } = await child.ended;

    expect(code).toBe(0);
    // 子のプロセスは本当の時計で動く。
    const today = formatDate(new Date());
    expect(backupNames()).toEqual([`nexus-${today}.db`]);
    expect(statSync(join(backupDir, `nexus-${today}.db`)).mode & 0o777).toBe(
      0o600,
    );
    expect(lockRows()).toEqual([]);
  });

  it("印の番号が自分と同じでも、そのプロセスが生きていれば取らない", () => {
    const lock = createJobLock({ db, clock });

    expect(lock.acquire("backup", process.pid)).toEqual({ acquired: true });
    expect(lock.acquire("backup", process.pid)).toEqual({
      acquired: false,
      holderPid: process.pid,
    });
    expect(lockRows()).toEqual([{ job_name: "backup", pid: process.pid }]);
  });

  it("仕様の起動のコマンド（node dist/jobs/main.js backup）で動かすと、写しを作って終了コード 0 で終わる", async () => {
    const root = join(dir, "app");
    buildDist(root);
    insertLock(deadPid());

    const { child } = spawnNode(["dist/jobs/main.js", "backup"], root);
    const { code } = await child.ended;

    expect(code, child.stderr()).toBe(0);
    const today = formatDate(new Date());
    expect(backupNames()).toEqual([`nexus-${today}.db`]);
    expect(statSync(join(backupDir, `nexus-${today}.db`)).mode & 0o777).toBe(
      0o600,
    );
    expect(
      logLines(today).filter((line) => line.msg === "MSG-038"),
    ).toHaveLength(1);
    expect(lockRows()).toEqual([]);
  });

  it("DB を開けない（SQLITE_CANTOPEN）と、MSG-039 と DB_UNAVAILABLE をログに出して終了コード 2", async () => {
    const broken = join(dir, "broken");
    // DB のファイルの場所にフォルダがあると、SQLite は開けない。
    mkdirSync(databasePath(broken), { recursive: true });
    const logDir = join(broken, "logs");

    const code = await runBackupJob({
      env: env({ NEXUS_DATA_DIR: broken, NEXUS_LOG_DIR: logDir }),
    });

    expect(code).toBe(2);
    expect(backupNames()).toEqual([]);
    const lines = readFileSync(join(logDir, `job-${TODAY}.log`), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const failed = lines.filter((line) => line.msg === "MSG-039");
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({
      level: "error",
      code: "DB_UNAVAILABLE",
      target: "BAT-001",
    });
    expect(String(failed[0]?.detail)).toContain(
      formatMessage("MSG-039", { 理由: "DB が使えない" }),
    );
  });

  it("バッチの名前が無いか違うと、使い方を出して何もせずに終了コード 2", async () => {
    for (const argv of [[], ["restore"], ["backup", "extra"]]) {
      const errors: string[] = [];
      const code = await runJobProcess(argv, {
        env: env(),
        clock,
        stderr: (line) => errors.push(line),
      });
      expect(code, argv.join(" ")).toBe(2);
      expect(errors.join("\n")).toContain("使い方");
    }
    expect(backupNames()).toEqual([]);
    expect(lockRows()).toEqual([]);
  });

  it("DB のマイグレーションの番号が違うと、印を取らずに E17 をログに残して終了コード 2", async () => {
    const code = await runBackupJob({ knownVersion: 999 });

    expect(code).toBe(2);
    expect(backupNames()).toEqual([]);
    const fatal = logLines().filter((line) => line.code === "STARTUP_MISMATCH");
    expect(fatal).toHaveLength(1);
    expect(fatal[0]?.level).toBe("fatal");
    expect(lockRows()).toEqual([]);
  });
});

describe("TC89 写している間の書き込み（DD-05 3章 DB の全体）", () => {
  it("写している間に別の接続で postNewsBatch を流しても、送信は 200 で、写しは integrity_check で ok", async () => {
    const key = createSenderKeys({ db, clock }).issue("brain-harness").key;
    const body = JSON.stringify({
      source: "brain-collect",
      date: TODAY,
      items: [
        {
          slug: "during-backup",
          kind: "read",
          title: "写している間に届いた記事",
          bodyMd: "写している間に届いた記事の案内",
          url: "https://example.com/articles/during-backup",
          imageUrl: null,
          theme: "AI",
        },
      ],
    });
    const signal = new SharedArrayBuffer(3 * Int32Array.BYTES_PER_ELEMENT);
    const shared = new Int32Array(signal);
    const worker = new Worker(NEWS_WORKER, {
      workerData: {
        path: databasePath(dataDir),
        logDir: join(dir, "web-logs"),
        now: NOW,
        key,
        body,
        signal,
      },
    });
    const sent = new Promise<{ status: number }>((resolve, reject) => {
      worker.on("message", (message: { ready?: boolean; status?: number }) => {
        if (message.status !== undefined) resolve({ status: message.status });
      });
      worker.once("error", reject);
    });
    await new Promise<void>((resolve, reject) => {
      worker.once("message", () => resolve());
      worker.once("error", reject);
    });

    let progressCalls = 0;
    let statusDuringCopy = 0;
    const code = await runBackupJob({
      backupCopy: {
        // 1頁ずつ写し、最初の頁を写した後に、別の接続に送らせて、送り終えるまで待つ。
        pagesPerStep: 1,
        onProgress: () => {
          progressCalls += 1;
          if (progressCalls !== 1) return;
          Atomics.store(shared, 0, 1);
          Atomics.notify(shared, 0);
          const waited = Atomics.wait(shared, 2, 0, 15_000);
          if (waited === "timed-out") throw new Error("送信が終わらない");
          statusDuringCopy = Atomics.load(shared, 1);
        },
      },
    });

    expect(code).toBe(0);
    expect(statusDuringCopy).toBe(200);
    expect((await sent).status).toBe(200);
    // 写しの途中で頁が残っていた（写している間に送った）。
    expect(progressCalls).toBeGreaterThan(1);
    readCopy(join(backupDir, "nexus-2026-12-01.db"), (copy) => {
      expect(
        copy.prepare("PRAGMA integrity_check").get()?.integrity_check,
      ).toBe("ok");
    });
    await worker.terminate();
  });
});

describe("TC118 2つのプロセスの同時の起動（DD-05 4章。RV16-03）", () => {
  it("終わったプロセスの印があるとき、2つのプロセスが同時に印を取ろうとしても、取れるのは片方だけ", async () => {
    insertLock(deadPid());
    // 2つのプロセスの番号（どちらも生きている。印を取った方を、もう片方が生きていると見る）。
    const pids = [process.pid, process.ppid];
    const barrier = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
    const results = await Promise.all(
      pids.map(
        (pid) =>
          new Promise<{ acquired: boolean; holderPid?: number }>(
            (resolve, reject) => {
              const worker = new Worker(LOCK_WORKER, {
                workerData: {
                  path: databasePath(dataDir),
                  now: NOW,
                  pid,
                  barrier,
                  parties: pids.length,
                },
              });
              worker.once("message", resolve);
              worker.once("error", reject);
            },
          ),
      ),
    );

    const winners = results.filter((result) => result.acquired);
    expect(winners).toHaveLength(1);
    const winner = pids[results.findIndex((result) => result.acquired)];
    const loser = pids.find((pid) => pid !== winner) as number;
    expect(results.find((result) => !result.acquired)?.holderPid).toBe(winner);
    expect(lockRows()).toEqual([{ job_name: "backup", pid: winner }]);

    // 消す処理は自分の番号の行だけを消す。
    const lock = createJobLock({ db, clock });
    expect(lock.release("backup", loser)).toBe(false);
    expect(lockRows()).toEqual([{ job_name: "backup", pid: winner }]);
    expect(lock.release("backup", winner)).toBe(true);
    expect(lockRows()).toEqual([]);
  });

  it("2つのプロセスで同時に backup を動かすと、写しを作るのは片方だけで、もう片方は何もせずに終了コード 0。片方が終わった後にその番号で消しても、ほかの番号の行は残る", async () => {
    insertLock(deadPid());
    const first = process.pid;
    const second = process.ppid;

    const running = runBackupJob({ pid: first });
    // 先に起動した方は、印を取って写している途中。
    expect(lockRows()).toEqual([{ job_name: "backup", pid: first }]);
    const skipped = runBackupJob({ pid: second });
    expect(await skipped).toBe(0);
    // 何もせずに終わった方の番号で消す処理を呼ぶ。写している方の行は残る。
    expect(createJobLock({ db, clock }).release("backup", second)).toBe(false);
    expect(lockRows()).toEqual([{ job_name: "backup", pid: first }]);

    expect(await running).toBe(0);
    expect(backupNames()).toEqual(["nexus-2026-12-01.db"]);
    const lines = logLines();
    expect(lines.filter((line) => line.msg === "MSG-038")).toHaveLength(1);
    expect(
      lines.filter((line) =>
        String(line.detail).includes(
          `プロセス ${first} で動いているので、何もせずに終わる`,
        ),
      ),
    ).toHaveLength(1);
    expect(lockRows()).toEqual([]);
  });
});

describe("TC118 2つのプロセスで同時に backup を動かす（DD-05 4章。RV16-03）", () => {
  it("写しを作るのは片方だけで、もう片方は何もせずに終了コード 0。片方が終わった後にその番号で消しても、写している方の行は残る", async () => {
    insertLock(deadPid());
    const holdDir = join(dir, "hold");
    mkdirSync(holdDir);

    // 2つのプロセスを同時に起動する。印を取った方は、写し始めたところで親の合図を待つ。
    const started = [0, 1].map(() => spawnNode([JOB_CHILD, NOW, holdDir], dir));
    const pids = await Promise.all(
      started.map(async ({ firstLine }) => Number(await firstLine())),
    );
    const ends = started.map(({ child }, index) =>
      child.ended.then((end) => ({ index, code: end.code })),
    );

    // 先に終わるのは、何もせずに終わる方。
    const skipped = await Promise.race(ends);
    expect(skipped.code, started[skipped.index]?.child.stderr()).toBe(0);
    const loser = pids[skipped.index] as number;
    const winner = pids[1 - skipped.index] as number;
    await waitFor(
      () => existsSync(join(holdDir, `copying-${winner}`)),
      "写し始め",
    );
    expect(existsSync(join(holdDir, `copying-${loser}`))).toBe(false);
    expect(lockRows()).toEqual([{ job_name: "backup", pid: winner }]);

    // 何もせずに終わった方の番号で消す処理を呼ぶ。写している方の行は残る。
    expect(createJobLock({ db, clock }).release("backup", loser)).toBe(false);
    expect(lockRows()).toEqual([{ job_name: "backup", pid: winner }]);

    writeFileSync(join(holdDir, "go"), "");
    const copied = (await Promise.all(ends))[1 - skipped.index];
    expect(copied?.code, started[1 - skipped.index]?.child.stderr()).toBe(0);

    expect(backupNames()).toEqual(["nexus-2026-12-01.db"]);
    expect(partialNames()).toEqual([]);
    const lines = logLines();
    const done = lines.filter((line) => line.msg === "MSG-038");
    expect(done).toHaveLength(1);
    expect(
      lines.filter((line) =>
        String(line.detail).includes(
          `プロセス ${winner} で動いているので、何もせずに終わる`,
        ),
      ),
    ).toHaveLength(1);
    expect(lockRows()).toEqual([]);
  });
});

describe("TC124 再処理のときの重複（DD-05 4章）", () => {
  it("backup を続けて2回動かすと、今日の写しは1つで、2回目の写しに置き換わり、.partial が残らない", async () => {
    expect(await runBackupJob()).toBe(0);
    const copyPath = join(backupDir, "nexus-2026-12-01.db");
    const firstCount = readCopy(copyPath, (copy) =>
      countRows(copy, "delivery"),
    );

    // 1回目と2回目の間に DB を変える（2回目の写しで置き換わったことを見分けるため）。
    insertDelivery(db, TODAY, NOW, 1);
    expect(await runBackupJob()).toBe(0);

    expect(backupNames()).toEqual(["nexus-2026-12-01.db"]);
    expect(partialNames()).toEqual([]);
    expect(statSync(copyPath).mode & 0o777).toBe(0o600);
    expect(readCopy(copyPath, (copy) => countRows(copy, "delivery"))).toBe(
      firstCount + 1,
    );
    expect(logLines().filter((line) => line.msg === "MSG-038")).toHaveLength(2);
    expect(lockRows()).toEqual([]);
  });
});
