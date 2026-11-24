"use client";
// P05: 下の帯（モックにある形）を置くかを確かめる。
import Link from "next/link";
import { useSettings } from "./Settings";

export function BottomTabs() {
  const { s } = useSettings();
  if (!s.bottomTabs) return null;
  return (
    <nav className="tabs">
      <Link href="/">ホーム</Link>
      <Link href="/inbox">Inbox</Link>
      <Link href="/inbox?view=explore">Explore</Link>
      <Link href="/inbox?view=library">Library</Link>
    </nav>
  );
}
