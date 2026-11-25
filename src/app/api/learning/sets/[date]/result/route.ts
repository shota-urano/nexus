import {
  type DateRouteContext,
  getEnglishResult,
} from "../../../../_entry/english-provide";
import { webContext } from "../../../../_entry/web-context";

// sharpen が英語の答えを読む道 GET `/api/learning/sets/{date}/result?lane=en`
// （DD-01 M11、DD-04 `getEnglishResult`、IF-003）。処理は `getEnglishResult` に任せる。

// DB のファイルを読むので Node.js の実行環境で動かし、要求ごとに処理する（DD-01 3章）。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(
  request: Request,
  routeContext: DateRouteContext,
): Promise<Response> {
  const { logger, senderKeys, englishForSender, clock } = webContext();
  return getEnglishResult({ logger, senderKeys, englishForSender, clock })(
    request,
    routeContext,
  );
}
