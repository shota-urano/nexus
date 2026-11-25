import { openRegistration } from "../api/_entry/open-registration";
import { webContext } from "../api/_entry/web-context";

// 登録の URL の道 GET `/register?code=…`（DD-01 M11、DD-04 `openRegistration`）。
// 端末の鍵は求めない。処理は `openRegistration` に任せる。

// DB のファイルを読むので Node.js の実行環境で動かし、要求ごとに処理する（DD-01 3章）。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request): Promise<Response> {
  return openRegistration(webContext())(request);
}
