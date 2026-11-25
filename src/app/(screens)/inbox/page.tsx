import { InboxScreen } from "../../../screens/lists/inbox-screen";
import { TopBar } from "../_frame/top-bar";

// SCR-007 Inbox の道 `/inbox`（DD-01 M01）。中身は M05 に任せる。
export default function InboxRoute() {
  return (
    <main>
      <TopBar title="Inbox" />
      <InboxScreen />
    </main>
  );
}
