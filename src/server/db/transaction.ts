import type { Database } from "./connection";
import { toDbError } from "./errors";

// トランザクションの関数（DD-05 1章）。トランザクションの境界は業務層がこの関数で決める（DD-01 4章）。
// 関数が投げたら戻し、投げたものを返す（E08 に当たる SQLite の失敗は DB_UNAVAILABLE に包む）。
// 関数の中で AI の CLI、SSE の送信、ファイルの書き出しを待たない（DD-05 1章）ため、関数は同期にする。

// 書き込むトランザクション。`BEGIN IMMEDIATE` で始め、始めた時点で書き込みの権利を取る。
export function inWriteTransaction<T>(db: Database, fn: () => T): T {
  return run(db, "BEGIN IMMEDIATE", fn);
}

// 2つ以上の文で同じ時点の値を読むトランザクション。`BEGIN`（DEFERRED）で始める。
export function inReadTransaction<T>(db: Database, fn: () => T): T {
  return run(db, "BEGIN", fn);
}

function run<T>(db: Database, begin: string, fn: () => T): T {
  if (db.isTransaction) {
    // 入れ子にしない。外の処理の境界が崩れるため。
    throw new Error("トランザクションの中で、もう一つ始めようとした");
  }
  try {
    db.exec(begin);
  } catch (error) {
    throw toDbError(error);
  }
  let result: T;
  try {
    result = fn();
    if (isPromiseLike(result)) {
      throw new Error("トランザクションの関数は同期で書く（DD-05 1章）");
    }
    db.exec("COMMIT");
  } catch (error) {
    rollback(db);
    throw toDbError(error);
  }
  return result;
}

function rollback(db: Database): void {
  // SQLite が自分で戻した場合（SQLITE_FULL など）は、もうトランザクションの外にいる。
  if (db.isTransaction) db.exec("ROLLBACK");
}

function isPromiseLike(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { then?: unknown }).then === "function"
  );
}
