"use client";

import { useEffect, useState } from "react";
import { fetchEnglishSet, markOpened } from "../../client/english";
import type { EnglishSetDetail } from "../../contracts/english";
import type { ReadingSelection } from "../../ui/kinds/english/reading";
import { EmptyState } from "../../ui/empty-state";
import { EnglishStudy } from "./english-study";
import { ENGLISH_MESSAGES } from "./messages";
import { WaitMark } from "./wait-mark";

// SCR-005 英語の学習の画面（DD-01 M04。BD-03 SCR-005-A01、BD-02 FN-009）。
// 画面を開いたら教材を読み、教材の段を出す。出した後に `markOpened` を呼ぶ（DD-02 FN-009 手順 4）。
// `markOpened` が失敗しても教材を出したままにし、知らせを出さない。
// 読み込み中は待つ印、読めなければ MSG-019 を出す。401（MSG-020）は M01 の枠が出すので何も出さない。

type State =
  | { phase: "loading" }
  | { phase: "ready"; set: EnglishSetDetail }
  | { phase: "failed" }
  | { phase: "unauthorized" };

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export function EnglishStudyScreen({
  contentId,
  onSelect,
}: {
  contentId: number;
  /** 読む教材で選んでいる箇所が替わったとき（SCR-005-A09 の対象）。選んでいなければ null */
  onSelect?: (selection: ReadingSelection | null) => void;
}) {
  const [state, setState] = useState<State>({ phase: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    fetchEnglishSet(contentId, controller.signal).then(
      (result) => {
        if (controller.signal.aborted) return;
        if (result.status === "ok") {
          setState({ phase: "ready", set: result.value });
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
  }, [contentId]);

  const readyId = state.phase === "ready" ? state.set.contentId : null;
  useEffect(() => {
    if (readyId !== null) void markOpened(readyId);
  }, [readyId]);

  if (state.phase === "unauthorized") return null;
  if (state.phase === "loading") return <WaitMark />;
  if (state.phase === "failed") {
    return <EmptyState message={ENGLISH_MESSAGES["MSG-019"]} />;
  }
  return <EnglishStudy set={state.set} onSelect={onSelect} />;
}
