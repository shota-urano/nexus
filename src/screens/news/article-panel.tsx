"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchArticle, markOpened, setRead, setSaved } from "../../client/news";
import type { ArticleDetail, ContentState } from "../../contracts/news";
import { type BottomNotice, BottomNotices } from "../../ui/bottom-notices";
import { EmptyState } from "../../ui/empty-state";
import { ArticleGuide } from "../../ui/kinds/news/article-guide";
import {
  NEWS_MESSAGES,
  type StateOperation,
  stateFailedMessage,
} from "./messages";
import { WaitMark } from "./wait-mark";

// 記事の案内 SCR-003 の中身（DD-01 M03。BD-03 SCR-003、DD-02 FN-004〜FN-006）。
// SCR-002 からは下から出る面の中に、SCR-001、SCR-007〜SCR-009 からは全画面で置く。
// - 開いたら `getArticle` で記事と関係を読む（SCR-003-A01）。読み込み中は待つ印を出し、ボタンは出さない。
//   記事が無ければ MSG-002 と戻る操作、読めなければ MSG-019 を出す。401 のときは何も出さない
//   （全面の知らせは M01 の枠が出す）。別の記事に替えるときは、置く画面が `key` を内容ID にして
//   この部品を作り直す。前の読み込みはそこで止まる。
// - 案内を出した後に `markOpened` を呼ぶ。失敗しても案内を出したままにし、知らせを出さない
//   （DD-02 FN-004 手順 4）。
// - 「読んだ」「未読に戻す」「保存」「保存を外す」（SCR-003-A02〜A04）は、結果が出るまで押せなくする。
//   失敗したら MSG-003（押した操作の名前）を下の知らせに出し、状態は変えない。同じ操作をやり直して
//   成功したら、その知らせを消す（BD-09 2章）。

type Phase = "loading" | "ready" | "notFound" | "failed" | "unauthorized";
type StateAction = "read" | "saved";

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

// 今の日本時間の年。日付の書式（今年かどうか）を決める。
export function thisYearInJapan(now: Date): number {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).getUTCFullYear();
}

export function ArticlePanel({
  contentId,
  onLoaded,
  onStateChange,
  onSelectRelated,
  onBack,
}: {
  contentId: number;
  /** 記事を読めたとき（図に関係の先の記事を足す。DD-02 FN-003 手順 5） */
  onLoaded?: (article: ArticleDetail) => void;
  /** 内容の状態が変わったとき（図のノードの既読を合わせる） */
  onStateChange?: (state: ContentState) => void;
  /** 関係のある記事を押したとき（SCR-003-A06） */
  onSelectRelated: (contentId: number) => void;
  /** 記事が無いときの戻る操作（MSG-002） */
  onBack: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [article, setArticle] = useState<ArticleDetail | null>(null);
  const [pending, setPending] = useState<Record<StateAction, boolean>>({
    read: false,
    saved: false,
  });
  const [notices, setNotices] = useState<BottomNotice[]>([]);
  const callbacks = useRef({ onLoaded, onStateChange });

  useEffect(() => {
    callbacks.current = { onLoaded, onStateChange };
  }, [onLoaded, onStateChange]);

  const applyState = useCallback((state: ContentState) => {
    setArticle((previous) =>
      previous !== null && previous.contentId === state.contentId
        ? { ...previous, state }
        : previous,
    );
    callbacks.current.onStateChange?.(state);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetchArticle(contentId, { signal: controller.signal }).then(
      (result) => {
        if (controller.signal.aborted) return;
        if (result.status !== "ok") {
          setPhase(result.status);
          return;
        }
        setArticle(result.value);
        setPhase("ready");
        callbacks.current.onLoaded?.(result.value);
        markOpened(contentId).then(
          (opened) => {
            if (opened.status === "ok" && !controller.signal.aborted) {
              applyState(opened.value);
            }
          },
          // 開いた日時を残せなくても、案内を出したままにする（次に開いたときにもう一度呼ぶ）。
          () => undefined,
        );
      },
      (error: unknown) => {
        if (controller.signal.aborted || isAbortError(error)) return;
        setPhase("failed");
      },
    );
    return () => controller.abort();
  }, [contentId, applyState]);

  async function change(
    action: StateAction,
    operation: StateOperation,
    call: () => ReturnType<typeof setRead>,
  ) {
    setPending((previous) => ({ ...previous, [action]: true }));
    let result: Awaited<ReturnType<typeof setRead>>;
    try {
      result = await call();
    } catch {
      result = { status: "failed" };
    }
    setPending((previous) => ({ ...previous, [action]: false }));
    if (result.status === "ok") {
      applyState(result.value);
      setNotices((previous) => previous.filter((n) => n.id !== action));
    } else if (result.status !== "unauthorized") {
      setNotices((previous) => [
        ...previous.filter((n) => n.id !== action),
        { id: action, kind: "error", text: stateFailedMessage(operation) },
      ]);
    }
  }

  function closeNotice(id: string) {
    setNotices((previous) => previous.filter((n) => n.id !== id));
  }

  let body;
  if (phase === "unauthorized") {
    body = null;
  } else if (phase === "loading" || article === null) {
    body =
      phase === "notFound" ? (
        <EmptyState
          message={NEWS_MESSAGES["MSG-002"]}
          action={
            <button
              type="button"
              onClick={onBack}
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border px-4"
            >
              戻る
            </button>
          }
        />
      ) : phase === "failed" ? (
        <EmptyState message={NEWS_MESSAGES["MSG-019"]} />
      ) : (
        <WaitMark />
      );
  } else {
    const { state } = article;
    const buttonClass =
      "inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border px-4 disabled:opacity-50";
    body = (
      <ArticleGuide
        article={article}
        thisYear={thisYearInJapan(new Date())}
        onSelectRelated={onSelectRelated}
        actions={
          <>
            <button
              type="button"
              disabled={pending.read}
              onClick={() =>
                change("read", state.isRead ? "未読に戻す" : "既読に", () =>
                  setRead(article.contentId, !state.isRead),
                )
              }
              className={buttonClass}
            >
              {state.isRead ? "未読に戻す" : "読んだ"}
            </button>
            <button
              type="button"
              disabled={pending.saved}
              onClick={() =>
                change("saved", state.isSaved ? "保存を外す" : "保存", () =>
                  setSaved(article.contentId, !state.isSaved),
                )
              }
              className={buttonClass}
            >
              {state.isSaved ? "保存を外す" : "保存"}
            </button>
          </>
        }
      />
    );
  }

  return (
    <>
      {body}
      <BottomNotices notices={notices} onClose={closeNotice} />
    </>
  );
}
