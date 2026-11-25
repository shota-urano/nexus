import type { Database } from "../db/connection";
import { inReadTransaction } from "../db/transaction";
import {
  countNewAndUnread,
  countWritingReplies,
  findLatestEnglishForHome,
  hasRecentUnrecoveredFailure,
  listAcceptedSendersOn,
  listHomePicks,
} from "../repositories/home";
import type { Clock } from "../shared/clock";
import { formatDate, formatDateTime } from "../shared/datetime";

// ホームの表示のデータ（DD-01 M19。DD-02 FN-020）。読むだけで、データを変えない。
// 2つ以上の文で同じ時点の値を読むので、読むためのトランザクション（`BEGIN`）で読む（DD-05 1章）。
// 未着（BD-11 M01）と AI の失敗（BD-11 M02）もここで数える。

// ピックアップの件数（Q-037 の答え。`openapi.yaml` の `Home.picks` の `maxItems`）。
export const HOME_PICKS_LIMIT = 3;
// 未着を出し始める日本時間の時（NFR-022。BD-11 M01）。
export const MISSING_DELIVERY_FROM_HOUR = 7;
// 失敗を数える期間（Q-078 の答え。BD-11 M02）。
export const FAILURE_WINDOW_MS = 24 * 60 * 60 * 1000;

export type HomeNotice = "MSG-015" | "MSG-016" | "MSG-017";

// `openapi.yaml` の `Home`。
export interface Home {
  newCount: number;
  unreadCount: number;
  learning: {
    contentId: number;
    learningTheme: string;
    isCompleted: boolean;
  } | null;
  ai: {
    writingCount: number;
    hasFailure: boolean;
  };
  picks: {
    contentId: number;
    title: string;
    theme: string;
    imageUrl: string | null;
  }[];
  notices: HomeNotice[];
}

export interface HomeView {
  // ホームに出す値（FN-020 手順 2〜7）。
  getHome(): Home;
}

// 日本時間の時（0〜23）。
function jstHour(at: Date): number {
  return Number(formatDateTime(at).slice(11, 13));
}

export function createHomeView(deps: { db: Database; clock: Clock }): HomeView {
  const { db, clock } = deps;

  return {
    getHome() {
      const now = clock.now();
      const today = formatDate(now);
      const failureSince = formatDateTime(
        new Date(now.getTime() - FAILURE_WINDOW_MS),
      );

      return inReadTransaction(db, () => {
        const counts = countNewAndUnread(db);
        const learning = findLatestEnglishForHome(db);
        const writingCount = countWritingReplies(db);
        const hasFailure = hasRecentUnrecoveredFailure(db, failureSince);
        const picks = listHomePicks(db, today, HOME_PICKS_LIMIT);

        const notices: HomeNotice[] = [];
        if (jstHour(now) >= MISSING_DELIVERY_FROM_HOUR) {
          const accepted = listAcceptedSendersOn(db, today);
          if (!accepted.has("brain-harness")) notices.push("MSG-015");
          if (!accepted.has("sharpen")) notices.push("MSG-016");
        }
        if (hasFailure) notices.push("MSG-017");

        return {
          newCount: counts.newCount,
          unreadCount: counts.unreadCount,
          learning,
          ai: { writingCount, hasFailure },
          picks,
          notices,
        };
      });
    },
  };
}
