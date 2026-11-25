import { NexusError } from "../shared/errors";

// SQLite の失敗を DD-06 の分類に当てる。
// E08（DB が使えない）は SQLITE_BUSY、SQLITE_FULL、SQLITE_IOERR、SQLITE_CORRUPT、SQLITE_CANTOPEN（DD-06 2章）。
// 拡張の結果コード（SQLITE_IOERR_READ など）は下の 8 ビットが基本の結果コードになる。
const DB_UNAVAILABLE_CODES = new Set([
  5, // SQLITE_BUSY（busy_timeout の 5,000 ミリ秒を待っても書けない。DD-05 1章）
  10, // SQLITE_IOERR
  11, // SQLITE_CORRUPT
  13, // SQLITE_FULL
  14, // SQLITE_CANTOPEN
]);

function sqliteErrcode(error: unknown): number | null {
  if (typeof error !== "object" || error === null) return null;
  const { code, errcode } = error as { code?: unknown; errcode?: unknown };
  if (code !== "ERR_SQLITE_ERROR" || typeof errcode !== "number") return null;
  return errcode;
}

// E08 に当たる失敗なら DB_UNAVAILABLE の NexusError に包む。ほかはそのまま返す
// （NexusError は投げた側の分類を保ち、それ以外は呼んだ側が E16 として扱う）。
export function toDbError(error: unknown): unknown {
  if (error instanceof NexusError) return error;
  const errcode = sqliteErrcode(error);
  if (errcode !== null && DB_UNAVAILABLE_CODES.has(errcode & 0xff)) {
    return new NexusError("DB_UNAVAILABLE", "DB が使えない", { cause: error });
  }
  return error;
}
