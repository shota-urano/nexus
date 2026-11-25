import {
  type ReplyActionRouteContext,
  dismissReply,
} from "../../../../_entry/reply-action";
import { webContext } from "../../../../_entry/web-context";

// 失敗した応答をやめる道 POST `/api/app/messages/{messageId}/dismiss`（DD-01 M11、DD-04 `dismissReply`）。
// 処理は `dismissReply` に任せる。

// DB のファイルを読むので Node.js の実行環境で動かし、要求ごとに処理する（DD-01 3章）。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(
  request: Request,
  routeContext: ReplyActionRouteContext,
): Promise<Response> {
  const { deviceApi, chat } = webContext();
  return dismissReply({ deviceApi, chat })(request, routeContext);
}
