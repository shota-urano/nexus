import {
  type ReplyActionRouteContext,
  retryReply,
} from "../../../../_entry/reply-action";
import { webContext } from "../../../../_entry/web-context";

// 失敗か中止の応答を送り直す道 POST `/api/app/messages/{messageId}/retry`（DD-01 M11、DD-04 `retryReply`）。
// 処理は `retryReply` に任せる。

// DB のファイルを読むので Node.js の実行環境で動かし、要求ごとに処理する（DD-01 3章）。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(
  request: Request,
  routeContext: ReplyActionRouteContext,
): Promise<Response> {
  const { deviceApi, chat } = webContext();
  return retryReply({ deviceApi, chat })(request, routeContext);
}
