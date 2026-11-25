import type { Database } from "../db/connection";

// ENT-006 内容の状態（DD-03 `content_state`）の読み書き（DD-01 M22。DD-02 3章 P04、DD-05 3章）。
// 行が無い内容は、未読で、保存していなくて、開いた日時が空として扱う（DD-02 2章 状態の実装）。
// 書き込みは、行を作ると変えるを1つの文（`INSERT … SELECT … ON CONFLICT … DO UPDATE`）で行う。
// `content` に無い内容ID は SELECT が行を返さないので、行を作らない。

export interface ContentStateRow {
  contentId: number;
  openedAt: string | null;
  isRead: boolean;
  readAt: string | null;
  isSaved: boolean;
  savedAt: string | null;
}

const COLUMNS =
  "content_id, opened_at, is_read, read_at, is_saved, saved_at" as const;

function toRow(row: Record<string, unknown>): ContentStateRow {
  return {
    contentId: Number(row.content_id),
    openedAt: (row.opened_at as string | null) ?? null,
    isRead: Number(row.is_read) === 1,
    readAt: (row.read_at as string | null) ?? null,
    isSaved: Number(row.is_saved) === 1,
    savedAt: (row.saved_at as string | null) ?? null,
  };
}

// 内容の状態を読む。内容が無ければ null。内容はあって状態の行が無ければ、初めの値を返す。
export function findContentState(
  db: Database,
  contentId: number,
): ContentStateRow | null {
  const row = db
    .prepare(
      `SELECT c.content_id AS content_id,
              s.opened_at AS opened_at,
              COALESCE(s.is_read, 0) AS is_read,
              s.read_at AS read_at,
              COALESCE(s.is_saved, 0) AS is_saved,
              s.saved_at AS saved_at
         FROM content AS c
         LEFT JOIN content_state AS s ON s.content_id = c.content_id
        WHERE c.content_id = ?`,
    )
    .get(contentId);
  return row === undefined ? null : toRow(row);
}

// 開いた日時を、空のときだけ `at` にする（`opened_at IS NULL` を条件にした更新）。
// 変えた行があれば変えた後の行を、無ければ（内容が無いか、もう入っていた）null を返す。
export function markContentOpened(
  db: Database,
  contentId: number,
  at: string,
): ContentStateRow | null {
  const row = db
    .prepare(
      `INSERT INTO content_state (content_id, opened_at)
       SELECT content_id, ? FROM content WHERE content_id = ?
       ON CONFLICT (content_id) DO UPDATE SET opened_at = excluded.opened_at
        WHERE content_state.opened_at IS NULL
       RETURNING ${COLUMNS}`,
    )
    .get(at, contentId);
  return row === undefined ? null : toRow(row);
}

// 既読の値を変える。今と同じ値なら変えない。既読にするときは `read_at` を `at` に、
// 未読に戻すときは空にする。変えた行があれば変えた後の行を、無ければ null を返す。
export function setContentRead(
  db: Database,
  contentId: number,
  isRead: boolean,
  at: string,
): ContentStateRow | null {
  const value = isRead ? 1 : 0;
  const row = db
    .prepare(
      `INSERT INTO content_state (content_id, is_read, read_at)
       SELECT content_id, ?, ? FROM content WHERE content_id = ?
       ON CONFLICT (content_id) DO UPDATE
          SET is_read = excluded.is_read, read_at = excluded.read_at
        WHERE content_state.is_read <> excluded.is_read
       RETURNING ${COLUMNS}`,
    )
    .get(value, isRead ? at : null, contentId);
  return row === undefined ? null : toRow(row);
}

// 保存の値を変える。今と同じ値なら変えない。保存するときは `saved_at` を `at` に、
// 保存を外すときは空にする。変えた行があれば変えた後の行を、無ければ null を返す。
export function setContentSaved(
  db: Database,
  contentId: number,
  isSaved: boolean,
  at: string,
): ContentStateRow | null {
  const value = isSaved ? 1 : 0;
  const row = db
    .prepare(
      `INSERT INTO content_state (content_id, is_saved, saved_at)
       SELECT content_id, ?, ? FROM content WHERE content_id = ?
       ON CONFLICT (content_id) DO UPDATE
          SET is_saved = excluded.is_saved, saved_at = excluded.saved_at
        WHERE content_state.is_saved <> excluded.is_saved
       RETURNING ${COLUMNS}`,
    )
    .get(value, isSaved ? at : null, contentId);
  return row === undefined ? null : toRow(row);
}
