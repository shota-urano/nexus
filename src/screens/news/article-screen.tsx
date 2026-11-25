"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { EmptyState } from "../../ui/empty-state";
import { ArticlePanel } from "./article-panel";
import { NEWS_MESSAGES } from "./messages";

// 記事の案内 SCR-003 を全画面で開く（DD-01 M03。BD-03 SCR-003 の 3.1、遷移表）。
// SCR-001、SCR-007〜SCR-009 から `/news?article={contentId}` で開く。関係のある記事を押すと、
// その記事の案内を開く（SCR-003-A06）。記事が無いときの戻る操作は、1つ前の画面に戻る。
// URL の内容ID が内容ID の形でなければ、記事が無いとして MSG-002 を出す（BD-03 2章 URL の直接入力）。
// 「AI に質問」（SCR-003-A05）は案内の操作の並びに置き、`onAskAi` に内容ID を渡す。
export function ArticleScreen({
  contentId,
  onAskAi,
}: {
  contentId: number | null;
  /** 「AI に質問」を押したとき。この記事の内容ID を渡す */
  onAskAi?: (contentId: number) => void;
}) {
  const router = useRouter();
  const openRelated = useCallback(
    (id: number) => router.push(`/news?article=${id}`),
    [router],
  );
  const back = useCallback(() => router.back(), [router]);
  if (contentId === null) {
    return (
      <EmptyState
        message={NEWS_MESSAGES["MSG-002"]}
        action={
          <button
            type="button"
            onClick={back}
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border px-4"
          >
            戻る
          </button>
        }
      />
    );
  }
  return (
    <ArticlePanel
      key={contentId}
      contentId={contentId}
      onSelectRelated={openRelated}
      onBack={back}
      onAskAi={onAskAi}
    />
  );
}
