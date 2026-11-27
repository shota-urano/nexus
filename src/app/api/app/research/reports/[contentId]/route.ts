import {
  type ResearchReportRouteContext,
  getResearchReport,
} from "../../../../_entry/research";
import { webContext } from "../../../../_entry/web-context";

// 週報の道 GET `/api/app/research/reports/{contentId}`（DD-01 M11、DD-04 `getResearchReport`。CR-020）。
// 処理は `getResearchReport` に任せる。

// DB のファイルを読むので Node.js の実行環境で動かし、要求ごとに処理する（DD-01 3章）。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(
  request: Request,
  routeContext: ResearchReportRouteContext,
): Promise<Response> {
  const { deviceApi, research } = webContext();
  return getResearchReport({ deviceApi, research })(request, routeContext);
}
