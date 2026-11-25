import type { ContentRouteContext } from "../../../../../_entry/content-state";
import { putEnglishAnswer } from "../../../../../_entry/english-learning";
import { webContext } from "../../../../../_entry/web-context";

// 教材の完了の道 PUT `/api/app/english/sets/{contentId}/answer`（DD-01 M11、DD-04 `putEnglishAnswer`）。
// 処理は `putEnglishAnswer` に任せる。

// DB のファイルを読むので Node.js の実行環境で動かし、要求ごとに処理する（DD-01 3章）。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function PUT(
  request: Request,
  routeContext: ContentRouteContext,
): Promise<Response> {
  const { deviceApi, english } = webContext();
  return putEnglishAnswer({ deviceApi, english })(request, routeContext);
}
