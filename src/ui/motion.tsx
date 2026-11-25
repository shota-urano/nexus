"use client";

import { MotionConfig, useReducedMotionConfig } from "motion/react";
import type { ReactNode } from "react";

// 動きを減らす設定（RD-11 NFR-008、BD-09 5章 アクセシビリティ、DD-01 M07）。
// 端末の設定をここの1か所で読み、Motion の設定に渡して全ての動きに当てる（DD-01 3章 Motion）。
// 画面の枠（M01）がこの部品で全ての画面を包む。

export function MotionSettings({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}

// 動きを減らすかどうか（MotionSettings の設定に従う）。動かさずに切り替える部品
// （HUD の回転、カードの移動、図の動き。BD-09 5章）は、これを見て動きを使わない。
export function useReduceMotion(): boolean {
  return useReducedMotionConfig() ?? false;
}
