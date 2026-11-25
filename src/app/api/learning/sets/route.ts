import { postEnglishSet } from "../../_entry/english-set";
import { webContext } from "../../_entry/web-context";

// 英語のセットの受け取りの道 POST `/api/learning/sets`（DD-01 M11、DD-04 `postEnglishSet`、IF-002）。
// 処理は `postEnglishSet` に任せる。

// DB のファイルを読むので Node.js の実行環境で動かし、要求ごとに処理する（DD-01 3章）。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(request: Request): Promise<Response> {
  const { logger, senderKeys, ingest } = webContext();
  return postEnglishSet({ logger, senderKeys, ingest })(request);
}
