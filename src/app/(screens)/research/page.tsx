import { ResearchTopicsScreen } from "../../../screens/research/topics-screen";
import { TopBar } from "../_frame/top-bar";

// SCR-010 課題の一覧の道 `/research`（DD-01 M01。BD-03 2章 遷移表、CR-020）。中身は M32 に任せる。
export default function ResearchTopicsRoute() {
  return (
    <main>
      <TopBar title="Research" />
      <ResearchTopicsScreen />
    </main>
  );
}
