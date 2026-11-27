import { postResearchReport } from "../../_entry/research-report";
import { webContext } from "../../_entry/web-context";

// 週報の受け取りの道 POST `/api/research/reports`（DD-01 M11、DD-04 `postResearchReport`、IF-005。
// CR-020）。処理は `postResearchReport` に任せる。

// DB のファイルを読むので Node.js の実行環境で動かし、要求ごとに処理する（DD-01 3章）。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(request: Request): Promise<Response> {
  const { logger, senderKeys, ingest } = webContext();
  return postResearchReport({ logger, senderKeys, ingest })(request);
}
