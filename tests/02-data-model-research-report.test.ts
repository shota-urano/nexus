import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openAiJobs } from "../src/server/ai-jobs";
import {
  type Database,
  databasePath,
  openDatabase,
} from "../src/server/db/connection";
import {
  MIGRATIONS_DIR,
  appliedVersion,
  applyMigrations,
  readMigrations,
} from "../src/server/db/migrations";
import { createFakeClock } from "../src/server/shared/clock";
import { NexusError } from "../src/server/shared/errors";

// 02-data-model の実装単位2: マイグレーション 0002-research-report.sql と、
// 外部キーの検査を止めて当てるファイルの扱い（DD-03 5章、DD-01 M21、CR-020）。
// 受け入れ基準は DD-10 TC149。

const AT = "2026-11-25T10:00:00.000+09:00";
const DATE = "2026-11-25";
const MARKER = "-- nexus:foreign-keys-off";
const clock = createFakeClock(new Date(AT));

const dirs: string[] = [];
const dbs: Database[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "nexus-tc149-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const db of dbs.splice(0)) if (db.isOpen) db.close();
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

function only0001() {
  const first = readMigrations(MIGRATIONS_DIR).filter((m) => m.version === 1);
  expect(first.map((m) => m.name)).toEqual(["0001-initial-schema.sql"]);
  return first;
}

function run(db: Database, sql: string, ...params: (string | number | null)[]) {
  db.prepare(sql).run(...params);
}

function rows(db: Database, sql: string): unknown[] {
  return db.prepare(sql).all();
}

// 前提の状態: 0001 だけを当て、`delivery` と、それを指す `content` と `ai_run` の行を入れた DB。
function seed(db: Database): void {
  run(
    db,
    "INSERT INTO delivery (delivery_id, sender, target_date, received_at, item_count, result, rejection_reason) VALUES (1, 'brain-harness', ?, ?, 3, 'accepted', NULL)",
    DATE,
    AT,
  );
  run(
    db,
    "INSERT INTO delivery (delivery_id, sender, target_date, received_at, item_count, result, rejection_reason) VALUES (2, 'sharpen', NULL, ?, 0, 'rejected', '形が違う')",
    AT,
  );
  run(
    db,
    "INSERT INTO sender_key (sender, key_hash, issued_at) VALUES ('brain-harness', 'hash-bh', ?)",
    AT,
  );
  run(
    db,
    "INSERT INTO sender_key (sender, key_hash, issued_at) VALUES ('sharpen', 'hash-sp', ?)",
    AT,
  );
  run(
    db,
    "INSERT INTO content (content_id, kind, title, target_date, received_at, delivery_id) VALUES (10, 'news', '見出し', ?, ?, 1)",
    DATE,
    AT,
  );
  run(
    db,
    "INSERT INTO ai_run (ai_run_id, purpose, relate_delivery_id, created_at) VALUES (20, 'relate', 1, ?)",
    AT,
  );
}

const SNAPSHOT_SQL = {
  delivery: "SELECT * FROM delivery ORDER BY delivery_id",
  sender_key: "SELECT * FROM sender_key ORDER BY sender",
  content: "SELECT * FROM content ORDER BY content_id",
  ai_run: "SELECT * FROM ai_run ORDER BY ai_run_id",
};
function snapshot(db: Database): Record<string, unknown[]> {
  return Object.fromEntries(
    Object.entries(SNAPSHOT_SQL).map(([name, sql]) => [name, rows(db, sql)]),
  );
}

function indexColumns(db: Database, index: string): string[] {
  return db
    .prepare(`PRAGMA index_info(${index})`)
    .all()
    .map((row) => String(row.name));
}

function isUniqueIndex(db: Database, table: string, index: string): boolean {
  const row = db
    .prepare(`PRAGMA index_list(${table})`)
    .all()
    .find((r) => r.name === index);
  return row?.unique === 1;
}

describe("TC149 0001 だけの DB に、Web サーバの起動の処理で 0002 を当てる", () => {
  let dataDir: string;
  let before: Record<string, unknown[]>;
  let db: Database;

  beforeEach(() => {
    dataDir = tempDir();
    const pre = openDatabase(databasePath(dataDir));
    applyMigrations(pre, only0001(), clock);
    expect(appliedVersion(pre)).toBe(1);
    seed(pre);
    before = snapshot(pre);
    pre.close();

    const opened = openAiJobs({ dataDir, clock, startup: "migrate" });
    db = opened.db;
    dbs.push(db);
  });

  it("0002-research-report.sql の1行目が外部キーの検査を止める印", () => {
    const sql = readFileSync(
      join(MIGRATIONS_DIR, "0002-research-report.sql"),
      "utf8",
    );
    expect(sql.split(/\r?\n/)[0]).toBe(MARKER);
  });

  it("0002 が当たり、schema_migration に 2 が残る", () => {
    expect(appliedVersion(db)).toBe(2);
    expect(
      rows(db, "SELECT version, name FROM schema_migration ORDER BY version"),
    ).toEqual([
      { version: 1, name: "0001-initial-schema.sql" },
      { version: 2, name: "0002-research-report.sql" },
    ]);
  });

  it("delivery と sender_key の行と、content と ai_run からの参照がそのまま残る", () => {
    expect(snapshot(db)).toEqual(before);
    for (const table of ["content", "ai_run"]) {
      const fks = db.prepare(`PRAGMA foreign_key_list(${table})`).all();
      const toDelivery = fks.filter((fk) => fk.table === "delivery");
      expect(toDelivery.length, table).toBeGreaterThan(0);
    }
  });

  it("PRAGMA foreign_key_check が空で、integrity_check が ok", () => {
    expect(rows(db, "PRAGMA foreign_key_check")).toEqual([]);
    expect(rows(db, "PRAGMA integrity_check")).toEqual([
      { integrity_check: "ok" },
    ]);
  });

  it("PRAGMA foreign_keys が ON に戻り、delivery への参照の検査が効く", () => {
    expect(rows(db, "PRAGMA foreign_keys")).toEqual([{ foreign_keys: 1 }]);
    expect(() =>
      run(
        db,
        "INSERT INTO content (kind, title, target_date, received_at, delivery_id) VALUES ('news', '無い受け取り', ?, ?, 9999)",
        DATE,
        AT,
      ),
    ).toThrow(/FOREIGN KEY constraint failed/);
  });

  it("delivery の sender に brain-research を入れられ、ほかの値は検査制約で断られる", () => {
    const sql =
      "INSERT INTO delivery (sender, target_date, received_at, item_count, result) VALUES (?, ?, ?, 1, 'accepted')";
    expect(() => run(db, sql, "brain-research", DATE, AT)).not.toThrow();
    expect(() => run(db, sql, "brain-harness", DATE, AT)).not.toThrow();
    expect(() => run(db, sql, "sharpen", DATE, AT)).not.toThrow();
    for (const bad of ["other", "", "Brain-Research"]) {
      expect(() => run(db, sql, bad, DATE, AT), bad).toThrow(
        /CHECK constraint failed/,
      );
    }
  });

  it("sender_key の sender に brain-research を入れられ、ほかの値は検査制約で断られる", () => {
    const sql =
      "INSERT INTO sender_key (sender, key_hash, issued_at) VALUES (?, ?, ?)";
    expect(() => run(db, sql, "brain-research", "hash-br", AT)).not.toThrow();
    for (const bad of ["other", "", "Brain-Research"]) {
      expect(() => run(db, sql, bad, `hash-${bad}-x`, AT), bad).toThrow(
        /CHECK constraint failed/,
      );
    }
  });

  it("作り直した delivery と sender_key は STRICT で、delivery の索引が作り直されている", () => {
    const list = db.prepare("PRAGMA table_list").all();
    for (const name of ["delivery", "sender_key"]) {
      const row = list.find((r) => r.name === name && r.schema === "main");
      expect(row?.strict, name).toBe(1);
    }
    expect(indexColumns(db, "delivery_date_ix")).toEqual([
      "target_date",
      "sender",
      "result",
    ]);
    expect(indexColumns(db, "delivery_received_ix")).toEqual(["received_at"]);
  });

  it("research_topic と research_report が STRICT で作られ、3章の索引がある", () => {
    const list = db.prepare("PRAGMA table_list").all();
    for (const name of ["research_topic", "research_report"]) {
      const row = list.find((r) => r.name === name && r.schema === "main");
      expect(row?.strict, name).toBe(1);
    }
    expect(indexColumns(db, "research_report_week_uq")).toEqual([
      "topic_id",
      "week",
    ]);
    expect(
      isUniqueIndex(db, "research_report", "research_report_week_uq"),
    ).toBe(true);
    expect(indexColumns(db, "research_topic_received_ix")).toEqual([
      "last_received_at",
    ]);
  });
});

describe("TC149 外部キーの違反が残るテスト用のファイルを当てる", () => {
  // 印のあるファイルで、外部キーの検査を止めたあいだに、無い受け取りを指す行を残す。
  const VIOLATION_SQL = [
    MARKER,
    "CREATE TABLE violation_probe (id INTEGER PRIMARY KEY) STRICT;",
    `INSERT INTO content (kind, title, target_date, received_at, delivery_id) VALUES ('news', '違反', '${DATE}', '${AT}', 9999);`,
    "",
  ].join("\n");

  function prepare(): { db: Database; dir: string } {
    const dir = tempDir();
    const [first] = only0001();
    writeFileSync(join(dir, first.name), first.sql);
    writeFileSync(join(dir, "0002-fk-violation.sql"), VIOLATION_SQL);
    const db = openDatabase(databasePath(tempDir()));
    dbs.push(db);
    return { db, dir };
  }

  it("戻され、E17 で止まり、schema_migration に番号が入らず、foreign_keys が ON に戻る", () => {
    const { db, dir } = prepare();
    const migrations = readMigrations(dir);
    applyMigrations(
      db,
      migrations.filter((m) => m.version === 1),
      clock,
    );
    seed(db);
    const before = snapshot(db);

    let thrown: unknown;
    try {
      applyMigrations(db, migrations, clock);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(NexusError);
    expect((thrown as NexusError).code).toBe("STARTUP_MISMATCH");

    expect(appliedVersion(db)).toBe(1);
    expect(rows(db, "SELECT version FROM schema_migration")).toEqual([
      { version: 1 },
    ]);
    expect(
      rows(db, "SELECT name FROM sqlite_schema WHERE name = 'violation_probe'"),
    ).toEqual([]);
    expect(snapshot(db)).toEqual(before);
    expect(rows(db, "PRAGMA foreign_key_check")).toEqual([]);
    expect(rows(db, "PRAGMA foreign_keys")).toEqual([{ foreign_keys: 1 }]);
    expect(db.isTransaction).toBe(false);
  });
});
