import {
  type ApproachSeenRouteContext,
  markApproachSeen,
} from "../../../../../../../_entry/research";
import { webContext } from "../../../../../../../_entry/web-context";

// 方法を確かめた日時を残す道 POST `/api/app/research/reports/{contentId}/approaches/{no}/seen`
// （DD-01 M11、DD-04 `markApproachSeen`。CR-024）。処理は `markApproachSeen` に任せる。

// DB のファイルを読むので Node.js の実行環境で動かし、要求ごとに処理する（DD-01 3章）。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(
  request: Request,
  routeContext: ApproachSeenRouteContext,
): Promise<Response> {
  const { deviceApi, research } = webContext();
  return markApproachSeen({ deviceApi, research })(request, routeContext);
}
