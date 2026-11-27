import type { ReactNode } from "react";
import type { HomeNotice } from "../../contracts/home";

// ホームの7つの機能（BD-03 SCR-001-O01、BD-09 4章）。名前は依頼 2章の英語の名前をそのまま出す。
// 並びは HUD のセグメントの並び（時計回り）で、試作 `prototype/app/page.tsx` の MODULES と同じ
// （Research は CR-020。7分割は Q-095 の答えで試作のまま）。最初の News Galaxy を選んだ状態で開く（O01 の初期値）。
// 行き先は BD-03 2章の遷移表。AI Chat は道を持たず、下から出る面（SCR-006）で開く。
// 知らせ（O09）は、該当する機能のカードの中に出す（BD-09 2章「ホームのカード」）。

export type FeatureKey =
  "news" | "english" | "research" | "inbox" | "explore" | "library" | "chat";

export interface Feature {
  key: FeatureKey;
  name: string;
  /** 移る画面の道。AI Chat は null（下から出る面で開く） */
  href: string | null;
  /** このカードに出す知らせ */
  notice: HomeNotice | null;
  /** 光の色 */
  color: string;
  icon: ReactNode;
}

// アイコンは 32 × 32 の座標で、線だけで描く。絵は BD-13 の試作 `prototype/app/page.tsx` の `I` と同じにする。
export const FEATURES: readonly Feature[] = [
  {
    key: "news",
    name: "News Galaxy",
    href: "/news",
    notice: "MSG-015",
    color: "#ffb85e",
    icon: (
      <>
        <ellipse
          cx="16"
          cy="16"
          rx="14"
          ry="7"
          transform="rotate(-32 16 16)"
          opacity="0.65"
        />
        <path d="m7 20 8-13 5 12 6-7" />
        <circle cx="7" cy="20" r="2" />
        <circle cx="15" cy="7" r="2" />
        <circle cx="20" cy="19" r="2" />
        <circle cx="26" cy="12" r="1.5" />
      </>
    ),
  },
  {
    key: "english",
    name: "English",
    href: "/english",
    notice: "MSG-016",
    color: "#8eb5fa",
    icon: (
      <>
        <path d="M4 7c5-2 9-1 12 2 3-3 7-4 12-2v18c-5-2-9-1-12 2-3-3-7-4-12-2Z" />
        <path d="M16 9v18M8 18l3-7 3 7M9 16h4M21 13h3M21 17h3" />
      </>
    ),
  },
  {
    // アイコンは虫眼鏡と折れ線（試作の `researchB`。BD-03 SCR-001 3.2、Q-095 の答え）。
    // Explore の方位の印とは、形、色（Research は緑、Explore は紫）、機能名で見分ける。
    key: "research",
    name: "Research",
    href: "/research",
    notice: null,
    color: "#5fd3a2",
    icon: (
      <>
        <circle cx="13" cy="13" r="8.5" />
        <path d="m19.5 19.5 8 8" />
        <path d="m8 15.5 3-3 3 2 4-5" />
      </>
    ),
  },
  {
    key: "inbox",
    name: "Inbox",
    href: "/inbox",
    notice: null,
    color: "#ffb85e",
    icon: (
      <>
        <path d="m4 20 3-12h18l3 12v7H4Z" />
        <path d="M4 20h7l2 3h6l2-3h7M12 13h8M16 10v6" />
      </>
    ),
  },
  {
    key: "explore",
    name: "Explore",
    href: "/explore",
    notice: null,
    color: "#c3a2fb",
    icon: (
      <>
        <circle cx="16" cy="16" r="11" />
        <path d="m21 10-3 9-8 3 3-9Z" />
        <path d="M16 2v3M16 27v3M2 16h3M27 16h3" />
      </>
    ),
  },
  {
    key: "library",
    name: "Library",
    href: "/library",
    notice: null,
    color: "#8ed2bc",
    icon: (
      <>
        <path d="M5 7v20h22M9 6h5v17H9ZM17 5h5v18h-5ZM25 7l4 15" />
        <path d="M10 11h3M18 10h3" />
      </>
    ),
  },
  {
    key: "chat",
    name: "AI Chat",
    href: null,
    notice: "MSG-017",
    color: "#c3a2fb",
    icon: (
      <>
        <path d="M7 7h18a3 3 0 0 1 3 3v11a3 3 0 0 1-3 3H15l-7 5v-5H7a3 3 0 0 1-3-3V10a3 3 0 0 1 3-3Z" />
        <path d="M9 16h3l2-4 4 8 2-4h3" />
      </>
    ),
  },
];

// 線のアイコン（飾り。読み上げない）。
// HUD の SVG の中に置くときは `size` で大きさを決める（決めないと HUD いっぱいに広がる）。
export function FeatureIcon({
  feature,
  className,
  size,
}: {
  feature: Feature;
  className?: string;
  size?: number;
}) {
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      className={className}
      style={{ color: feature.color }}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {feature.icon}
    </svg>
  );
}
