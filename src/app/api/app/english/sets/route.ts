import { listEnglishSets } from "../../../_entry/english-learning";
import { webContext } from "../../../_entry/web-context";

// 教材の一覧の道 GET `/api/app/english/sets`（DD-01 M11、DD-04 `listEnglishSets`）。
// 処理は `listEnglishSets` に任せる。

// DB のファイルを読むので Node.js の実行環境で動かし、要求ごとに処理する（DD-01 3章）。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request): Promise<Response> {
  const { deviceApi, english } = webContext();
  return listEnglishSets({ deviceApi, english })(request);
}
