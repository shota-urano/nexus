"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchResearchTopics } from "../../client/research";
import type { ResearchTopicSummaryView } from "../../contracts/research";
import { EmptyState } from "../../ui/empty-state";
import { formatListDate } from "../../ui/list-date";
import { dateOfDateTime } from "../lists/content-list";
import { RESEARCH_MESSAGES } from "./messages";

// SCR-010 課題の一覧（DD-01 M32。BD-03 SCR-010、BD-02 FN-026。CR-020）。
// - 画面を開いたら `listResearchTopics` を読む（SCR-010-A01）。読み込み中は一覧の場所に待つ印を出す。
// - 課題を応答の順（最後に届いた日時の新しい順）に1行ずつ出す。続きの読み込みは無い（DD-04 3.3）。
// - 行には課題名、状態（「進行中」「終了」。終了は文字を薄くする）、「{n}週目」、
//   最後に届いた日（日付だけ。BD-09 5章）、未読の週報があれば点を出す（SCR-010-O01〜O05）。
// - 行を押すと、その課題の最新の週の週報 `/research/{latestContentId}` へ移る（SCR-010-A02）。
// - 0件なら MSG-047、読めなければ MSG-019 を空の状態で出す（BD-03 SCR-010 3.5）。
// - 401（MSG-020）のときは何も出さない。全面の知らせは M01 の枠が出す。

type State =
  | { phase: "loading" }
  | { phase: "ready"; topics: ResearchTopicSummaryView[] }
  | { phase: "failed" }
  | { phase: "unauthorized" };

const STATUS_LABELS = { active: "進行中", ended: "終了" } as const;

// 今の日本時間の年。日付の書式（今年かどうか）を決める。
function thisYearInJapan(now: Date): number {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).getUTCFullYear();
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export function ResearchTopicsScreen() {
  const [state, setState] = useState<State>({ phase: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    fetchResearchTopics({ signal: controller.signal }).then(
      (result) => {
        if (controller.signal.aborted) return;
        if (result.status === "ok") {
          setState({ phase: "ready", topics: result.value.topics });
        } else {
          setState({ phase: result.status });
        }
      },
      (error: unknown) => {
        if (controller.signal.aborted || isAbortError(error)) return;
        setState({ phase: "failed" });
      },
    );
    return () => controller.abort();
  }, []);

  if (state.phase === "unauthorized") return null;
  if (state.phase === "loading") return <WaitMark />;
  if (state.phase === "failed") {
    return <EmptyState message={RESEARCH_MESSAGES["MSG-019"]} />;
  }
  if (state.topics.length === 0) {
    return <EmptyState message={RESEARCH_MESSAGES["MSG-047"]} />;
  }

  const thisYear = thisYearInJapan(new Date());
  return (
    <ul>
      {state.topics.map((topic) => (
        <TopicRow key={topic.topicId} topic={topic} thisYear={thisYear} />
      ))}
    </ul>
  );
}

function TopicRow({
  topic,
  thisYear,
}: {
  topic: ResearchTopicSummaryView;
  thisYear: number;
}) {
  const ended = topic.status === "ended";
  return (
    <li>
      <Link
        href={`/research/${topic.latestContentId}`}
        className="flex min-h-11 items-start gap-3 px-4 py-3"
      >
        <span className="flex w-2.5 shrink-0 justify-center pt-2">
          {topic.hasUnread && (
            <span
              data-testid="unread-mark"
              role="img"
              aria-label="未読"
              className="size-2.5 rounded-full bg-amber-400"
            />
          )}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="line-clamp-2">{topic.title}</span>
          <span className="flex flex-wrap gap-x-3 text-sm">
            <span className={ended ? "opacity-50" : undefined}>
              {STATUS_LABELS[topic.status]}
            </span>
            <span>{`${topic.lastWeek}週目`}</span>
            <span>
              {formatListDate(dateOfDateTime(topic.lastReceivedAt), thisYear)}
            </span>
          </span>
        </span>
      </Link>
    </li>
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
