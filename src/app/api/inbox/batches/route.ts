import { postNewsBatch } from "../../_entry/news-batch";
import { webContext } from "../../_entry/web-context";

// ニュースの受け取りの道 POST `/api/inbox/batches`（DD-01 M11、DD-04 `postNewsBatch`、IF-001）。
// 処理は `postNewsBatch` に任せる。

// DB のファイルを読むので Node.js の実行環境で動かし、要求ごとに処理する（DD-01 3章）。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(request: Request): Promise<Response> {
  const { logger, senderKeys, ingest } = webContext();
  return postNewsBatch({ logger, senderKeys, ingest })(request);
}
