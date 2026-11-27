import { RESEARCH_MESSAGES } from "../../../../screens/research/messages";
import { EmptyState } from "../../../../ui/empty-state";
import { TopBar } from "../../_frame/top-bar";
import { ResearchReportRoute as ReportRoute } from "./report-route";

// SCR-011 課題の週報の道 `/research/{contentId}`（DD-01 M01。BD-03 2章 遷移表、CR-020）。
// 読めたときの上の帯（課題名と「AI に質問」SCR-011-A07 を含む）と中身は `report-route.tsx` に任せる。
// 内容ID（`openapi.yaml` の `Id`。1 以上の整数）として読めなければ、ほかの道（`/english/{contentId}`）と
// 同じく MSG-019 を出す（BD-03 2章 URL の直接入力）。

const ID_PATTERN = /^[1-9][0-9]*$/;

export default async function ResearchReportRoute({
  params,
}: {
  params: Promise<{ contentId: string }>;
}) {
  const { contentId } = await params;
  const id = ID_PATTERN.test(contentId) ? Number(contentId) : NaN;
  return (
    <main>
      {Number.isSafeInteger(id) ? (
        <ReportRoute contentId={id} />
      ) : (
        <>
          <TopBar title="Research" />
          <EmptyState message={RESEARCH_MESSAGES["MSG-019"]} />
        </>
      )}
    </main>
  );
}
