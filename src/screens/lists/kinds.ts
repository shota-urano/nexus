// 一覧の行に出す種類の名前と色の印と、行を押したときに開く道（BD-09 3章、BD-03 3章 SCR-007-A02、
// SCR-008-A03、SCR-009-A02）。色と道は画面の試作 `prototype/` に合わせる（本人の答え）。
// - ニュース: 記事の案内 SCR-003 を全画面で開く `/news?article={contentId}`
// - 英語: 英語の学習 SCR-005 `/english/{contentId}`
// - 週報: 課題の週報 SCR-011 `/research/{contentId}`（CR-020。BD-03 2章 遷移表）。色はデザインシステムの
//   `--color-kind-research`（globals の @theme。本人の答え）を使う。

interface KindDisplay {
  label: string;
  color: string;
  href: (contentId: number) => string;
}

const KIND_DISPLAYS: Record<string, KindDisplay> = {
  news: {
    label: "ニュース",
    color: "#5aa9ff",
    href: (contentId) => `/news?article=${contentId}`,
  },
  english: {
    label: "英語",
    color: "#ffb040",
    href: (contentId) => `/english/${contentId}`,
  },
  research: {
    label: "週報",
    color: "var(--color-kind-research)",
    href: (contentId) => `/research/${contentId}`,
  },
};

// 種類の表示を引く。知らない種類は無い（null）。
export function kindDisplayOf(kind: string): KindDisplay | null {
  return Object.hasOwn(KIND_DISPLAYS, kind) ? KIND_DISPLAYS[kind] : null;
}
