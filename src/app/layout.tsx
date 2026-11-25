import { connection } from "next/server";
import type { ReactNode } from "react";
import "./globals.css";

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
