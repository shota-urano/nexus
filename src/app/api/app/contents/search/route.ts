import { searchContents } from "../../../_entry/content-list";
import { webContext } from "../../../_entry/web-context";

// 検索の道 GET `/api/app/contents/search`（DD-01 M11、DD-04 `searchContents`）。
// 処理は `searchContents` に任せる。

// DB のファイルを読むので Node.js の実行環境で動かし、要求ごとに処理する（DD-01 3章）。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request): Promise<Response> {
  const { deviceApi, contents } = webContext();
  return searchContents({ deviceApi, contents })(request);
}
