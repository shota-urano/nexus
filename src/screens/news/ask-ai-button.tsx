// 「AI に質問」の入口（BD-03 SCR-002-A05、SCR-003-A05。CR-003）。押すと、対象の記事を
// 受け取り手に渡す。開く AI チャット（SCR-006）の中身は 10-chat.md の範囲。
// 押す場所は 44 ピクセル四方以上にする（RD-11 NFR-008）。
export function AskAiButton({ onClick }: { onClick: () => void }) {
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
