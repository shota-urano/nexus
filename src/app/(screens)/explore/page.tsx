import { ExploreScreen } from "../../../screens/lists/explore-screen";
import { TopBar } from "../_frame/top-bar";

// SCR-008 Explore の道 `/explore`（DD-01 M01）。中身は M05 に任せる。
export default function ExploreRoute() {
  return (
    <main>
      <TopBar title="Explore" />
      <ExploreScreen />
    </main>
  );
}
