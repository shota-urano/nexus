import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Clock } from "../shared/clock";
import { formatDateTime } from "../shared/datetime";
import { NexusError } from "../shared/errors";
import type { Database } from "./connection";
import { inWriteTransaction } from "./transaction";

// マイグレーションを番号の順に当てる仕組み（DD-03 5章）。外の道具は使わない。
// ファイルは `src/server/db/migrations/` に `NNNN-<kebab-case の名前>.sql`（0001 から）で置く。
// 1つのファイルを1つのトランザクションで当て、当てたら `schema_migration` に番号を書く。
// `schema_migration` のテーブルは 0001 のファイルが作る（02-data-model）。

// リポジトリの根からのマイグレーションの置き場所（DD-03 5章）。
export const MIGRATIONS_DIR = "src/server/db/migrations";

const FILE_PATTERN = /^(\d{4})-[a-z0-9]+(?:-[a-z0-9]+)*\.sql$/;

export interface Migration {
  version: number;
  // ファイルの名前（`schema_migration.name` に書く）。
  name: string;
  sql: string;
}

// 置き場所の `.sql` のファイルを番号の順に読む。
// 名前の形が違う、番号が 0001 から抜けなく続いていない、のどれかなら投げる（当てる前に止めるため）。
export function readMigrations(dir: string): Migration[] {
  const names = readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  return names.map((name, index) => {
    const match = FILE_PATTERN.exec(name);
    if (!match) {
      throw new Error(`マイグレーションのファイルの名前の形が違う: ${name}`);
    }
    const version = Number(match[1]);
    if (version !== index + 1) {
      throw new Error(
        `マイグレーションの番号が 0001 から続いていない: ${name}（${index + 1} のはず）`,
      );
    }
    return { version, name, sql: readFileSync(join(dir, name), "utf8") };
  });
}

// 当てた最後の番号。`schema_migration` がまだ無ければ 0。
export function appliedVersion(db: Database): number {
  const table = db
    .prepare(
      "SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'schema_migration'",
    )
    .get();
  if (table === undefined) return 0;
  const row = db
    .prepare("SELECT MAX(version) AS version FROM schema_migration")
    .get();
  return typeof row?.version === "number" ? row.version : 0;
}

// まだ当てていないマイグレーションを番号の順に当てる。当てた番号の一覧を返す。
// 途中のファイルが失敗したら、そのファイルの変更は戻り、投げる（前のファイルは当たったまま残る）。
export function applyMigrations(
  db: Database,
  migrations: readonly Migration[],
  clock: Clock,
): number[] {
  const current = appliedVersion(db);
  const applied: number[] = [];
  for (const migration of migrations) {
    if (migration.version <= current) continue;
    inWriteTransaction(db, () => {
      db.exec(migration.sql);
      db.prepare(
        "INSERT INTO schema_migration (version, name, applied_at) VALUES (?, ?, ?)",
      ).run(migration.version, migration.name, formatDateTime(clock.now()));
    });
    applied.push(migration.version);
  }
  return applied;
}

// このプロセスが知るマイグレーションの置き場所（リポジトリの根に依らない道）。
// `new URL("./migrations/", import.meta.url)` と書くと、Next.js（Turbopack）が束ねるときに
// フォルダを1つのファイルとして読み込もうとして失敗するので、このファイルの道から組み立てる。
const KNOWN_MIGRATIONS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "migrations",
);

// Web サーバのほかのプロセス（AI Runner、定期ジョブ、管理のコマンド）が起動したときの確かめ（DD-03 5章）。
// `schema_migration` の最後の番号が、このプロセスの知る番号と違えば E17（STARTUP_MISMATCH）を投げる。
export function assertMigrationsApplied(db: Database): void {
  const known = readMigrations(KNOWN_MIGRATIONS_DIR).length;
  const applied = appliedVersion(db);
  if (applied !== known) {
    throw new NexusError(
      "STARTUP_MISMATCH",
      `DB の schema_migration の番号が ${applied} で、${known} でない`,
    );
  }
}
