import Link from "next/link";
import type { ReactNode } from "react";

// 上の帯（BD-09 5章、BD-03 4章）。ホームへ戻る操作と画面名を置く。
// 内容を開いている画面は、AI チャットを開く入口を `action` で渡す（CR-003）。
// 押す場所は 44 ピクセル四方以上にする（RD-11 NFR-008）。
export function TopBar({
  title,
  action,
}: {
  title: string;
  action?: ReactNode;
}) {
  return (
    <header className="flex min-h-11 items-center gap-2 px-2">
      <Link
        href="/"
        className="inline-flex min-h-11 min-w-11 items-center justify-center px-2"
      >
        ホーム
      </Link>
      <h1 className="flex-1 truncate text-base font-semibold">{title}</h1>
      {action}
    </header>
  );
}
