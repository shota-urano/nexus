import { getGalaxy } from "../../../_entry/news";
import { webContext } from "../../../_entry/web-context";

// 記事の図の道 GET `/api/app/news/galaxy`（DD-01 M11、DD-04 `getGalaxy`）。
// 処理は `getGalaxy` に任せる。

// DB のファイルを読むので Node.js の実行環境で動かし、要求ごとに処理する（DD-01 3章）。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request): Promise<Response> {
  const { deviceApi, news } = webContext();
  return getGalaxy({ deviceApi, news })(request);
}
