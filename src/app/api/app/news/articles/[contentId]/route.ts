import { type ArticleRouteContext, getArticle } from "../../../../_entry/news";
import { webContext } from "../../../../_entry/web-context";

// 記事の案内の道 GET `/api/app/news/articles/{contentId}`（DD-01 M11、DD-04 `getArticle`）。
// 処理は `getArticle` に任せる。

// DB のファイルを読むので Node.js の実行環境で動かし、要求ごとに処理する（DD-01 3章）。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(
  request: Request,
  routeContext: ArticleRouteContext,
): Promise<Response> {
  const { deviceApi, news } = webContext();
  return getArticle({ deviceApi, news })(request, routeContext);
}
