import {
  type ContentRouteContext,
  setSaved,
} from "../../../../_entry/content-state";
import { webContext } from "../../../../_entry/web-context";

// 保存するか保存を外す道 PUT `/api/app/contents/{contentId}/saved`（DD-01 M11、DD-04 `setSaved`）。
// 処理は `setSaved` に任せる。

// DB のファイルを読むので Node.js の実行環境で動かし、要求ごとに処理する（DD-01 3章）。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function PUT(
  request: Request,
  routeContext: ContentRouteContext,
): Promise<Response> {
  const { deviceApi, contents } = webContext();
  return setSaved({ deviceApi, contents })(request, routeContext);
}
