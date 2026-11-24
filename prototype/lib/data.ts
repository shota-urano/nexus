// 試作の作り物のデータ。本当のニュースではない（X-07 3章）。
export type Article = {
  id: string;
  date: string; // YYYY-MM-DD
  title: string;
  theme: string;
  guide: string;
  hue: number; // 画像の代わりの色
};

export type Relation = { from: string; to: string; type: "続報" | "背景" | "共通の主体" | "関連する話題"; reason: string };

export const TODAY = "2026-11-24";

const themes = ["AI", "開発", "経済", "科学", "デザイン"];

export const articles: Article[] = [
  ...Array.from({ length: 10 }, (_, i) => ({
    id: `t${i + 1}`,
    date: TODAY,
    title: `【試作】今日の記事 ${i + 1}: 作り物の見出しが入ります。長さを見るために少し長くしています`,
    theme: themes[i % themes.length],
    guide:
      "【試作の作り物】何があった\nここに配信元が書いた10行以内の案内が入ります。\n一言でいうと\n作り物の文です。本当のニュースではありません。\n\n[記事を開く](https://example.com/)",
    hue: (i * 37) % 360,
  })),
  ...Array.from({ length: 4 }, (_, i) => ({
    id: `p${i + 1}`,
    date: `2026-11-${String(20 - i).padStart(2, "0")}`,
    title: `【試作】過去の記事 ${i + 1}: 7日前までの作り物の見出し`,
    theme: themes[(i + 2) % themes.length],
    guide: "【試作の作り物】過去の記事の案内です。",
    hue: (i * 71 + 200) % 360,
  })),
];

export const relations: Relation[] = [
  { from: "t1", to: "t2", type: "続報", reason: "AI の判定（作り物）: 同じ出来事の続きを伝えている" },
  { from: "t1", to: "p1", type: "背景", reason: "AI の判定（作り物）: 過去の記事が背景を伝えている" },
  { from: "t3", to: "t4", type: "共通の主体", reason: "AI の判定（作り物）: 同じ会社を扱う" },
  { from: "t3", to: "p2", type: "関連する話題", reason: "AI の判定（作り物）: 関連する話題" },
  { from: "t5", to: "t1", type: "関連する話題", reason: "AI の判定（作り物）: 関連する話題" },
  { from: "t6", to: "p3", type: "背景", reason: "AI の判定（作り物）: 背景" },
  { from: "t7", to: "t8", type: "続報", reason: "AI の判定（作り物）: 続報" },
  { from: "p1", to: "p4", type: "続報", reason: "AI の判定（作り物）: 過去の記事どうしの続報" },
];

export const byId = (id: string) => articles.find((a) => a.id === id);
export const relationsOf = (id: string) => relations.filter((r) => r.from === id || r.to === id);

// BD-09 5章の表示の書式（P06 で確かめる）
const WD = "日月火水木金土";
export function formatDate(ymd: string, todayYear = 2026) {
  const [y, m, d] = ymd.split("-").map(Number);
  const wd = WD[new Date(y, m - 1, d).getDay()];
  return y === todayYear ? `${m}月${d}日（${wd}）` : `${y}年${m}月${d}日`;
}
export const formatTime = (hhmm: string) => hhmm;

// 記事の見本の写真（Codex が作った作り物。テーマごとに1枚）
const THEME_IMG: Record<string, string> = { AI: "ai", 開発: "dev", 経済: "econ", 科学: "sci", デザイン: "design" };
export const imageOf = (a: Article) => `/img/news_sample_${THEME_IMG[a.theme] ?? "ai"}_001.png`;
