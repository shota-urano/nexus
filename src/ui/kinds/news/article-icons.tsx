// 記事の案内のアイコンのボタンの図（DD-01 M08。BD-03 SCR-003 の 3.2、SCR-003-O07、CR-018）。
// 「読んだ」「未読に戻す」は本、「保存」「保存を外す」はブックマーク、「AI に質問」は吹き出し。
// 既読と保存は、状態が入のときにアイコンを塗る（`filled`）。
// アイコンは SVG をここに書き、外から読み込まない。ボタンの名前は使う側が `aria-label` で付ける。

type IconProps = {
  /** 塗るか（既読の本、保存したブックマーク） */
  filled?: boolean;
};

const SVG_PROPS = {
  viewBox: "0 0 24 24",
  width: 22,
  height: 22,
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
  focusable: false,
} as const;

export function BookIcon({ filled = false }: IconProps) {
  return (
    <svg {...SVG_PROPS} fill={filled ? "currentColor" : "none"}>
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z" />
      <path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5" />
    </svg>
  );
}

export function BookmarkIcon({ filled = false }: IconProps) {
  return (
    <svg {...SVG_PROPS} fill={filled ? "currentColor" : "none"}>
      <path d="M6 3h12v18l-6-4.5L6 21z" />
    </svg>
  );
}

export function ChatIcon() {
  return (
    <svg {...SVG_PROPS} fill="none">
      <path d="M4 5h16v11H9l-5 4z" />
      <path d="M8 9.5h8M8 12.5h5" />
    </svg>
  );
}
