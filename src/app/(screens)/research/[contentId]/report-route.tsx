"use client";

import { ResearchReportScreen } from "../../../../screens/research/report-screen";
import { TopBar } from "../../_frame/top-bar";

// SCR-011 課題の週報の上の帯と中身（DD-01 M01・M32）。
// 上の帯にロゴ（ホームへ戻る）、課題名（O01）、「AI に質問」（A07）を並べる（BD-03 SCR-011 3.2、4章）。
// 課題名と「AI に質問」は週報を読んだ M32 の部品が渡す。読むまでと読めなかったときは、題名を「Research」にする。
export function ResearchReportRoute({ contentId }: { contentId: number }) {
  return (
    <ResearchReportScreen
      contentId={contentId}
      topBar={({ title, action }) =>
        title === null ? (
          <TopBar title="Research" action={action} />
        ) : (
          <TopBar title={title} action={action} accent={false} />
        )
      }
    />
  );
}
