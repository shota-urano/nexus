import { listInbox } from "../../../_entry/content-list";
import { webContext } from "../../../_entry/web-context";

// 新着と未読の一覧の道 GET `/api/app/contents/inbox`（DD-01 M11、DD-04 `listInbox`）。
// 処理は `listInbox` に任せる。

// DB のファイルを読むので Node.js の実行環境で動かし、要求ごとに処理する（DD-01 3章）。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request): Promise<Response> {
  const { deviceApi, contents } = webContext();
  return listInbox({ deviceApi, contents })(request);
}
