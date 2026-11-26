import { connection } from "next/server";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

// 端末の上の帯の色を、ページ全体の背景（globals.css の --color-hud-bg）に合わせる。
export const viewport = {
  themeColor: "#07080d",
} satisfies Viewport;

// ホーム画面に追加したときの上の帯を、暗い背景に合う黒にする。
export const metadata = {
  appleWebApp: {
    statusBarStyle: "black",
  },
} satisfies Metadata;

// 画面は要求ごとに描く。Next.js は要求ごとの nonce（DD-09 2.4。src/proxy.ts）を、
// 描くときに画面のスクリプトに付けるため、前もって作った画面を使わない。
export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  await connection();
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
