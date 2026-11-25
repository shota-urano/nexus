import { LibraryScreen } from "../../../screens/lists/library-screen";
import { TopBar } from "../_frame/top-bar";

// SCR-009 Library の道 `/library`（DD-01 M01）。中身は M05 に任せる。
export default function LibraryRoute() {
  return (
    <main>
      <TopBar title="Library" />
      <LibraryScreen />
    </main>
  );
}
