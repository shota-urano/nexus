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

// 一覧の1行（`content` に `content_state` を外部結合した行）。
export interface ContentListRow {
  contentId: number;
  kind: string;
  title: string;
  targetDate: string;
  receivedAt: string;
  openedAt: string | null;
  isRead: boolean;
  isSaved: boolean;
  savedAt: string | null;
}

const LIST_COLUMNS = `c.content_id AS content_id,
              c.kind AS kind,
              c.title AS title,
              c.target_date AS target_date,
              c.received_at AS received_at,
              s.opened_at AS opened_at,
              COALESCE(s.is_read, 0) AS is_read,
              COALESCE(s.is_saved, 0) AS is_saved,
              s.saved_at AS saved_at`;

function toListRow(row: Record<string, unknown>): ContentListRow {
  return {
    contentId: Number(row.content_id),
    kind: row.kind as string,
    title: row.title as string,
    targetDate: row.target_date as string,
    receivedAt: row.received_at as string,
    openedAt: (row.opened_at as string | null) ?? null,
    isRead: Number(row.is_read) === 1,
    isSaved: Number(row.is_saved) === 1,
    savedAt: (row.saved_at as string | null) ?? null,
  };
}

// 前のページの最後の行（並べる値と ID）。
export interface ListAfter {
  value: string;
  id: number;
}

// 新着と未読の一覧（DD-02 FN-017 手順 2）。`content_state` が無いか、`opened_at` が空か、
// `is_read` が 0 の行を、届いた日時と ID の大きい順に `count` 件まで読む（3章 P03 手順 2）。
export function listInboxRows(
  db: Database,
  after: ListAfter | null,
  count: number,
): ContentListRow[] {
  const afterCondition =
    after === null
      ? ""
      : "AND (c.received_at < ? OR (c.received_at = ? AND c.content_id < ?))";
  const params =
    after === null ? [count] : [after.value, after.value, after.id, count];
  return db
    .prepare(
      `SELECT ${LIST_COLUMNS}
         FROM content AS c
         LEFT JOIN content_state AS s ON s.content_id = c.content_id
        WHERE (s.content_id IS NULL OR s.opened_at IS NULL OR s.is_read = 0)
          ${afterCondition}
        ORDER BY c.received_at DESC, c.content_id DESC
        LIMIT ?`,
    )
    .all(...params)
    .map(toListRow);
}

// 保存した内容の一覧（BD-02 FN-019）。`is_saved` が 1 の行を、保存した日時と ID の大きい順に
// `count` 件まで読む（3章 P03 手順 2）。
export function listSavedRows(
  db: Database,
  after: ListAfter | null,
  count: number,
): ContentListRow[] {
  const afterCondition =
    after === null
      ? ""
      : "AND (s.saved_at < ? OR (s.saved_at = ? AND s.content_id < ?))";
  const params =
    after === null ? [count] : [after.value, after.value, after.id, count];
  return db
    .prepare(
      `SELECT ${LIST_COLUMNS}
         FROM content_state AS s
         JOIN content AS c ON c.content_id = s.content_id
        WHERE s.is_saved = 1
          ${afterCondition}
        ORDER BY s.saved_at DESC, s.content_id DESC
        LIMIT ?`,
    )
    .all(...params)
    .map(toListRow);
}
