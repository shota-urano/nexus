import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Database, openDatabase } from "../src/server/db/connection";
import {
  MIGRATIONS_DIR,
  appliedVersion,
  applyMigrations,
  readMigrations,
} from "../src/server/db/migrations";
import { createFakeClock } from "../src/server/shared/clock";

// 02-data-model の実装単位1: マイグレーション 0001（DD-03 2.2、3章）。

const TABLES = [
  "content",
  "article",
  "english_set",
  "article_relation",
  "english_answer",
  "content_state",
  "conversation",
  "message",
  "ai_run",
  "delivery",
  "device",
  "registration_code",
  "sender_key",
  "search_index",
  "schema_migration",
  "job_lock",
];

const INDEXES = [
  "content_english_date_uq",
  "content_kind_date_ix",
  "content_received_ix",
  "content_delivery_ix",
  "article_slug_ix",
  "article_relation_pair_uq",
  "article_relation_to_ix",
  "content_state_saved_ix",
  "content_state_unread_ix",
  "conversation_target_ix",
  "conversation_last_ix",
  "message_conversation_ix",
  "message_reply_to_uq",
  "ai_run_queue_ix",
  "ai_run_reply_ix",
  "ai_run_summary_ix",
  "ai_run_delivery_ix",
  "ai_run_finished_ix",
  "ai_run_created_ix",
  "delivery_date_ix",
  "delivery_received_ix",
  "registration_code_expires_ix",
];

// FTS5 が自分で作る影のテーブル。
const FTS5_SHADOW = /^search_index_(data|idx|content|docsize|config)$/;

const AT = "2026-11-25T10:00:00.000+09:00";
const DATE = "2026-11-25";

let db: Database;
beforeEach(() => {
  db = openDatabase(":memory:");
  applyMigrations(
    db,
    readMigrations(MIGRATIONS_DIR),
    createFakeClock(new Date(AT)),
  );
});
afterEach(() => {
  if (db.isOpen) db.close();
});

function names(type: "table" | "index"): string[] {
  return db
    .prepare("SELECT name FROM sqlite_schema WHERE type = ? ORDER BY name")
    .all(type)
    .map((row) => String(row.name));
}

function run(sql: string, ...params: (string | number | null)[]): void {
  db.prepare(sql).run(...params);
}

// 外部キーの先を用意する。
function seedConversation(): void {
  run(
    "INSERT INTO conversation (conversation_id, started_at, last_spoken_at) VALUES (1, ?, ?)",
    AT,
    AT,
  );
  run(
    "INSERT INTO message (message_id, conversation_id, speaker, body_md, sent_at) VALUES (1, 1, 'owner', '質問', ?)",
    AT,
  );
}

describe("空の DB に 0001 を当てる", () => {
  it("当たり、schema_migration に 1 が残る", () => {
    expect(appliedVersion(db)).toBe(1);
    expect(
      db.prepare("SELECT version, name FROM schema_migration").all(),
    ).toEqual([{ version: 1, name: "0001-initial-schema.sql" }]);
  });

  it("DD-03 2.1 の16のテーブルができ、ほかは SQLite と FTS5 が作るものだけ", () => {
    const tables = names("table");
    expect(tables).toEqual(expect.arrayContaining(TABLES));
    expect(TABLES).toHaveLength(16);
    const others = tables.filter((name) => !TABLES.includes(name));
    for (const name of others) {
      expect(name === "sqlite_sequence" || FTS5_SHADOW.test(name)).toBe(true);
    }
  });

  it("search_index は FTS5 の trigram で、大文字と小文字を区別しない", () => {
    const sql = db
      .prepare("SELECT sql FROM sqlite_schema WHERE name = 'search_index'")
      .get()?.sql;
    expect(String(sql)).toMatch(/USING fts5/i);
    expect(String(sql)).toMatch(/trigram case_sensitive 0/);
    run(
      "INSERT INTO search_index (content_id, body) VALUES (1, ?)",
      "nexus 半導体の規制",
    );
    const hit = db
      .prepare("SELECT content_id FROM search_index WHERE search_index MATCH ?")
      .all('"NEXUS"');
    expect(hit).toEqual([{ content_id: 1 }]);
  });

  it("search_index のほかのテーブルは全て STRICT", () => {
    const list = db.prepare("PRAGMA table_list").all();
    for (const name of TABLES.filter((t) => t !== "search_index")) {
      const row = list.find((r) => r.name === name && r.schema === "main");
      expect(row?.strict, name).toBe(1);
    }
  });

  it("3章の22の索引ができる（主キーと FTS5 の索引を除く）", () => {
    const indexes = names("index").filter(
      (name) => !name.startsWith("sqlite_autoindex_"),
    );
    expect(INDEXES).toHaveLength(22);
    expect(indexes).toEqual([...INDEXES].sort());
  });

  it("外部キーの削除と更新は全て拒否", () => {
    for (const table of TABLES.filter((t) => t !== "search_index")) {
      for (const fk of db.prepare(`PRAGMA foreign_key_list(${table})`).all()) {
        expect(fk.on_delete, `${table}.${fk.from}`).toBe("RESTRICT");
        expect(fk.on_update, `${table}.${fk.from}`).toBe("RESTRICT");
      }
    }
  });

  it("foreign_key_check が行を返さず、integrity_check が ok", () => {
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(db.prepare("PRAGMA integrity_check").all()).toEqual([
      { integrity_check: "ok" },
    ]);
  });
});

describe("制約で挿入を拒む", () => {
  it("content.kind が空の文字なら拒む（空でなければ入る）", () => {
    const sql =
      "INSERT INTO content (kind, title, target_date, received_at) VALUES (?, '見出し', ?, ?)";
    expect(() => run(sql, "", DATE, AT)).toThrow(/CHECK constraint failed/);
    expect(() => run(sql, "news", DATE, AT)).not.toThrow();
  });

  it("ai_run の目的が answer で reply_message_id が空なら拒む", () => {
    seedConversation();
    const sql =
      "INSERT INTO ai_run (purpose, reply_message_id, created_at) VALUES ('answer', ?, ?)";
    expect(() => run(sql, null, AT)).toThrow(/CHECK constraint failed/);
    expect(() => run(sql, 1, AT)).not.toThrow();
  });

  it("message の話し手が owner で reply_state があれば拒む", () => {
    seedConversation();
    const sql =
      "INSERT INTO message (conversation_id, speaker, body_md, sent_at, reply_state) VALUES (1, 'owner', '質問', ?, ?)";
    expect(() => run(sql, AT, "done")).toThrow(/CHECK constraint failed/);
    expect(() => run(sql, AT, null)).not.toThrow();
  });

  it("挿入のあとも foreign_key_check が行を返さない", () => {
    seedConversation();
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });
});
