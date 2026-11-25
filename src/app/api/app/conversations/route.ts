import {
  createConversation,
  listConversations,
} from "../../_entry/conversation";
import { webContext } from "../../_entry/web-context";

// 会話の一覧と新しい会話の道 GET、POST `/api/app/conversations`
// （DD-01 M11、DD-04 `listConversations`、`createConversation`）。
// 処理は `listConversations` と `createConversation` に任せる。

// DB のファイルを読むので Node.js の実行環境で動かし、要求ごとに処理する（DD-01 3章）。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request): Promise<Response> {
  const { deviceApi, chat } = webContext();
  return listConversations({ deviceApi, chat })(request);
}

export function POST(request: Request): Promise<Response> {
  const { deviceApi, chat } = webContext();
  return createConversation({ deviceApi, chat })(request);
}
