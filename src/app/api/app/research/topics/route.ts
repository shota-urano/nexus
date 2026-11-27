import { listResearchTopics } from "../../../_entry/research";
import { webContext } from "../../../_entry/web-context";

// 課題の一覧の道 GET `/api/app/research/topics`（DD-01 M11、DD-04 `listResearchTopics`。CR-020）。
// 処理は `listResearchTopics` に任せる。

// DB のファイルを読むので Node.js の実行環境で動かし、要求ごとに処理する（DD-01 3章）。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request): Promise<Response> {
  const { deviceApi, research } = webContext();
  return listResearchTopics({ deviceApi, research })(request);
}
