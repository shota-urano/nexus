import type { ReactNode } from "react";
import type { HomeNotice } from "../../contracts/home";

// ホームの6つの機能（BD-03 SCR-001-O01、BD-09 4章）。名前は依頼 2章の英語の名前をそのまま出す。
// 並びは HUD のセグメントの並び（時計回り）で、最初の News Galaxy を選んだ状態で開く（O01 の初期値）。
// 行き先は BD-03 2章の遷移表。AI Chat は道を持たず、下から出る面（SCR-006）で開く。
// 知らせ（O09）は、該当する機能のカードの中に出す（BD-09 2章「ホームのカード」）。

export type FeatureKey =
  "news" | "english" | "inbox" | "explore" | "library" | "chat";

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

// アイコンは 32 × 32 の座標で、線だけで描く。
export const FEATURES: readonly Feature[] = [
  {
    key: "news",
    name: "News Galaxy",
    href: "/news",
    notice: "MSG-015",
    color: "#ffb85e",
    icon: (
      <>
        <circle cx="16" cy="16" r="4" />
        <ellipse cx="16" cy="16" rx="13" ry="6" transform="rotate(-25 16 16)" />
        <circle cx="27" cy="11" r="1.6" />
        <circle cx="5" cy="21" r="1.6" />
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
        <path d="M5 8c4-2 8-1 11 2 3-3 7-4 11-2v17c-4-2-8-1-11 2-3-3-7-4-11-2Z" />
        <path d="M16 10v17" />
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
        <path d="M5 19 8 8h16l3 11v6H5Z" />
        <path d="M5 19h7l2 3h4l2-3h7" />
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
        <circle cx="14" cy="14" r="8" />
        <path d="m20 20 7 7" />
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
        <path d="M6 6h5v20H6ZM13 6h5v20h-5Z" />
        <path d="m21 7 4-1 3 19-4 1Z" />
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
        <path d="M7 7h18a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H15l-7 5v-5H7a3 3 0 0 1-3-3V10a3 3 0 0 1 3-3Z" />
        <path d="M10 15h12" />
      </>
    ),
  },
];

// 線のアイコン（飾り。読み上げない）。
export function FeatureIcon({
  feature,
  className,
}: {
  feature: Feature;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 32 32"
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
