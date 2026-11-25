import {
  type ConversationRouteContext,
  postQuestion,
} from "../../../../_entry/conversation";
import { webContext } from "../../../../_entry/web-context";

// 質問の道 POST `/api/app/conversations/{conversationId}/questions`（DD-01 M11、DD-04 `postQuestion`）。
// 処理は `postQuestion` に任せる。

// DB のファイルを読むので Node.js の実行環境で動かし、要求ごとに処理する（DD-01 3章）。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(
  request: Request,
  routeContext: ConversationRouteContext,
): Promise<Response> {
  const { deviceApi, chat } = webContext();
  return postQuestion({ deviceApi, chat })(request, routeContext);
}
