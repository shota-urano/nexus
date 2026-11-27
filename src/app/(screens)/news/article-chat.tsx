"use client";

import { type ReactNode, useCallback, useState } from "react";
import type { QuestionTarget } from "../../../contracts/chat";
import { ChatSheet } from "../../../screens/chat/chat-sheet";

// 記事の「AI に質問」（SCR-002-A05、SCR-003-A05）から開く AI チャットの面（SCR-006、DD-01 M06）を、
// 道（M01）が持つ。押された記事を対象（`kind: "article"` と内容ID）にして、下から出る面で開く
// （BD-03 4章）。面を閉じても、元の画面（図と記事の案内）には触れない。
export function useArticleChat(): {
  askAi: (contentId: number) => void;
  chatSheet: ReactNode;
} {
  const [open, setOpen] = useState(false);
  // 閉じる動きの間も同じ対象を出すため、閉じても対象は残す。
  const [target, setTarget] = useState<QuestionTarget | null>(null);
  const askAi = useCallback((contentId: number) => {
    setTarget({ kind: "article", contentId });
    setOpen(true);
  }, []);
  const close = useCallback(() => setOpen(false), []);
  return {
    askAi,
    chatSheet: <ChatSheet open={open} onClose={close} target={target} />,
  };
}
