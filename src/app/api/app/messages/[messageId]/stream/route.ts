import {
  type ReplyStreamRouteContext,
  streamReply,
} from "../../../../_entry/reply-stream";
import { webContext } from "../../../../_entry/web-context";

// 応答の続きの道 GET `/api/app/messages/{messageId}/stream`（DD-01 M11、DD-04 `streamReply`）。
// 処理は `streamReply` に任せる。

// DB のファイルを読むので Node.js の実行環境で動かし、要求ごとに処理する（DD-01 3章）。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(
  request: Request,
  routeContext: ReplyStreamRouteContext,
): Promise<Response> {
  const { deviceApi, chat } = webContext();
  return streamReply({ deviceApi, chat })(request, routeContext);
}
