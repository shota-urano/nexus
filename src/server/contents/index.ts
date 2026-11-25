import type { Database } from "../db/connection";
import { toDbError } from "../db/errors";
import {
  type ContentStateRow,
  findContentState,
  markContentOpened,
  setContentRead,
  setContentSaved,
} from "../repositories/content-state";
import type { Clock } from "../shared/clock";
import { formatDateTime } from "../shared/datetime";
import { NexusError } from "../shared/errors";

// 種類を問わない内容の状態（DD-01 M17。DD-02 FN-004 手順 4、FN-005、FN-006、3章 P04、DD-05 3章）。
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

export interface Contents {
  // 開いた日時を、空のときだけ今にする（P04 手順 2）。内容が無ければ NOT_FOUND を投げる。
  markOpened(contentId: number): ContentStateOutcome;
  // 既読にするか未読に戻す（FN-005）。内容が無ければ NOT_FOUND を投げる。
  setRead(contentId: number, isRead: boolean): ContentStateOutcome;
  // 保存するか保存を外す（FN-006）。内容が無ければ NOT_FOUND を投げる。
  setSaved(contentId: number, isSaved: boolean): ContentStateOutcome;
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
  };
}
