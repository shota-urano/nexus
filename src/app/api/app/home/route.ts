import { getHome } from "../../_entry/home";
import { webContext } from "../../_entry/web-context";

// ホームの道 GET `/api/app/home`（DD-01 M11、DD-04 `getHome`）。
// 処理は `getHome` に任せる。

// DB のファイルを読むので Node.js の実行環境で動かし、要求ごとに処理する（DD-01 3章）。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request): Promise<Response> {
  const { deviceApi, home } = webContext();
  return getHome({ deviceApi, home })(request);
}
