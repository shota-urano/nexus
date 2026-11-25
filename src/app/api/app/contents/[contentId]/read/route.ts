import {
  type ContentRouteContext,
  setRead,
} from "../../../../_entry/content-state";
import { webContext } from "../../../../_entry/web-context";

// 既読にするか未読に戻す道 PUT `/api/app/contents/{contentId}/read`（DD-01 M11、DD-04 `setRead`）。
// 処理は `setRead` に任せる。

// DB のファイルを読むので Node.js の実行環境で動かし、要求ごとに処理する（DD-01 3章）。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function PUT(
  request: Request,
  routeContext: ContentRouteContext,
): Promise<Response> {
  const { deviceApi, contents } = webContext();
  return setRead({ deviceApi, contents })(request, routeContext);
}
