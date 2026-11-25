import {
  type DateRouteContext,
  getEnglishSetForSender,
} from "../../../_entry/english-provide";
import { webContext } from "../../../_entry/web-context";

// sharpen が英語のセットを読む道 GET `/api/learning/sets/{date}?lane=en`
// （DD-01 M11、DD-04 `getEnglishSetForSender`、IF-003）。処理は `getEnglishSetForSender` に任せる。

// DB のファイルを読むので Node.js の実行環境で動かし、要求ごとに処理する（DD-01 3章）。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(
  request: Request,
  routeContext: DateRouteContext,
): Promise<Response> {
  const { logger, senderKeys, englishForSender, clock } = webContext();
  return getEnglishSetForSender({
    logger,
    senderKeys,
    englishForSender,
    clock,
  })(request, routeContext);
}
