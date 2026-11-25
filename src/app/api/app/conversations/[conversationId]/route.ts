import {
  type ConversationRouteContext,
  getConversation,
} from "../../../_entry/conversation";
import { webContext } from "../../../_entry/web-context";

// 会話の発言の道 GET `/api/app/conversations/{conversationId}`（DD-01 M11、DD-04 `getConversation`）。
// 処理は `getConversation` に任せる。

// DB のファイルを読むので Node.js の実行環境で動かし、要求ごとに処理する（DD-01 3章）。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(
  request: Request,
  routeContext: ConversationRouteContext,
): Promise<Response> {
  const { deviceApi, chat } = webContext();
  return getConversation({ deviceApi, chat })(request, routeContext);
}
