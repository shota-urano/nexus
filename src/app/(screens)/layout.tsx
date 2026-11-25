import type { ReactNode } from "react";
import { AppFrame } from "./_frame/app-frame";

// 画面の道の共通の layout（DD-01 M01）。全ての画面を共通の枠で包む。
export default function ScreensLayout({ children }: { children: ReactNode }) {
  return <AppFrame>{children}</AppFrame>;
}
