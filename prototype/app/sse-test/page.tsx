"use client";
// P08: Tailscale を通して、応答の文字が少しずつ届くかを見る。AI は呼ばない。
import Link from "next/link";
import { useState } from "react";

export default function SseTest() {
  const [text, setText] = useState("");
  const [state, setState] = useState<"idle" | "run" | "ok" | "ng">("idle");
  const start = () => {
    setText(""); setState("run");
    let last = performance.now(); let bunched = 0; let count = 0;
    const es = new EventSource("/api/sse?n=10");
    es.onmessage = (e) => {
      if (e.data === "[done]") { es.close(); setState(bunched > 2 ? "ng" : "ok"); return; }
      const now = performance.now(); if (count > 0 && now - last < 300) bunched++; last = now; count++;
      setText((t) => t + e.data);
    };
    es.onerror = () => { es.close(); setState("ng"); };
  };
  return (
    <main>
      <div className="topbar"><Link href="/">ホーム</Link><span className="title">P08 応答の届き方</span></div>
      <div style={{ padding: 16 }}>
        <p>「始める」を押してください。下の枠に、文字が<b>1秒に1語ずつ</b>増えていけば合格です。10秒たってから一度にまとめて出たら、途中で止められています。</p>
        <button onClick={start} disabled={state === "run"} style={{ fontSize: 18 }}>始める</button>
        <div style={{ marginTop: 16, minHeight: 120, border: "1px solid var(--line)", borderRadius: 12, padding: 14, fontSize: 22, lineHeight: 1.6 }}>{text || "（ここに文字が出ます）"}</div>
        {state === "ok" && <p style={{ color: "#8be38b", fontSize: 18 }}>少しずつ届きました（合格）。</p>}
        {state === "ng" && <p style={{ color: "#ff9a6b", fontSize: 18 }}>まとめて届いたか、つながりが切れました。</p>}
      </div>
    </main>
  );
}
