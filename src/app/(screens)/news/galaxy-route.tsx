"use client";

import { NewsGalaxyScreen } from "../../../screens/news/galaxy-screen";
import { TopBar } from "../_frame/top-bar";
import { useArticleChat } from "./article-chat";

// SCR-002 News Galaxy の上の帯と中身（DD-01 M01）。上の帯には「AI に質問」を置かない
// （SCR-002-A05 は CR-018 でやめた）。AI チャットは記事の案内の「AI に質問」（SCR-003-A05）から開き、
// その記事の内容ID を `onAskAi` に渡す。開く AI チャット（SCR-006）の中身は 10-chat.md の範囲。
// `onAskAi` を渡さないとき（道 `/news`）は、その記事を対象に AI チャットの面を開く（BD-03 4章）。
export function NewsGalaxyRoute({
  onAskAi,
}: {
  onAskAi?: (contentId: number) => void;
}) {
  const { askAi: openChat, chatSheet } = useArticleChat();
  const askAi = onAskAi ?? openChat;
  return (
    <main className="flex h-dvh flex-col">
      <TopBar title="News Galaxy" />
      <NewsGalaxyScreen onAskAi={askAi} />
      {chatSheet}
    </main>
  );
}
