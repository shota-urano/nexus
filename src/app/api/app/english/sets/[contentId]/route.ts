import type { ContentRouteContext } from "../../../../_entry/content-state";
import { getEnglishSet } from "../../../../_entry/english-learning";
import { webContext } from "../../../../_entry/web-context";

// 教材の道 GET `/api/app/english/sets/{contentId}`（DD-01 M11、DD-04 `getEnglishSet`）。
// 処理は `getEnglishSet` に任せる。

// DB のファイルを読むので Node.js の実行環境で動かし、要求ごとに処理する（DD-01 3章）。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(
  request: Request,
  routeContext: ContentRouteContext,
): Promise<Response> {
  const { deviceApi, english } = webContext();
  return getEnglishSet({ deviceApi, english })(request, routeContext);
}
