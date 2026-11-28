import { mkdtempSync, readFileSync, rmSync } from "node:fs";
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

// 02-data-model の CR-024 の行: マイグレーション 0003-research-roadmap.sql（DD-03 2.1、2.2、3章、5章）。
// 受け入れ基準は DD-10 TC154。

const AT = "2026-11-28T10:00:00.000+09:00";
const DATE = "2026-11-28";
const MARKER = "-- nexus:foreign-keys-off";
const clock = createFakeClock(new Date(AT));

const dirs: string[] = [];
const dbs: Database[] = [];
afterEach(() => {
  for (const db of dbs.splice(0)) if (db.isOpen) db.close();
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

function run(db: Database, sql: string, ...params: (string | number | null)[]) {
  db.prepare(sql).run(...params);
}

function rows(db: Database, sql: string): unknown[] {
  return db.prepare(sql).all();
}

const APPROACHES = JSON.stringify([
  {
    title: "方法1",
    howToMd: "する",
    sourceUrls: [],
    marks: ["added"],
    counterMd: null,
  },
  { title: "方法2", howToMd: "する", sourceUrls: [], marks: [] },
  { title: "方法3", howToMd: "する", sourceUrls: [], marks: [] },
]);

// 前提: 0001 と 0002 だけを当て、週報（方法3件）と、それを指す `content`、`content_state`、
// `conversation` の行を入れた DB。
function seed(db: Database): void {
  run(
    db,
    "INSERT INTO delivery (delivery_id, sender, target_date, received_at, item_count, result) VALUES (1, 'brain-research', ?, ?, 1, 'accepted')",
    DATE,
    AT,
  );
  run(
    db,
    "INSERT INTO content (content_id, kind, title, target_date, received_at, delivery_id) VALUES (10, 'research', '課題（1週目）', ?, ?, 1)",
    DATE,
    AT,
  );
  run(
    db,
    "INSERT INTO research_topic (topic_id, topic_key, title, status, last_week, last_received_at) VALUES (5, 'second-brain', '課題', 'active', 1, ?)",
    AT,
  );
  run(
    db,
    "INSERT INTO research_report (content_id, topic_id, week, sent_on, status, answer_md, approaches_json, unknowns_md, changes_md) VALUES (10, 5, 1, ?, 'active', '答え', ?, '', '変化なし')",
    DATE,
    APPROACHES,
  );
  run(
    db,
    "INSERT INTO content_state (content_id, opened_at, is_read, read_at, is_saved, saved_at) VALUES (10, ?, 1, ?, 1, ?)",
    AT,
    AT,
    AT,
  );
  run(
    db,
    "INSERT INTO conversation (conversation_id, target_content_id, question_target_json, started_at, last_spoken_at) VALUES (7, 10, ?, ?, ?)",
    JSON.stringify({ kind: "page", contentId: 10 }),
    AT,
    AT,
  );
}

const SNAPSHOT_SQL = {
  content: "SELECT * FROM content ORDER BY content_id",
  content_state: "SELECT * FROM content_state ORDER BY content_id",
  conversation: "SELECT * FROM conversation ORDER BY conversation_id",
  research_topic: "SELECT * FROM research_topic ORDER BY topic_id",
  research_report:
    "SELECT content_id, topic_id, week, sent_on, status, answer_md, approaches_json, unknowns_md, changes_md FROM research_report ORDER BY content_id",
};
function snapshot(db: Database): Record<string, unknown[]> {
  return Object.fromEntries(
    Object.entries(SNAPSHOT_SQL).map(([name, sql]) => [name, rows(db, sql)]),
  );
}

describe("TC154 0001 と 0002 だけの DB に、Web サーバの起動の処理で 0003 を当てる", () => {
  let before: Record<string, unknown[]>;
  let db: Database;

  beforeEach(() => {
    const dataDir = mkdtempSync(join(tmpdir(), "nexus-tc154-"));
    dirs.push(dataDir);
    const pre = openDatabase(databasePath(dataDir));
    applyMigrations(
      pre,
      readMigrations(MIGRATIONS_DIR).filter((m) => m.version <= 2),
      clock,
    );
    expect(appliedVersion(pre)).toBe(2);
    seed(pre);
    before = snapshot(pre);
    pre.close();

    db = openAiJobs({ dataDir, clock, startup: "migrate" }).db;
    dbs.push(db);
  });

  it("0003-research-roadmap.sql の1行目が外部キーの検査を止める印で、schema_migration に 3 が残る", () => {
    const sql = readFileSync(
      join(MIGRATIONS_DIR, "0003-research-roadmap.sql"),
      "utf8",
    );
    expect(sql.split(/\r?\n/)[0]).toBe(MARKER);
    expect(appliedVersion(db)).toBe(3);
    expect(
      rows(db, "SELECT version, name FROM schema_migration WHERE version = 3"),
    ).toEqual([{ version: 3, name: "0003-research-roadmap.sql" }]);
  });

  it("週報の行と参照がそのまま残り、steps_json と step_changes_md は NULL", () => {
    expect(snapshot(db)).toEqual(before);
    expect(
      rows(
        db,
        "SELECT steps_json, step_changes_md FROM research_report WHERE content_id = 10",
      ),
    ).toEqual([{ steps_json: null, step_changes_md: null }]);
  });

  it("PRAGMA foreign_key_check が空で、foreign_keys が ON に戻る", () => {
    expect(rows(db, "PRAGMA foreign_key_check")).toEqual([]);
    expect(rows(db, "PRAGMA foreign_keys")).toEqual([{ foreign_keys: 1 }]);
    expect(rows(db, "PRAGMA integrity_check")).toEqual([
      { integrity_check: "ok" },
    ]);
  });

  it("方法16件の approaches_json と steps_json を入れられ、31件の段は断られる", () => {
    const many = JSON.stringify(
      Array.from({ length: 16 }, (_, i) => ({
        title: `方法${i + 1}`,
        howToMd: "する",
        sourceUrls: [],
        marks: [],
      })),
    );
    const steps = (n: number) =>
      JSON.stringify(
        Array.from({ length: n }, (_, i) => ({
          no: i + 1,
          title: `段${i + 1}`,
          status: "todo",
        })),
      );
    expect(() =>
      run(
        db,
        "UPDATE research_report SET approaches_json = ?, steps_json = ?, step_changes_md = ? WHERE content_id = 10",
        many,
        steps(30),
        "段の案",
      ),
    ).not.toThrow();
    expect(() =>
      run(
        db,
        "UPDATE research_report SET steps_json = ? WHERE content_id = 10",
        steps(31),
      ),
    ).toThrow(/CHECK constraint failed/);
  });

  it("research_report は STRICT で、research_report_week_uq が作り直されている", () => {
    const list = db.prepare("PRAGMA table_list").all();
    for (const name of ["research_report", "research_approach_seen"]) {
      const row = list.find((r) => r.name === name && r.schema === "main");
      expect(row?.strict, name).toBe(1);
    }
    const index = db
      .prepare("PRAGMA index_list(research_report)")
      .all()
      .find((r) => r.name === "research_report_week_uq");
    expect(index?.unique).toBe(1);
  });

  it("research_approach_seen に行を入れられ、同じ（内容ID、番号）と無い週報は断られる", () => {
    const sql =
      "INSERT INTO research_approach_seen (content_id, approach_no, seen_at) VALUES (?, ?, ?)";
    expect(() => run(db, sql, 10, 1, AT)).not.toThrow();
    expect(() => run(db, sql, 10, 2, AT)).not.toThrow();
    expect(() => run(db, sql, 10, 1, AT)).toThrow(/UNIQUE constraint failed/);
    expect(() => run(db, sql, 999, 1, AT)).toThrow(
      /FOREIGN KEY constraint failed/,
    );
    expect(() => run(db, sql, 10, 0, AT)).toThrow(/CHECK constraint failed/);
  });
});
