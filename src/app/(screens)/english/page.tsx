import { EnglishListScreen } from "../../../screens/english/english-list-screen";
import { TopBar } from "../_frame/top-bar";

// SCR-004 英語の教材の一覧の道 `/english`（DD-01 M01）。中身は M04 に任せる。
export default function EnglishListRoute() {
  return (
    <main>
      <TopBar title="English" />
      <EnglishListScreen />
    </main>
  );
}
