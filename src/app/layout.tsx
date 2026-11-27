import { connection } from "next/server";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

// 端末の上の帯の色を、ページ全体の背景（globals.css の --color-hud-bg）に合わせる。
// 画面を端末の上端まで広げ、上の帯が安全な余白（safe-area-inset-top）を使えるようにする（CR-018）。
export const viewport = {
  themeColor: "#07080d",
  viewportFit: "cover",
} satisfies Viewport;

// ホーム画面に追加したときの上の帯を、暗い背景に合う黒にする。
// iPad のホーム画面のアイコン（apple-touch-icon、180px。DD-01 M01、BD-01 NFR-007）。
export const metadata = {
  appleWebApp: {
    statusBarStyle: "black",
  },
  icons: {
    apple: [
      {
        url: "/img/icon/app-icon-180_001.png",
        sizes: "180x180",
        type: "image/png",
      },
    ],
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
