import {
  type ContentRouteContext,
  markOpened,
} from "../../../../_entry/content-state";
import { webContext } from "../../../../_entry/web-context";

// 初めて開いた日時を残す道 POST `/api/app/contents/{contentId}/opened`（DD-01 M11、DD-04 `markOpened`）。
// 処理は `markOpened` に任せる。

// DB のファイルを読むので Node.js の実行環境で動かし、要求ごとに処理する（DD-01 3章）。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(
  request: Request,
  routeContext: ContentRouteContext,
): Promise<Response> {
  const { deviceApi, contents } = webContext();
  return markOpened({ deviceApi, contents })(request, routeContext);
}
