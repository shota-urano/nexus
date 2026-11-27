import { ResearchReportScreen } from "../../../../screens/research/report-screen";
import { RESEARCH_MESSAGES } from "../../../../screens/research/messages";
import { EmptyState } from "../../../../ui/empty-state";
import { TopBar } from "../../_frame/top-bar";

// SCR-011 課題の週報の道 `/research/{contentId}`（DD-01 M01。BD-03 2章 遷移表、CR-020）。
// 中身は M32 に任せる。「AI に質問」（SCR-011-A07）は M32 の週報の部品が持つので、上の帯には置かない。
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
      <TopBar title="Research" />
      {Number.isSafeInteger(id) ? (
        <ResearchReportScreen contentId={id} />
      ) : (
        <EmptyState message={RESEARCH_MESSAGES["MSG-019"]} />
      )}
    </main>
  );
}
