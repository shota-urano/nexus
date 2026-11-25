"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchEnglishSets } from "../../client/english";
import type { EnglishSetSummary } from "../../contracts/english";
import { EmptyState } from "../../ui/empty-state";
import { formatListDate } from "../../ui/list-date";
import { ENGLISH_MESSAGES } from "./messages";
import { WaitMark } from "./wait-mark";

// SCR-004 英語の教材の一覧（DD-01 M04。BD-03 SCR-004、BD-02 FN-008）。
// - 画面を開いたら教材を対象日の新しい順に読む（A01）。読み込み中は一覧の場所に待つ印を出す。
// - 0件なら MSG-004、読めなければ MSG-019 を空の状態で出す（3.5）。
// - 401（MSG-020）のときは何も出さない。全面の知らせは M01 の枠が出す。
// - 行には日付（O01）、学習テーマ（O02）、「完了」と「新着」のタグ（O03）を出す。押すと SCR-005（A02）。
// - 下までスクロールすると続きを読み、一覧に足す（A03）。読み込み中はもう一度読まない。
//   足せなければ一覧の下に MSG-019 を出す。

type Phase = "loading" | "ready" | "failed" | "unauthorized";

function thisYearInJapan(now: Date): number {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).getUTCFullYear();
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export function EnglishListScreen() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [items, setItems] = useState<EnglishSetSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [moreFailed, setMoreFailed] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadingMoreRef = useRef(false);
  const controllerRef = useRef<AbortController | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    controllerRef.current = controller;
    fetchEnglishSets({ signal: controller.signal }).then(
      (result) => {
        if (controller.signal.aborted) return;
        if (result.status === "ok") {
          setItems(result.value.items);
          setNextCursor(result.value.nextCursor);
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
  }, []);

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
    fetchEnglishSets({ cursor: nextCursor, signal: controller.signal }).then(
      (result) => {
        if (controller.signal.aborted) return;
        finish();
        if (result.status === "ok") {
          setItems((previous) => [...previous, ...result.value.items]);
          setNextCursor(result.value.nextCursor);
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
  }, [nextCursor, phase]);

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
    return <EmptyState message={ENGLISH_MESSAGES["MSG-019"]} />;
  }
  if (items.length === 0) {
    return <EmptyState message={ENGLISH_MESSAGES["MSG-004"]} />;
  }

  const thisYear = thisYearInJapan(new Date());
  return (
    <>
      <ul>
        {items.map((item) => (
          <li key={item.contentId}>
            <Link
              href={`/english/${item.contentId}`}
              className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2"
            >
              <span className="shrink-0 text-sm">
                {formatListDate(item.targetDate, thisYear)}
              </span>
              <span className="min-w-0 flex-1 truncate">
                {item.learningTheme}
              </span>
              {item.isCompleted && (
                <span className="shrink-0 rounded-full border px-2 text-xs">
                  完了
                </span>
              )}
              {item.isNew && (
                <span className="shrink-0 rounded-full px-2 text-xs font-semibold">
                  新着
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>
      {nextCursor !== null && <div ref={sentinelRef} aria-hidden="true" />}
      {loadingMore && <WaitMark />}
      {moreFailed && (
        <p role="status" className="px-4 py-3 text-center text-sm">
          {ENGLISH_MESSAGES["MSG-019"]}
        </p>
      )}
    </>
  );
}
