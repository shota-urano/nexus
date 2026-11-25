import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync, backup } from "node:sqlite";
import { NexusError } from "../shared/errors";

// 起動のときの確かめ（DD-09 2.1）。この Node.js の SQLite で、FTS5 の trigram と `backup` が使えるか。
// 使えなければ DD-06 E17（STARTUP_MISMATCH）で止める。本番の DB には触れず、使い捨ての DB で確かめる。

export async function checkSqliteFeatures(): Promise<void> {
  const db = new DatabaseSync(":memory:");
  const dir = mkdtempSync(join(tmpdir(), "nexus-sqlite-check-"));
  try {
    checkTrigram(db);
    await checkBackup(db, join(dir, "copy.db"));
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

// DD-03 2.2 `search_index` と同じ分け方（trigram、大文字と小文字を区別しない）で表を作り、引けるか。
function checkTrigram(db: DatabaseSync): void {
  try {
    db.exec(
      "CREATE VIRTUAL TABLE feature_check USING fts5(body, tokenize = 'trigram case_sensitive 0')",
    );
    db.prepare("INSERT INTO feature_check (body) VALUES (?)").run(
      "NEXUS Search",
    );
    const hit = db
      .prepare("SELECT body FROM feature_check WHERE feature_check MATCH ?")
      .get('"xus sea"');
    if (hit === undefined) throw new Error("trigram の検索で行が返らない");
  } catch (error) {
    throw new NexusError(
      "STARTUP_MISMATCH",
      "SQLite の FTS5 の trigram が使えない",
      { cause: error },
    );
  }
}

// 動かしたままの写し（BD-02 5.3、ADR-020）を作れ、写しから元の行を読めるか。
async function checkBackup(db: DatabaseSync, path: string): Promise<void> {
  try {
    await backup(db, path);
    const copy = new DatabaseSync(path, { readOnly: true });
    try {
      const row = copy.prepare("SELECT body FROM feature_check").get();
      if (row?.body !== "NEXUS Search") {
        throw new Error("写しに元の行が無い");
      }
    } finally {
      copy.close();
    }
  } catch (error) {
    throw new NexusError("STARTUP_MISMATCH", "SQLite の backup が使えない", {
      cause: error,
    });
  }
}
