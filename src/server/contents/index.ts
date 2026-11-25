import type { Database } from "../db/connection";
import { toDbError } from "../db/errors";
import {
  type ContentListRow,
  type ContentStateRow,
  findContentState,
  listInboxRows,
  listSavedRows,
  markContentOpened,
  type SearchCondition,
  searchContentRows,
  setContentRead,
  setContentSaved,
} from "../repositories/content-state";
import type { Clock } from "../shared/clock";
import { formatDateTime } from "../shared/datetime";
import { NexusError } from "../shared/errors";
import { type Page, type PageQuery, toPage } from "../shared/paging";

// 種類を問わない内容の状態と一覧と検索（DD-01 M17。DD-02 FN-004 手順 4、FN-005、FN-006、FN-017、FN-018、FN-019、
// 3章 P03、P04、DD-05 3章）。
// 内容（ENT-001）と内容の状態（ENT-006）だけで動く（BD-02 4章）。
// 書き込みは P04 の1文で行う（DD-05 2章）。SQLite の書き込みの権利を `busy_timeout`（5 秒）待っても
// 取れなければ、DB_UNAVAILABLE（DD-06 E08）として投げる。

// `openapi.yaml` の `ContentState`。
export interface ContentState {
  contentId: number;
  // 開いた日時が空。
  isNew: boolean;
  isRead: boolean;
  isSaved: boolean;
  savedAt: string | null;
}

export interface ContentStateOutcome {
  state: ContentState;
  // 今と同じ値にする求めで、何も変えなかった（DD-06 E06。BD-02 3章 許されない遷移）。
  // `markOpened` は、開いた日時がもう入っていたとき。
  unchanged: boolean;
}

// `openapi.yaml` の `ContentSummary`（一覧の1件）。
export interface ContentSummary {
  contentId: number;
  kind: string;
  title: string;
  targetDate: string;
  receivedAt: string;
  // 開いた日時が空か、内容の状態が無い（DD-02 FN-017 手順 2）。
  isNew: boolean;
  isRead: boolean;
  isSaved: boolean;
  savedAt: string | null;
}

export interface Contents {
  // 開いた日時を、空のときだけ今にする（P04 手順 2）。内容が無ければ NOT_FOUND を投げる。
  markOpened(contentId: number): ContentStateOutcome;
  // 既読にするか未読に戻す（FN-005）。内容が無ければ NOT_FOUND を投げる。
  setRead(contentId: number, isRead: boolean): ContentStateOutcome;
  // 保存するか保存を外す（FN-006）。内容が無ければ NOT_FOUND を投げる。
  setSaved(contentId: number, isSaved: boolean): ContentStateOutcome;
  // 新着と未読の一覧（FN-017）。届いた日時の新しい順に 3章 P03 で返す。
  listInbox(query: PageQuery): Page<ContentSummary>;
  // 保存した内容の一覧（FN-019）。保存した日時の新しい順に 3章 P03 で返す。
  listSaved(query: PageQuery): Page<ContentSummary>;
  // 検索（FN-018）。言葉を全て含む内容を、届いた日時の新しい順に 3章 P03 で返す。
  // 空白でない言葉が1つも無ければ INPUT_INVALID を投げる（DD-02 2章 C06）。
  searchContents(q: string, query: PageQuery): Page<ContentSummary>;
}

// 3文字以上の言葉は FTS5 の一致で、2文字以下は部分の一致で探す（DD-03 3章。trigram は
// 3文字より短い言葉を索引で探せないため）。文字は Unicode の符号位置で数える。
const MATCH_MIN_LENGTH = 3;

// 検索の言葉を条件にする（DD-02 FN-018 手順 2〜3）。`q` を `search_index` の `body` と同じく
// NFKC で正規化して小文字にし、空白で区切る。空の言葉は捨てる。言葉が無ければ null。
export function toSearchCondition(q: string): SearchCondition | null {
  const words = q
    .normalize("NFKC")
    .toLowerCase()
    .split(/\s+/u)
    .filter((word) => word !== "");
  if (words.length === 0) return null;

  const phrases: string[] = [];
  const likes: string[] = [];
  for (const word of words) {
    if ([...word].length >= MATCH_MIN_LENGTH) {
      // 二重引用符で囲み、中の二重引用符は2つに重ねる。並べた句は全て含むもの（AND）になる。
      phrases.push(`"${word.replaceAll('"', '""')}"`);
    } else {
      likes.push(`%${word.replace(/[\\%_]/gu, (c) => `\\${c}`)}%`);
    }
  }
  return {
    match: phrases.length === 0 ? null : phrases.join(" "),
    likes,
  };
}

function toContentSummary(row: ContentListRow): ContentSummary {
  return {
    contentId: row.contentId,
    kind: row.kind,
    title: row.title,
    targetDate: row.targetDate,
    receivedAt: row.receivedAt,
    isNew: row.openedAt === null,
    isRead: row.isRead,
    isSaved: row.isSaved,
    savedAt: row.savedAt,
  };
}

function toContentState(row: ContentStateRow): ContentState {
  return {
    contentId: row.contentId,
    isNew: row.openedAt === null,
    isRead: row.isRead,
    isSaved: row.isSaved,
    savedAt: row.savedAt,
  };
}

export function createContents(deps: { db: Database; clock: Clock }): Contents {
  const { db, clock } = deps;

  // P04 の1文を動かし、変えなかったときは今の行を読む。
  function change(
    contentId: number,
    write: (at: string) => ContentStateRow | null,
  ): ContentStateOutcome {
    try {
      const changed = write(formatDateTime(clock.now()));
      if (changed !== null) {
        return { state: toContentState(changed), unchanged: false };
      }
      const current = findContentState(db, contentId);
      if (current === null) {
        throw new NexusError("NOT_FOUND", "内容が無い");
      }
      return { state: toContentState(current), unchanged: true };
    } catch (error) {
      throw toDbError(error);
    }
  }

  return {
    markOpened(contentId) {
      return change(contentId, (at) => markContentOpened(db, contentId, at));
    },
    setRead(contentId, isRead) {
      return change(contentId, (at) =>
        setContentRead(db, contentId, isRead, at),
      );
    },
    setSaved(contentId, isSaved) {
      return change(contentId, (at) =>
        setContentSaved(db, contentId, isSaved, at),
      );
    },
    listInbox({ after, limit }) {
      try {
        // P03 手順 2〜3: `limit + 1` 件を読み、続きがあるかを決める。
        const rows = listInboxRows(db, after, limit + 1);
        return toPage(
          rows,
          limit,
          (row) => ({ value: row.receivedAt, id: row.contentId }),
          toContentSummary,
        );
      } catch (error) {
        throw toDbError(error);
      }
    },
    listSaved({ after, limit }) {
      try {
        const rows = listSavedRows(db, after, limit + 1);
        return toPage(
          rows,
          limit,
          // 保存した内容の行は `saved_at` が必ずある（DD-03 の CHECK）。
          (row) => ({ value: row.savedAt ?? "", id: row.contentId }),
          toContentSummary,
        );
      } catch (error) {
        throw toDbError(error);
      }
    },
    searchContents(q, { after, limit }) {
      const condition = toSearchCondition(q);
      if (condition === null) {
        throw new NexusError("INPUT_INVALID", "検索の言葉が無い");
      }
      try {
        const rows = searchContentRows(db, condition, after, limit + 1);
        return toPage(
          rows,
          limit,
          (row) => ({ value: row.receivedAt, id: row.contentId }),
          toContentSummary,
        );
      } catch (error) {
        throw toDbError(error);
      }
    },
  };
}
