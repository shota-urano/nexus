"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ContentPageResult } from "../../client/contents";
import type { ContentSummary } from "../../contracts/contents";
import { ContentListRow } from "../../ui/content-list-row";
import { EmptyState } from "../../ui/empty-state";
import { kindDisplayOf } from "./kinds";
import { LIST_MESSAGES } from "./messages";

// 一覧の画面（SCR-007〜SCR-009）が共通に使う一覧（DD-01 M05、BD-09 5章 一覧の決まり）。
// - 画面を開いたら初めのページを読む。読み込み中は一覧の場所に待つ印を出す。
// - 0件なら `emptyMessage`、読めなければ MSG-019 を空の状態で出す（BD-03 3.5）。
// - 401（MSG-020）のときは何も出さない。全面の知らせは M01 の枠が出す。
// - 下までスクロールすると続きを読み、一覧に足す。読み込み中はもう一度読まない。
//   続きを読めなければ一覧の下に MSG-019 を出す（BD-03 SCR-007-A03）。
// - 日付は日本時間の日付だけを出し、時刻は出さない（BD-09 5章 表示書式。CR-004）。

export type LoadPage = (
  cursor: string | null,
  signal: AbortSignal,
) => Promise<ContentPageResult>;

type Phase = "loading" | "ready" | "failed" | "unauthorized";

// 日本時間の日時（`YYYY-MM-DDTHH:MM:SS.sss+09:00`）から日付 `YYYY-MM-DD` を取る。
export function dateOfDateTime(dateTime: string): string {
  return dateTime.slice(0, 10);
}

// 今の日本時間の年。日付の書式（今年かどうか）を決める。
function thisYearInJapan(now: Date): number {
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return jst.getUTCFullYear();
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export function ContentList({
  load,
  emptyMessage,
  dateOf,
  showNewAndUnread = false,
}: {
  load: LoadPage;
  /** 0件のときに出す文 */
  emptyMessage: string;
  /** 行に出す日時（届いた日時か保存した日時）を選ぶ */
  dateOf: (item: ContentSummary) => string;
  /** 新着のタグと未読の印を出すか（Inbox。BD-03 SCR-007-O04） */
  showNewAndUnread?: boolean;
}) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [items, setItems] = useState<ContentSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [moreFailed, setMoreFailed] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadingMoreRef = useRef(false);
  const controllerRef = useRef<AbortController | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // 初めのページ。画面を離れたら読み込みを止める。探し直すとき（Explore）は、画面が
  // `key` を変えてこの部品を作り直すので、前の検索の読み込みはここで止まる。
  useEffect(() => {
    const controller = new AbortController();
    controllerRef.current = controller;
    load(null, controller.signal).then(
      (result) => {
        if (controller.signal.aborted) return;
        if (result.status === "ok") {
          setItems(result.page.items);
          setNextCursor(result.page.nextCursor);
          setPhase("ready");
        } else {
          setPhase(result.status);
        }
      },
      (error: unknown) => {
        if (controller.signal.aborted || isAbortError(error)) return;
        setPhase("failed");
      },
    );
    return () => controller.abort();
  }, [load]);

  const loadMore = useCallback(() => {
    const controller = controllerRef.current;
    if (
      phase !== "ready" ||
      nextCursor === null ||
      controller === null ||
      loadingMoreRef.current
    ) {
      return;
    }
    loadingMoreRef.current = true;
    setLoadingMore(true);
    setMoreFailed(false);
    const finish = () => {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    };
    load(nextCursor, controller.signal).then(
      (result) => {
        if (controller.signal.aborted) return;
        finish();
        if (result.status === "ok") {
          setItems((previous) => [...previous, ...result.page.items]);
          setNextCursor(result.page.nextCursor);
        } else if (result.status === "unauthorized") {
          setPhase("unauthorized");
        } else {
          setMoreFailed(true);
        }
      },
      (error: unknown) => {
        if (controller.signal.aborted || isAbortError(error)) return;
        finish();
        setMoreFailed(true);
      },
    );
  }, [load, nextCursor, phase]);

  // 一覧の下の印が見えたら続きを読む。続きを読めなかったときは、もう一度見えたら読み直す。
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (
      sentinel === null ||
      nextCursor === null ||
      typeof IntersectionObserver === "undefined"
    ) {
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) loadMore();
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadMore, nextCursor]);

  if (phase === "unauthorized") return null;
  if (phase === "loading") return <WaitMark />;
  if (phase === "failed") {
    return <EmptyState message={LIST_MESSAGES["MSG-019"]} />;
  }
  if (items.length === 0) return <EmptyState message={emptyMessage} />;

  const thisYear = thisYearInJapan(new Date());
  return (
    <>
      <ul>
        {items.map((item) => {
          // 種類の値は M14 の一覧にあるものだけが残る（DD-01 M14）。知らない種類の行は出さない。
          const kind = kindDisplayOf(item.kind);
          if (kind === null) return null;
          return (
            <ContentListRow
              key={item.contentId}
              href={kind.href(item.contentId)}
              kindLabel={kind.label}
              kindColor={kind.color}
              isNew={showNewAndUnread && item.isNew}
              isUnread={showNewAndUnread && !item.isRead}
              title={item.title}
              date={dateOfDateTime(dateOf(item))}
              thisYear={thisYear}
            />
          );
        })}
      </ul>
      {nextCursor !== null && <div ref={sentinelRef} aria-hidden="true" />}
      {loadingMore && <WaitMark />}
      {moreFailed && (
        <p role="status" className="px-4 py-3 text-center text-sm">
          {LIST_MESSAGES["MSG-019"]}
        </p>
      )}
    </>
  );
}

// 読み込み中の待つ印。
function WaitMark() {
  return (
    <div role="status" className="flex justify-center px-4 py-6">
      <span className="sr-only">読み込み中</span>
      <span
        aria-hidden="true"
        className="size-6 rounded-full border-2 border-current border-t-transparent motion-safe:animate-spin"
      />
    </div>
  );
}
