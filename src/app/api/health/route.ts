import { getHealth } from "../_entry/health";
import { webContext } from "../_entry/web-context";

// 状態を返す API の道 GET `/api/health`（DD-01 M11、DD-04 `getHealth`）。
// 鍵を求めない（CR-011）。処理は `getHealth` に任せる。

// DB のファイルを読むので Node.js の実行環境で動かし、要求ごとに処理する（DD-01 3章）。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(): Response {
  const { logger, aiJobs } = webContext();
  return getHealth({ logger, queue: aiJobs.queue })();
}
