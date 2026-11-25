import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  BUSY_TIMEOUT_MS,
  type Database,
  databasePath,
  openDatabase,
} from "../src/server/db/connection";
import { toDbError } from "../src/server/db/errors";
import { checkSqliteFeatures } from "../src/server/db/features";
import {
  appliedVersion,
  applyMigrations,
  readMigrations,
} from "../src/server/db/migrations";
import {
  inReadTransaction,
  inWriteTransaction,
} from "../src/server/db/transaction";
import { createFakeClock } from "../src/server/shared/clock";
import { NexusError } from "../src/server/shared/errors";

// DB の接続 M21（DD-01）のテスト。受け入れ基準は TC109（DD-10 横断）。

const dirs: string[] = [];
const dbs: Database[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "nexus-m21-"));
  dirs.push(dir);
  return dir;
}
function open(path: string): Database {
  const db = openDatabase(path);
  dbs.push(db);
  return db;
}
afterEach(() => {
  for (const db of dbs.splice(0)) if (db.isOpen) db.close();
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

// 0001 の代わりの見本。`schema_migration` は DD-03 2.2 の形。
const SCHEMA_MIGRATION_SQL = `
CREATE TABLE schema_migration (
  version INTEGER NOT NULL PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
) STRICT;
`;
function writeMigrations(files: Record<string, string>): string {
  const dir = tempDir();
  for (const [name, sql] of Object.entries(files)) {
    writeFileSync(join(dir, name), sql);
  }
  return dir;
}

describe("TC109 起動のときの SQLite の機能の確かめ（DD-09 2.1）", () => {
  it("テストの Node.js で、FTS5 の trigram の表と backup が使えると判定する", async () => {
    await expect(checkSqliteFeatures()).resolves.toBeUndefined();
  });
});

describe("接続の設定（DD-05 1章）", () => {
  it("WAL、外部キーの検査、busy_timeout 5,000 ミリ秒で開く", () => {
    const db = open(databasePath(join(tempDir(), "data")));
    expect(db.prepare("PRAGMA journal_mode").get()).toEqual({
      journal_mode: "wal",
    });
    expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({
      foreign_keys: 1,
    });
    expect(db.prepare("PRAGMA busy_timeout").get()).toEqual({
      timeout: BUSY_TIMEOUT_MS,
    });
    expect(BUSY_TIMEOUT_MS).toBe(5000);
  });

  it("置き場所のフォルダが無ければ、本人のユーザだけの権限（0700）で作る（DD-09 2.1）", () => {
    const dataDir = join(tempDir(), "data");
    open(databasePath(dataDir));
    expect(statSync(dataDir).mode & 0o777).toBe(0o700);
    expect(databasePath(dataDir)).toBe(join(dataDir, "nexus.db"));
  });

  it("外部キーに違反する行を拒む", () => {
    const db = open(":memory:");
    db.exec(
      "CREATE TABLE p (id INTEGER PRIMARY KEY) STRICT;" +
        "CREATE TABLE c (id INTEGER PRIMARY KEY, p_id INTEGER NOT NULL REFERENCES p (id)) STRICT;",
    );
    expect(() => db.exec("INSERT INTO c (p_id) VALUES (1)")).toThrow(
      /FOREIGN KEY/,
    );
  });

  it("開けない置き場所は E08（DB_UNAVAILABLE）にする", () => {
    const file = join(tempDir(), "file");
    writeFileSync(file, "");
    // ファイルの下にフォルダは作れない。
    expect(() => openDatabase(join(file, "nexus.db"))).toThrow();
    const dir = tempDir();
    // フォルダを DB として開こうとすると SQLITE_CANTOPEN になる。
    try {
      openDatabase(dir);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(NexusError);
      expect((error as NexusError).code).toBe("DB_UNAVAILABLE");
    }
  });
});

describe("トランザクションの関数（DD-05 1章）", () => {
  function setup(): Database {
    const db = open(databasePath(tempDir()));
    db.exec("CREATE TABLE t (v INTEGER NOT NULL UNIQUE) STRICT");
    return db;
  }
  const count = (db: Database) =>
    db.prepare("SELECT COUNT(*) AS n FROM t").get()?.n;

  it("書き込むトランザクションは関数の結果を返し、確定する", () => {
    const db = setup();
    const result = inWriteTransaction(db, () => {
      expect(db.isTransaction).toBe(true);
      db.prepare("INSERT INTO t (v) VALUES (?)").run(1);
      db.prepare("INSERT INTO t (v) VALUES (?)").run(2);
      return "ok";
    });
    expect(result).toBe("ok");
    expect(db.isTransaction).toBe(false);
    expect(count(db)).toBe(2);
  });

  it("関数が投げたら全て戻し、投げたものをそのまま返す", () => {
    const db = setup();
    const thrown = new NexusError("STATE_CONFLICT", "見本");
    expect(() =>
      inWriteTransaction(db, () => {
        db.prepare("INSERT INTO t (v) VALUES (?)").run(1);
        throw thrown;
      }),
    ).toThrow(thrown);
    expect(db.isTransaction).toBe(false);
    expect(count(db)).toBe(0);
  });

  it("SQL の失敗でも全て戻す（一意の違反は E08 に包まない）", () => {
    const db = setup();
    let caught: unknown;
    try {
      inWriteTransaction(db, () => {
        db.prepare("INSERT INTO t (v) VALUES (?)").run(1);
        db.prepare("INSERT INTO t (v) VALUES (?)").run(1);
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).not.toBeInstanceOf(NexusError);
    expect(caught).toMatchObject({ code: "ERR_SQLITE_ERROR" });
    expect(count(db)).toBe(0);
  });

  it("書き込むトランザクションは BEGIN IMMEDIATE で始め、ほかの接続の書き込みの権利を先に取る", () => {
    const path = databasePath(tempDir());
    const db = open(path);
    db.exec("CREATE TABLE t (v INTEGER) STRICT");
    const other = open(path);
    other.exec("PRAGMA busy_timeout = 0");
    inWriteTransaction(db, () => {
      // まだ何も書いていないが、書き込みの権利は取ってある。
      expect(() => other.exec("BEGIN IMMEDIATE")).toThrow(/locked/);
    });
  });

  it("読むトランザクションは BEGIN（DEFERRED）で始め、ほかの接続の書き込みを止めない", () => {
    const path = databasePath(tempDir());
    const db = open(path);
    db.exec("CREATE TABLE t (v INTEGER) STRICT");
    const other = open(path);
    const seen = inReadTransaction(db, () => {
      const before = db.prepare("SELECT COUNT(*) AS n FROM t").get()?.n;
      other.exec("INSERT INTO t (v) VALUES (1)");
      const after = db.prepare("SELECT COUNT(*) AS n FROM t").get()?.n;
      return [before, after];
    });
    // 同じ時点の値を読む。
    expect(seen).toEqual([0, 0]);
    expect(db.prepare("SELECT COUNT(*) AS n FROM t").get()?.n).toBe(1);
  });

  it("入れ子と、非同期の関数を断る", () => {
    const db = setup();
    expect(() =>
      inWriteTransaction(db, () => inReadTransaction(db, () => 1)),
    ).toThrow(/もう一つ/);
    expect(db.isTransaction).toBe(false);
    expect(() => inWriteTransaction(db, async () => 1)).toThrow(/同期/);
    expect(db.isTransaction).toBe(false);
  });

  it("E08 に当たる SQLite の失敗だけを DB_UNAVAILABLE に包む（DD-06 2章）", () => {
    const sqliteError = (errcode: number) =>
      Object.assign(new Error("x"), { code: "ERR_SQLITE_ERROR", errcode });
    // SQLITE_BUSY、SQLITE_IOERR_READ（拡張）、SQLITE_CORRUPT、SQLITE_FULL、SQLITE_CANTOPEN
    for (const errcode of [5, 266, 11, 13, 14]) {
      const wrapped = toDbError(sqliteError(errcode));
      expect(wrapped).toBeInstanceOf(NexusError);
      expect((wrapped as NexusError).code).toBe("DB_UNAVAILABLE");
    }
    // SQLITE_CONSTRAINT_UNIQUE は E16 として呼んだ側が扱う。
    const unique = sqliteError(2067);
    expect(toDbError(unique)).toBe(unique);
  });
});

describe("マイグレーションを番号の順に当てる仕組み（DD-03 5章）", () => {
  const clock = createFakeClock("2026-11-25T00:00:00.000Z");

  it("まだ当てていないファイルを番号の順に当て、schema_migration に番号を書く", () => {
    const dir = writeMigrations({
      "0002-add-b.sql":
        "CREATE TABLE b (a_id INTEGER REFERENCES a (id)) STRICT;",
      "0001-init.sql":
        SCHEMA_MIGRATION_SQL +
        "CREATE TABLE a (id INTEGER PRIMARY KEY) STRICT;",
      "readme.txt": "SQL ではないファイルは読まない",
    });
    const db = open(databasePath(tempDir()));
    expect(appliedVersion(db)).toBe(0);

    const migrations = readMigrations(dir);
    expect(migrations.map((m) => m.name)).toEqual([
      "0001-init.sql",
      "0002-add-b.sql",
    ]);
    expect(applyMigrations(db, migrations, clock)).toEqual([1, 2]);
    expect(appliedVersion(db)).toBe(2);
    expect(
      db.prepare("SELECT * FROM schema_migration ORDER BY version").all(),
    ).toEqual([
      {
        version: 1,
        name: "0001-init.sql",
        applied_at: "2026-11-25T09:00:00.000+09:00",
      },
      {
        version: 2,
        name: "0002-add-b.sql",
        applied_at: "2026-11-25T09:00:00.000+09:00",
      },
    ]);

    // 当てたファイルは当て直さない。足したファイルだけを当てる。
    writeFileSync(
      join(dir, "0003-add-c.sql"),
      "CREATE TABLE c (id INTEGER) STRICT;",
    );
    expect(applyMigrations(db, readMigrations(dir), clock)).toEqual([3]);
    expect(applyMigrations(db, readMigrations(dir), clock)).toEqual([]);
    expect(appliedVersion(db)).toBe(3);
  });

  it("失敗したファイルは1つのトランザクションごと戻り、前のファイルは当たったまま残る", () => {
    const dir = writeMigrations({
      "0001-init.sql": SCHEMA_MIGRATION_SQL,
      "0002-broken.sql":
        "CREATE TABLE half (id INTEGER) STRICT; CREATE TABLE half (id INTEGER) STRICT;",
      "0003-next.sql": "CREATE TABLE next (id INTEGER) STRICT;",
    });
    const db = open(databasePath(tempDir()));
    expect(() => applyMigrations(db, readMigrations(dir), clock)).toThrow(
      /already exists/,
    );
    expect(appliedVersion(db)).toBe(1);
    const tables = db
      .prepare("SELECT name FROM sqlite_schema WHERE type = 'table'")
      .all()
      .map((row) => row.name);
    expect(tables).not.toContain("half");
    expect(tables).not.toContain("next");
  });

  it("名前の形が違う、番号が抜ける、重なるファイルは当てる前に断る", () => {
    const cases: Record<string, string>[] = [
      { "0001-Init.sql": "" },
      { "1-init.sql": "" },
      { "0001-init.sql": "", "0003-skip.sql": "" },
      { "0001-init.sql": "", "0001-again.sql": "" },
      { "0002-start.sql": "" },
    ];
    for (const files of cases) {
      expect(() => readMigrations(writeMigrations(files))).toThrow(
        /マイグレーション/,
      );
    }
  });
});
