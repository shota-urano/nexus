"use client";

import { ArticleScreen } from "../../../screens/news/article-screen";
import { useArticleChat } from "./article-chat";

// 記事の案内 SCR-003 を全画面で開いたとき（`/news?article={contentId}`）の中身（DD-01 M01）。
// 案内の「AI に質問」（SCR-003-A05）を押すと、その記事を対象に AI チャットの面を開く。
export function ArticleRoute({ contentId }: { contentId: number | null }) {
  const { askAi, chatSheet } = useArticleChat();
  return (
    <>
      <ArticleScreen contentId={contentId} onAskAi={askAi} />
      {chatSheet}
    </>
  );
}
