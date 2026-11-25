import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runAdminCommand } from "../src/cli/admin";
import { createSenderKeys } from "../src/server/auth/sender-key";
import {
  type Database,
  databasePath,
  openDatabase,
} from "../src/server/db/connection";
import {
  MIGRATIONS_DIR,
  applyMigrations,
  readMigrations,
} from "../src/server/db/migrations";
import { createFakeClock, type FakeClock } from "../src/server/shared/clock";
import { formatMessage } from "../src/server/shared/messages";
import { hashSecret } from "../src/server/shared/secret";

// 03-auth-and-admin の実装単位2: 管理のコマンド M30 の `sender-key issue|list|revoke` と、
// 配信元の鍵を M12 で作り照合する処理（FN-024、DD-01 M30・M12、DD-02 FN-024・3章 P05）。
// 受け入れ基準は TC100。

const NOW = "2026-12-01T08:00:00.000+09:00";

let db: Database;
let clock: FakeClock;
let out: string[];
let err: string[];

const run = (...argv: string[]) =>
  runAdminCommand(argv, {
    senderKeys: createSenderKeys({ db, clock }),
    output: { out: (line) => out.push(line), err: (line) => err.push(line) },
  });

const senderKeyRows = () =>
  db
    .prepare(
      "SELECT sender, key_hash, issued_at FROM sender_key ORDER BY sender",
    )
    .all();

beforeEach(() => {
  clock = createFakeClock(NOW);
  db = openDatabase(":memory:");
  applyMigrations(db, readMigrations(MIGRATIONS_DIR), clock);
  out = [];
  err = [];
});
afterEach(() => {
  if (db.isOpen) db.close();
});

describe("TC100 sender-key issue の配信元の名前が値に無い（FN-024 異常系、DD-06 E07）", () => {
  it("`sender-key issue cerebellum` は MSG-044 と終了コード 1 で、鍵を作らない", () => {
    const code = run("sender-key", "issue", "cerebellum");

    expect(code).toBe(1);
    expect(err).toEqual([
      formatMessage("MSG-044", {
        配信元: "cerebellum",
        配信元の一覧: "brain-harness、sharpen",
      }),
    ]);
    expect(out).toEqual([]);
    expect(senderKeyRows()).toEqual([]);
  });

  it("`sender-key revoke cerebellum` も MSG-044 と終了コード 1", () => {
    const code = run("sender-key", "revoke", "cerebellum");
    expect(code).toBe(1);
    expect(err).toEqual([
      formatMessage("MSG-044", {
        配信元: "cerebellum",
        配信元の一覧: "brain-harness、sharpen",
      }),
    ]);
  });
});

describe("sender-key issue|list|revoke（DD-02 FN-024、3章 P05）", () => {
  it("issue は 43 文字の base64url の鍵を1回だけ出し、照合値だけを残す", () => {
    expect(run("sender-key", "issue", "brain-harness")).toBe(0);
    expect(out).toHaveLength(1);
    const key = out[0];
    expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(senderKeyRows()).toEqual([
      { sender: "brain-harness", key_hash: hashSecret(key), issued_at: NOW },
    ]);
    expect(hashSecret(key)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("issue をもう一度打つと鍵を置き換え、前の鍵は通らない", () => {
    run("sender-key", "issue", "brain-harness");
    const first = out[0];
    clock.advance(60_000);
    run("sender-key", "issue", "brain-harness");
    const second = out[1];
    expect(second).not.toBe(first);

    const keys = createSenderKeys({ db, clock });
    expect(keys.verify(first, "IF-001")).toBeNull();
    expect(keys.verify(second, "IF-001")).toBe("brain-harness");
    expect(senderKeyRows()).toEqual([
      {
        sender: "brain-harness",
        key_hash: hashSecret(second),
        issued_at: "2026-12-01T08:01:00.000+09:00",
      },
    ]);
  });

  it("list は配信元と用意した日時だけを出し、鍵と照合値を出さない", () => {
    run("sender-key", "issue", "sharpen");
    run("sender-key", "issue", "brain-harness");
    const keys = [...out];
    out = [];

    expect(run("sender-key", "list")).toBe(0);
    expect(out).toEqual([`brain-harness\t${NOW}`, `sharpen\t${NOW}`]);
    for (const key of keys) {
      expect(out.join("\n")).not.toContain(key);
      expect(out.join("\n")).not.toContain(hashSecret(key));
    }
  });

  it("revoke は鍵を消し、消した鍵は通らない", () => {
    run("sender-key", "issue", "sharpen");
    const key = out[0];
    expect(run("sender-key", "revoke", "sharpen")).toBe(0);
    expect(senderKeyRows()).toEqual([]);
    expect(createSenderKeys({ db, clock }).verify(key, "IF-002")).toBeNull();
  });

  it("引数が足りないときは使い方を出して終了コード 1", () => {
    expect(run("sender-key", "issue")).toBe(1);
    expect(run("sender-key")).toBe(1);
    expect(out).toEqual([]);
    expect(senderKeyRows()).toEqual([]);
  });
});

describe("配信元の鍵の照合（M12。DD-02 3章 P02 手順 1・2）", () => {
  it("鍵の持ち主が使える連携だけを通す（brain-harness は IF-001、sharpen は IF-002 と IF-003）", () => {
    const keys = createSenderKeys({ db, clock });
    const brain = keys.issue("brain-harness").key;
    const sharpen = keys.issue("sharpen").key;

    expect(keys.verify(brain, "IF-001")).toBe("brain-harness");
    expect(keys.verify(brain, "IF-002")).toBeNull();
    expect(keys.verify(brain, "IF-003")).toBeNull();
    expect(keys.verify(sharpen, "IF-002")).toBe("sharpen");
    expect(keys.verify(sharpen, "IF-003")).toBe("sharpen");
    expect(keys.verify(sharpen, "IF-001")).toBeNull();
  });

  it("鍵が無い、空、知らない鍵は通らない", () => {
    const keys = createSenderKeys({ db, clock });
    keys.issue("brain-harness");
    expect(keys.verify(undefined, "IF-001")).toBeNull();
    expect(keys.verify(null, "IF-001")).toBeNull();
    expect(keys.verify("", "IF-001")).toBeNull();
    expect(keys.verify("not-a-key", "IF-001")).toBeNull();
  });
});

// 管理のコマンドを、プロセスの入口（src/cli/main.ts）から一時のフォルダと一時の DB で動かす（DD-10 1章）。
// 子のプロセスは M26 のほかで起動しない決まり（DD-01 1.3）なので、入口のファイルを Worker で動かし、
// 入口が決めた終了コードと、標準出力と標準エラーを受け取る。
describe("管理のコマンドのプロセスの入口（src/cli/main.ts）", () => {
  const MAIN = new URL("../src/cli/main.ts", import.meta.url);
  let dataDir: string;

  const runMain = (
    argv: string[],
    env: Record<string, string> = {
      NEXUS_ENV: "test",
      NEXUS_DATA_DIR: dataDir,
      TZ: "Asia/Tokyo",
    },
  ) =>
    new Promise<{ status: number; stdout: string[]; stderr: string[] }>(
      (resolve, reject) => {
        const worker = new Worker(MAIN, {
          argv,
          env,
          stdout: true,
          stderr: true,
        });
        const stdout: string[] = [];
        const stderr: string[] = [];
        worker.stdout.on("data", (chunk) => stdout.push(String(chunk)));
        worker.stderr.on("data", (chunk) => stderr.push(String(chunk)));
        worker.on("error", reject);
        worker.on("exit", (status) => {
          const lines = (chunks: string[]) =>
            chunks
              .join("")
              .split("\n")
              .filter((line) => line !== "");
          resolve({ status, stdout: lines(stdout), stderr: lines(stderr) });
        });
      },
    );

  const migrate = () => {
    const file = openDatabase(databasePath(dataDir));
    applyMigrations(file, readMigrations(MIGRATIONS_DIR), clock);
    file.close();
  };

  const fileRows = () => {
    const file = openDatabase(databasePath(dataDir));
    try {
      return file.prepare("SELECT sender, key_hash FROM sender_key").all();
    } finally {
      file.close();
    }
  };

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "nexus-m30-"));
  });
  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("TC100 `sender-key issue cerebellum` は MSG-044 を出し、終了コード 1 で終わる", async () => {
    migrate();
    const result = await runMain(["sender-key", "issue", "cerebellum"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toEqual([
      formatMessage("MSG-044", {
        配信元: "cerebellum",
        配信元の一覧: "brain-harness、sharpen",
      }),
    ]);
    expect(result.stdout).toEqual([]);
    expect(fileRows()).toEqual([]);
  });

  it("`sender-key issue brain-harness` は鍵を1回だけ出し、DB に照合値を残し、終了コード 0", async () => {
    migrate();
    const result = await runMain(["sender-key", "issue", "brain-harness"]);

    expect(result.status).toBe(0);
    expect(result.stderr).toEqual([]);
    expect(result.stdout).toHaveLength(1);
    expect(fileRows()).toEqual([
      { sender: "brain-harness", key_hash: hashSecret(result.stdout[0]) },
    ]);
  });

  it("DB の schema_migration の番号が違えば何もせずに失敗で終わる（DD-03 5章、DD-06 E17）", async () => {
    const result = await runMain(["sender-key", "issue", "brain-harness"]);

    expect(result.status).toBe(1);
    expect(result.stdout).toEqual([]);
    expect(result.stderr).toHaveLength(1);
  });

  it("設定が読めなければ何もせずに失敗で終わる（DD-06 E17）", async () => {
    const result = await runMain(["sender-key", "issue", "brain-harness"], {});

    expect(result.status).toBe(1);
    expect(result.stdout).toEqual([]);
    expect(result.stderr).toHaveLength(1);
  });
});
