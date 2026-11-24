"use client";
// SCR-007 Inbox、SCR-008 Explore、SCR-009 Library の試作（P06）。本人の指摘（2026-11-24）: 時刻は出さず日付だけ、新着はタグにする。一覧の画面には AI の入口を置かない（CR-003）。
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { articles, formatDate } from "@/lib/data";

function Body() {
  const view = useSearchParams().get("view") ?? "inbox";
  const [q, setQ] = useState("");
  const [term, setTerm] = useState("");
  const title = view === "explore" ? "Explore" : view === "library" ? "Library" : "Inbox";
  let rows = [
    { id: "e1", kind: "english" as const, title: "英語: 文型（第3〜5文型・There ＋ be 動詞）", date: "2026-11-24", time: "05:30", isNew: true },
    ...articles.map((a, i) => ({ id: a.id, kind: "news" as const, title: a.title, date: a.date, time: "05:00", isNew: i < 6 })),
  ];
  if (view === "library") rows = rows.slice(0, 2);
  if (view === "explore") rows = term ? rows.filter((r) => term.split(/\s+/).every((w) => r.title.toLowerCase().includes(w.toLowerCase()))) : [];
  return (
    <main style={{ paddingBottom: 80 }}>
      <div className="topbar"><Link href="/">ホーム</Link><span className="title">{title}</span></div>
      {view === "explore" && (
        <div style={{ display: "flex", gap: 8, padding: 10 }}>
          <input value={q} onChange={(e) => setQ(e.target.value.slice(0, 200))} placeholder="検索の言葉（空白で区切ると全てを含む）" style={{ flex: 1, fontSize: 16, minHeight: 44 }} />
          <button disabled={!q.trim()} onClick={() => setTerm(q.trim())}>探す</button>
        </div>
      )}
      {rows.length === 0 && term && <div className="empty">「{term}」に当たる内容はありません。（MSG-009）</div>}
      {rows.map((r) => (
        <Link key={r.id} href={r.kind === "english" ? "/english" : "/galaxy"} className="list-row" style={{ textDecoration: "none", color: "inherit" }}>
          <span style={{ flex: 1, fontSize: 14 }}>
            <span className={`kind ${r.kind}`}>{r.kind === "english" ? "英語" : "ニュース"}</span>{" "}
            {view === "inbox" && r.isNew && <span className="tag new">新着</span>}
            <br />{r.title}
          </span>
          <span style={{ fontSize: 12, color: "var(--muted)", textAlign: "right", whiteSpace: "nowrap" }}>{formatDate(r.date)}</span>
        </Link>
      ))}
    </main>
  );
}
export default function Page() { return <Suspense><Body /></Suspense>; }
