// 一覧の続き（DD-02 3章 P03、DD-04 3.3）。
// 続きを表すトークン（`cursor`）は、並べる値と ID の組 `[並べる値, ID]` を JSON にし、base64url にした文字。
// 画面は中身を読まない。1ページの件数は既定 30、上限 50（`limit`）。

export const DEFAULT_PAGE_LIMIT = 30;
export const MAX_PAGE_LIMIT = 50;

// 前のページの最後の行の、並べる値と ID。
export interface PageCursor {
  value: string;
  id: number;
}

export interface PageQuery {
  // 省くと最初のページ。
  after: PageCursor | null;
  limit: number;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

export function encodeCursor(cursor: PageCursor): string {
  return Buffer.from(
    JSON.stringify([cursor.value, cursor.id]),
    "utf8",
  ).toString("base64url");
}

// トークンを `[並べる値, ID]` に戻す。戻せなければ null（P03 手順 1。呼んだ側が 400 にする）。
export function decodeCursor(text: string): PageCursor | null {
  if (!BASE64URL_PATTERN.test(text)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(text, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length !== 2) return null;
  const [value, id] = parsed as unknown[];
  if (typeof value !== "string") return null;
  if (typeof id !== "number" || !Number.isSafeInteger(id) || id < 1) {
    return null;
  }
  return { value, id };
}

// `limit + 1` 件まで読んだ行から、1ページと `nextCursor` を作る（P03 手順 3）。
// `limit + 1` 件目があれば、`limit` 件目の並べる値と ID からトークンを作り、無ければ null にする。
export function toPage<R, T>(
  rows: R[],
  limit: number,
  cursorOf: (row: R) => PageCursor,
  toItem: (row: R) => T,
): Page<T> {
  const pageRows = rows.slice(0, limit);
  const last = pageRows[pageRows.length - 1];
  const nextCursor =
    rows.length > limit && last !== undefined
      ? encodeCursor(cursorOf(last))
      : null;
  return { items: pageRows.map(toItem), nextCursor };
}
