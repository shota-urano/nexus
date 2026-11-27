import Link from "next/link";
import type { ReactNode } from "react";

// 上の帯（BD-09 5章、BD-03 4章）。ホームへ戻る操作と画面名を置く。
// 内容を開いている画面は、AI チャットを開く入口を `action` で渡す（CR-003）。
// 押す場所は 44 ピクセル四方以上にする（RD-11 NFR-008）。
// ホームへ戻る操作はホームと同じ NEXUS のロゴにし、ボタンの名前を「ホーム」にする。
// 上の帯は、端末の上端の安全な余白とホームの上の余白（pt-6）の大きいほうだけ下げ、
// iPad のホーム画面のアプリのウィンドウの操作ボタンに隠れないようにする（CR-018）。
export function TopBar({
  title,
  action,
}: {
  title: string;
  action?: ReactNode;
}) {
  // 題名の最後の語（「News Galaxy」なら「Galaxy」）をアンバーにする（BD-03 SCR-002、CR-018）。
  const cut = title.lastIndexOf(" ");
  const head = cut >= 0 ? title.slice(0, cut + 1) : "";
  const last = cut >= 0 ? title.slice(cut + 1) : title;
  return (
    <header className="flex min-h-11 items-center gap-2 px-2 pt-[max(1.5rem,env(safe-area-inset-top))]">
      <Link
        href="/"
        aria-label="ホーム"
        className="inline-flex min-h-11 min-w-11 items-center justify-center"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/img/home/logo_001.png"
          alt=""
          aria-hidden="true"
          className="size-10 shrink-0 object-contain drop-shadow-[0_0_10px_#ef9e4c66]"
        />
      </Link>
      <h1 className="flex-1 truncate text-base font-semibold">
        {head}
        <span className="text-hud-amber">{last}</span>
      </h1>
      {action}
    </header>
  );
}
