import {
  type ReplyActionRouteContext,
  stopReply,
} from "../../../../_entry/reply-action";
import { webContext } from "../../../../_entry/web-context";

// 作成中の応答を止める道 POST `/api/app/messages/{messageId}/stop`（DD-01 M11、DD-04 `stopReply`）。
// 処理は `stopReply` に任せる。

// DB のファイルを読むので Node.js の実行環境で動かし、要求ごとに処理する（DD-01 3章）。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(
  request: Request,
  routeContext: ReplyActionRouteContext,
): Promise<Response> {
  const { deviceApi, chat } = webContext();
  return stopReply({ deviceApi, chat })(request, routeContext);
}
