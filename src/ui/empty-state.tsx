import type { ReactNode } from "react";

// 空の状態（BD-09 2章、6章、DD-01 M07）。一覧や図にデータが無いとき、置き場所に
// MSG-001、MSG-004、MSG-008〜MSG-010、MSG-019 を出す。文言は画面が差し込んで渡す。
// 元になった状態が変わるまで残す。次にすること（戻る操作など）は `action` で渡す。
export function EmptyState({
  message,
  action,
}: {
  message: string;
  action?: ReactNode;
}) {
  return (
    <div
      role="status"
      className="flex flex-col items-center justify-center gap-4 px-6 py-12 text-center"
    >
      <p className="text-base leading-relaxed">{message}</p>
      {action}
    </div>
  );
}
