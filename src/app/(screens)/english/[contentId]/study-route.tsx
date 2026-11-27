"use client";

import { useCallback, useRef, useState } from "react";
import type { QuestionTarget } from "../../../../contracts/chat";
import { ChatSheet } from "../../../../screens/chat/chat-sheet";
import { EnglishStudyScreen } from "../../../../screens/english/english-study-screen";
import type { ReadingSelection } from "../../../../ui/kinds/english/reading";
import { TopBar } from "../../_frame/top-bar";

// SCR-005 英語の学習の上の帯と中身（DD-01 M01）。上の帯の「AI に質問」（SCR-005-A09）を押すと、
// AI チャットの面 SCR-006（M06 の ChatSheet）を下から開く（BD-03 4章、DD-02 FN-014）。
// - 読む教材で語句か文を選んでいれば、その語句と文と位置を対象（`kind: "phrase"`）にする。
// - 選んでいなければ、その教材のページ全体（`kind: "page"` と内容ID）を対象にする。
// 面は学習の画面の上に重ねるだけなので、閉じても学習の画面の答えと段はそのまま残る。

// `openapi.yaml` の QuestionTarget の phrase の長さの上限。
const PHRASE_MAX_LENGTH = 200;

function targetOf(
  contentId: number,
  selection: ReadingSelection | null,
): QuestionTarget {
  if (selection === null) return { kind: "page", contentId };
  return {
    kind: "phrase",
    contentId,
    // 文だけを選んだときは、その文を語句にもする（kind が phrase のときは語句が要る。DD-02 2章 C07）。
    phrase: selection.phrase ?? selection.sentence.slice(0, PHRASE_MAX_LENGTH),
    sentence: selection.sentence,
    position: {
      part: "reading",
      paragraphIndex: selection.paragraphIndex,
      sentenceIndex: selection.sentenceIndex,
    },
  };
}

// 押す場所は 44 ピクセル四方以上にする（RD-11 NFR-008）。
function AskAiButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border px-4"
    >
      AI に質問
    </button>
  );
}

export function EnglishStudyRoute({ contentId }: { contentId: number }) {
  const selectionRef = useRef<ReadingSelection | null>(null);
  const [open, setOpen] = useState(false);
  // 閉じる動きの間も同じ対象を出すため、閉じても対象は残す。
  const [target, setTarget] = useState<QuestionTarget | null>(null);
  const onSelect = useCallback((selection: ReadingSelection | null) => {
    selectionRef.current = selection;
  }, []);
  const askAi = () => {
    setTarget(targetOf(contentId, selectionRef.current));
    setOpen(true);
  };
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <TopBar title="English" action={<AskAiButton onClick={askAi} />} />
      <EnglishStudyScreen contentId={contentId} onSelect={onSelect} />
      <ChatSheet open={open} onClose={close} target={target} />
    </>
  );
}
