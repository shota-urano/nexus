"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchArticle, markOpened, setRead, setSaved } from "../../client/news";
import type { ArticleDetail, ContentState } from "../../contracts/news";
import { type BottomNotice, BottomNotices } from "../../ui/bottom-notices";
import { EmptyState } from "../../ui/empty-state";
import { ArticleGuide } from "../../ui/kinds/news/article-guide";
import { BookIcon, BookmarkIcon } from "../../ui/kinds/news/article-icons";
import {
  NEWS_MESSAGES,
  type StateOperation,
  stateFailedMessage,
} from "./messages";
import { AskAiButton } from "./ask-ai-button";
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
// - 応答の状態は、操作ごとに変わる項目だけを取り込む（開いた: isNew、既読: isRead、保存: isSaved と
//   savedAt。DD-02 3章 P04）。後から届いた別の操作の古い応答が、新しい状態を上書きしないようにする。
// - 「AI に質問」（SCR-003-A05）は、この記事の内容ID を `onAskAi` に渡す。開く AI チャットの中身は
//   10-chat.md の範囲。

type Phase = "loading" | "ready" | "notFound" | "failed" | "unauthorized";
type StateAction = "read" | "saved";
type StateSource = "opened" | StateAction;

// 操作ごとに、応答から取り込む項目（DD-02 3章 P04 で、その操作が変える列）。
const FIELDS_OF: Record<StateSource, readonly (keyof ContentState)[]> = {
  opened: ["isNew"],
  read: ["isRead"],
  saved: ["isSaved", "savedAt"],
};

// 状態の変わったところ。内容ID と、その操作が変える項目だけを持つ。
export type ContentStateChange = Pick<ContentState, "contentId"> &
  Partial<Omit<ContentState, "contentId">>;

function pickChange(
  source: StateSource,
  state: ContentState,
): ContentStateChange {
  const change: ContentStateChange = { contentId: state.contentId };
  for (const field of FIELDS_OF[source]) {
    if (field in state) Object.assign(change, { [field]: state[field] });
  }
  return change;
}

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
  onAskAi,
}: {
  contentId: number;
  /** 記事を読めたとき（図に関係の先の記事を足す。DD-02 FN-003 手順 5） */
  onLoaded?: (article: ArticleDetail) => void;
  /** 内容の状態が変わったとき（図のノードの既読を合わせる）。変わった項目だけを渡す */
  onStateChange?: (change: ContentStateChange) => void;
  /** 関係のある記事を押したとき（SCR-003-A06） */
  onSelectRelated: (contentId: number) => void;
  /** 記事が無いときの戻る操作（MSG-002） */
  onBack: () => void;
  /** 「AI に質問」を押したとき（SCR-003-A05）。この記事の内容ID を渡す */
  onAskAi?: (contentId: number) => void;
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

  const applyState = useCallback((source: StateSource, state: ContentState) => {
    const change = pickChange(source, state);
    setArticle((previous) =>
      previous !== null && previous.contentId === change.contentId
        ? { ...previous, state: { ...previous.state, ...change } }
        : previous,
    );
    callbacks.current.onStateChange?.(change);
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
              applyState("opened", opened.value);
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
      applyState(action, result.value);
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
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border border-hud-line px-4"
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
      "inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border border-hud-line disabled:opacity-50";
    // 既読（本）と保存（ブックマーク）はアイコンのボタンにし、名前は BD-09 4章の操作の言葉にする。
    // 状態が入のときはアイコンを塗り、アンバーにする（SCR-003-O07、CR-018）。
    const readLabel = state.isRead ? "未読に戻す" : "読んだ";
    const saveLabel = state.isSaved ? "保存を外す" : "保存";
    body = (
      <ArticleGuide
        article={article}
        thisYear={thisYearInJapan(new Date())}
        onSelectRelated={onSelectRelated}
        actions={
          <>
            <button
              type="button"
              aria-label={readLabel}
              disabled={pending.read}
              onClick={() =>
                change("read", state.isRead ? "未読に戻す" : "既読に", () =>
                  setRead(article.contentId, !state.isRead),
                )
              }
              className={`${buttonClass} ${state.isRead ? "text-hud-amber" : "text-hud-text"}`}
            >
              <BookIcon filled={state.isRead} />
            </button>
            <button
              type="button"
              aria-label={saveLabel}
              disabled={pending.saved}
              onClick={() =>
                change("saved", state.isSaved ? "保存を外す" : "保存", () =>
                  setSaved(article.contentId, !state.isSaved),
                )
              }
              className={`${buttonClass} ${state.isSaved ? "text-hud-amber" : "text-hud-text"}`}
            >
              <BookmarkIcon filled={state.isSaved} />
            </button>
            <AskAiButton onClick={() => onAskAi?.(article.contentId)} />
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
