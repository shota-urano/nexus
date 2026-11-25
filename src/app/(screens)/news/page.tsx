import { ArticleScreen } from "../../../screens/news/article-screen";
import { NewsGalaxyScreen } from "../../../screens/news/galaxy-screen";
import { TopBar } from "../_frame/top-bar";

// SCR-002 News Galaxy の道 `/news`（DD-01 M01）。中身は M03 に任せる。
// SCR-003 記事の案内は道を持たない（DD-01 M01）ので、SCR-001、SCR-007〜SCR-009 から全画面で開くときは
// 同じ道に `article={contentId}` を付けて開く（M05 の一覧の行の行き先）。

const ID_PATTERN = /^[1-9][0-9]*$/;

// `article` の値を内容ID にする。内容ID の形でなければ null。
function articleIdOf(value: string): number | null {
  if (!ID_PATTERN.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}

export default async function NewsRoute({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { article } = await searchParams;
  if (typeof article === "string") {
    return (
      <main>
        <TopBar title="記事の案内" />
        <ArticleScreen contentId={articleIdOf(article)} />
      </main>
    );
  }
  return (
    <main className="flex h-dvh flex-col">
      <TopBar title="News Galaxy" />
      <NewsGalaxyScreen />
    </main>
  );
}
