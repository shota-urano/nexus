import type { Home } from "../../src/contracts/home";

// ホームの応答（`docs/api/openapi.yaml` の `Home`）は `research`（必須）を持つ（11-home。CR-020、CR-021）。
// 画面の型 M10（src/contracts/home.ts）に `research` が足される前でも後でも、テストの値を同じ形で書けるようにする。
export type HomeWithResearch = Omit<Home, "research"> & {
  research: { unreadCount: number };
};
