"use client";

import { useState } from "react";
import { AskAiButton } from "../../../screens/news/ask-ai-button";
import { NewsGalaxyScreen } from "../../../screens/news/galaxy-screen";
import { TopBar } from "../_frame/top-bar";

// SCR-002 News Galaxy の上の帯と中身（DD-01 M01）。上の帯の「AI に質問」（SCR-002-A05）は、
// 中心の記事を選んでいるときだけ出し、選んでいないときは出さない（CR-003）。押すと中心の記事の
// 内容ID を `onAskAi` に渡す。開く AI チャット（SCR-006）の中身は 10-chat.md の範囲。
export function NewsGalaxyRoute({
  onAskAi,
}: {
  onAskAi?: (contentId: number) => void;
}) {
  const [center, setCenter] = useState<number | null>(null);
  return (
    <main className="flex h-dvh flex-col">
      <TopBar
        title="News Galaxy"
        action={
          center !== null ? (
            <AskAiButton onClick={() => onAskAi?.(center)} />
          ) : undefined
        }
      />
      <NewsGalaxyScreen onCenterChange={setCenter} onAskAi={onAskAi} />
    </main>
  );
}
