import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { toDbError } from "./errors";

// DB の接続（DD-01 M21）。`node:sqlite` はこのフォルダの中だけで読み込む（ADR-020、DD-01 3章）。
// 接続はプロセスごとに1つ作る（DD-01 2.1）。

export type Database = DatabaseSync;

// ロックを待つ時間の上限（DD-05 1章）。
export const BUSY_TIMEOUT_MS = 5_000;

// DB のファイルの名前。置き場所は設定の NEXUS_DATA_DIR（DD-09 2.1、2.3）。
export const DATABASE_FILE_NAME = "nexus.db";

export function databasePath(dataDir: string): string {
  return join(dataDir, DATABASE_FILE_NAME);
}

// DB を開き、接続の設定（DD-05 1章）を当てる。
// WAL、外部キーの検査を有効、busy_timeout 5,000 ミリ秒。開けなければ E08（DB_UNAVAILABLE）。
export function openDatabase(path: string): Database {
  try {
    if (path !== ":memory:") {
      // フォルダが無ければ、本人のユーザだけが使える権限で作る（DD-09 2.1）。
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    }
    const db = new DatabaseSync(path, {
      enableForeignKeyConstraints: true,
      timeout: BUSY_TIMEOUT_MS,
    });
    try {
      // 接続のたびに明示的に当てる（部品の既定の値に頼らない）。
      db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
      db.exec("PRAGMA foreign_keys = ON");
      db.exec("PRAGMA journal_mode = WAL");
    } catch (error) {
      db.close();
      throw error;
    }
    return db;
  } catch (error) {
    throw toDbError(error);
  }
}

// `fn` のあいだだけ、ロックを待つ時間を `ms` にし、終わったら 5,000 ミリ秒に戻す。
// 接続はプロセスに1つで、`node:sqlite` は同期で動くので、ほかの処理がこの間に同じ接続を使うことはない。
export function withBusyTimeout<T>(db: Database, ms: number, fn: () => T): T {
  db.exec(`PRAGMA busy_timeout = ${ms}`);
  try {
    return fn();
  } finally {
    db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
  }
}
