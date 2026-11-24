"use client";
// SCR-006 AI チャットの試作（P04、P08）。応答は /api/sse が流す決まった文。AI は呼ばない。
import { useEffect, useRef, useState } from "react";
import { useSettings } from "./Settings";

export type Target = { kind: "none" | "page" | "article" | "phrase"; label: string };
type Msg = { who: "owner" | "ai"; text: string; state?: "writing" | "done" | "failed" | "cancelled" };

function useIsTablet() {
  const [t, setT] = useState(false);
  useEffect(() => {
    const f = () => setT(window.innerWidth >= 700);
    f(); window.addEventListener("resize", f); return () => window.removeEventListener("resize", f);
  }, []);
  return t;
}

export function Chat({ target, onClose }: { target: Target; onClose: () => void }) {
  const { s } = useSettings();
  const tablet = useIsTablet();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [q, setQ] = useState("");
  const [full, setFull] = useState(false);
  const es = useRef<EventSource | null>(null);
  const writing = msgs.some((m) => m.state === "writing");

  const send = () => {
    if (!q.trim() || writing) return;
    setMsgs((m) => [...m, { who: "owner", text: q }, { who: "ai", text: "", state: "writing" }]);
    setQ("");
    const src = new EventSource("/api/sse?n=12");
    es.current = src;
    src.onmessage = (e) => {
      if (e.data === "[done]") { src.close(); setMsgs((m) => m.map((x, i) => (i === m.length - 1 ? { ...x, state: "done" } : x))); return; }
      setMsgs((m) => m.map((x, i) => (i === m.length - 1 ? { ...x, text: x.text + e.data } : x)));
    };
    src.onerror = () => { src.close(); setMsgs((m) => m.map((x, i) => (i === m.length - 1 && x.state === "writing" ? { ...x, state: "failed" } : x))); };
  };
  const stop = () => { es.current?.close(); setMsgs((m) => m.map((x) => (x.state === "writing" ? { ...x, state: "cancelled" } : x))); };
  useEffect(() => () => es.current?.close(), []);

  const right = tablet && s.ipadChat === "right";
  const style = right ? {} : { height: full ? "100dvh" : "60dvh", borderRadius: full ? 0 : undefined };
  return (
    <div className={right ? "pane-right" : "sheet"} style={style} role="dialog" aria-label="AI チャット">
      {!right && <div className="handle" onClick={() => setFull(!full)} title="引き上げると全画面" />}
      <div className="topbar" style={{ position: "static" }}>
        <span className="title">AI チャット</span>
        {!right && <button onClick={() => setFull(!full)}>{full ? "小さく" : "広げる"}</button>}
        <button onClick={onClose}>閉じる</button>
      </div>
      <div style={{ padding: "6px 12px", fontSize: 13, color: "var(--amber)" }}>対象: {target.label}</div>
      <div style={{ flex: 1, overflowY: "auto", padding: 12 }}>
        {msgs.length === 0 && <div className="empty">新しい会話です。質問を書いてください（応答は試作の決まった文です）。</div>}
        {msgs.map((m, i) => (
          <div key={i} style={{ margin: "8px 0", textAlign: m.who === "owner" ? "right" : "left" }}>
            <div style={{ display: "inline-block", maxWidth: "85%", padding: "8px 10px", borderRadius: 10, background: m.who === "owner" ? "rgba(255,176,64,0.15)" : "rgba(255,255,255,0.06)", whiteSpace: "pre-wrap" }}>
              {m.text || (m.state === "writing" ? "…" : "")}
            </div>
            {m.state === "writing" && <div style={{ fontSize: 12, color: "var(--muted)" }}>作成中 <button onClick={stop}>止める</button></div>}
            {m.state === "cancelled" && <div style={{ fontSize: 12, color: "var(--muted)" }}>応答を止めました。（MSG-014）</div>}
            {m.state === "failed" && <div style={{ fontSize: 12, color: "#ff9a6b" }}>応答を作れませんでした。送り直すか、やめるかを選んでください。（MSG-012）</div>}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, padding: 10, borderTop: "1px solid var(--line)" }}>
        <textarea value={q} onChange={(e) => setQ(e.target.value.slice(0, 4000))} rows={2} style={{ flex: 1, background: "#0e1018", color: "var(--text)", border: "1px solid var(--line)", borderRadius: 8, padding: 8, fontSize: 16 }} placeholder="質問を書く" />
        <button onClick={send} disabled={!q.trim() || writing}>送る</button>
      </div>
    </div>
  );
}
