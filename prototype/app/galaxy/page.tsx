"use client";
// SCR-002 News Galaxy と SCR-003 記事の案内の試作（P03）。図の部品を SVG と Motion か、React Flow かで切り替える。
import Link from "next/link";
import { useMemo, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ReactFlow, Background, type Node, type Edge } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useSettings } from "@/components/Settings";
import { articles, byId, relationsOf, relations, TODAY, formatDate, imageOf } from "@/lib/data";
import { Chat } from "@/components/Chat";

type Pos = Record<string, { x: number; y: number }>;

function layout(center: string | null, visible: string[]): Pos {
  const pos: Pos = {};
  const today = visible.filter((id) => byId(id)!.date === TODAY);
  const past = visible.filter((id) => byId(id)!.date !== TODAY);
  if (!center) {
    today.forEach((id, i) => { const a = (i / today.length) * Math.PI * 2; pos[id] = { x: 150 * Math.cos(a), y: 150 * Math.sin(a) }; });
    past.forEach((id, i) => { pos[id] = { x: -140 + i * 90, y: 230 }; });
    return pos;
  }
  pos[center] = { x: 0, y: 0 };
  const near = relationsOf(center).map((r) => (r.from === center ? r.to : r.from)).filter((id) => visible.includes(id));
  near.forEach((id, i) => { const a = (i / Math.max(near.length, 1)) * Math.PI * 2 - Math.PI / 2; pos[id] = { x: 120 * Math.cos(a), y: 120 * Math.sin(a) }; });
  const rest = visible.filter((id) => id !== center && !near.includes(id));
  rest.forEach((id, i) => { const a = (i / Math.max(rest.length, 1)) * Math.PI * 2; pos[id] = { x: 230 * Math.cos(a), y: 230 * Math.sin(a) }; });
  return pos;
}

export default function Galaxy() {
  const { s } = useSettings();
  const reduce = useReducedMotion();
  const [center, setCenter] = useState<string | null>(null);
  const [theme, setTheme] = useState("すべて");
  const [chat, setChat] = useState(false);
  const [loadedPast, setLoadedPast] = useState<string[]>([]);

  const todays = articles.filter((a) => a.date === TODAY && (theme === "すべて" || a.theme === theme)).map((a) => a.id);
  const pastLinked = relations.filter((r) => todays.includes(r.from) || todays.includes(r.to)).flatMap((r) => [r.from, r.to]).filter((id) => byId(id)!.date !== TODAY);
  const visible = Array.from(new Set([...todays, ...pastLinked, ...loadedPast]));
  const pos = useMemo(() => layout(center, visible), [center, visible.join(",")]);
  const edges = relations.filter((r) => visible.includes(r.from) && visible.includes(r.to));

  const select = (id: string) => {
    setCenter(id);
    const more = relationsOf(id).flatMap((r) => [r.from, r.to]).filter((x) => byId(x)!.date !== TODAY);
    setLoadedPast((p) => Array.from(new Set([...p, ...more]))); // 過去の記事は要るときに読み込む（RD-03 R04）
  };
  const art = center ? byId(center)! : null;

  return (
    <main style={{ height: "100dvh", display: "flex", flexDirection: "column" }}>
      <div className="topbar">
        <Link href="/">ホーム</Link>
        <span className="title">News Galaxy</span>
        <span style={{ fontSize: 13 }}>{formatDate(TODAY)}</span>
        {art && <button onClick={() => setChat(true)}>AI</button>}
      </div>
      <div style={{ padding: "6px 12px", display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
        テーマ <select value={theme} onChange={(e) => { setTheme(e.target.value); setCenter(null); }}>
          {["すべて", "AI", "開発", "経済", "科学", "デザイン"].map((t) => <option key={t}>{t}</option>)}
        </select>
        <span style={{ color: "var(--muted)" }}>図の部品: {s.graph === "svg" ? "SVG と Motion" : "React Flow"}</span>
      </div>
      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
        {s.graph === "svg" ? (
          <svg viewBox="-280 -280 560 560" style={{ width: "100%", height: "100%" }}>
            {edges.map((r, i) => {
              const a = pos[r.from], b = pos[r.to];
              if (!a || !b) return null;
              const on = center && (r.from === center || r.to === center);
              return (
                <g key={i}>
                  <motion.line animate={{ x1: a.x, y1: a.y, x2: b.x, y2: b.y }} transition={{ duration: reduce ? 0 : 0.6 }}
                    stroke={on ? "#ffb040" : "rgba(255,176,64,0.3)"} strokeWidth={on ? 1.5 : 0.8} />
                  {on && <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2} fill="#ffb040" fontSize="9" textAnchor="middle">{r.type}</text>}
                </g>
              );
            })}
            {visible.map((id) => {
              const a = byId(id)!, p = pos[id];
              if (!p) return null;
              const on = id === center;
              return (
                <motion.g key={id} animate={{ x: p.x, y: p.y }} transition={{ duration: reduce ? 0 : 0.6 }} onClick={() => select(id)} style={{ cursor: "pointer" }}>
                  <circle r={on ? 26 : 18} fill={`hsl(${a.hue} 60% 30%)`} stroke={on ? "#ffb040" : "rgba(255,255,255,0.3)"} />
                  <text y={on ? 40 : 30} fill="#f1ece4" fontSize="8" textAnchor="middle">{a.title.slice(5, 16)}</text>
                  {a.date !== TODAY && <text y={on ? 50 : 40} fill="#a8a196" fontSize="7" textAnchor="middle">{formatDate(a.date)}</text>}
                </motion.g>
              );
            })}
          </svg>
        ) : (
          <ReactFlow
            nodes={visible.filter((id) => pos[id]).map<Node>((id) => {
              const a = byId(id)!;
              return { id, position: { x: pos[id].x * 1.6, y: pos[id].y * 1.6 },
                data: { label: <div><img src={imageOf(a)} alt="" style={{ width: "100%", aspectRatio: "16/10", objectFit: "cover", borderRadius: 6, display: "block" }} /><div style={{ marginTop: 4 }}>{a.title.slice(5, 18)}</div></div> },
                style: { background: "#141923", color: "#f1ece4", border: id === center ? "2px solid #ffb040" : "1px solid rgba(255,176,64,0.25)", boxShadow: id === center ? "0 0 18px #ffb04066" : "none", borderRadius: 10, padding: 5, fontSize: 10, width: 110 } };
            })}
            edges={edges.map<Edge>((r, i) => ({ id: `e${i}`, source: r.from, target: r.to, label: center && (r.from === center || r.to === center) ? r.type : undefined,
              style: { stroke: "#ffb040" }, labelStyle: { fill: "#ffb040", fontSize: 10 }, labelBgStyle: { fill: "#07080d" } }))}
            onNodeClick={(_, n) => select(n.id)} fitView proOptions={{ hideAttribution: true }} colorMode="dark">
            <Background color="#222" />
          </ReactFlow>
        )}
      </div>
      {art && !chat && (
        <div className="sheet" style={{ maxHeight: "55dvh", overflowY: "auto" }}>
          <div className="handle" />
          <div style={{ padding: "0 14px 16px" }}>
            <img src={imageOf(art)} alt="" style={{ width: "100%", height: 120, objectFit: "cover", borderRadius: 10 }} />
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>{art.theme} ・ {formatDate(art.date)} 05:00</div>
            <h3 style={{ margin: "6px 0" }}>{art.title}</h3>
            <p style={{ whiteSpace: "pre-wrap", fontSize: 14 }}>{art.guide}</p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button>読んだ</button><button>保存</button><button onClick={() => setChat(true)}>AI に質問</button>
            </div>
            <h4>関係のある記事</h4>
            {relationsOf(art.id).map((r, i) => {
              const other = byId(r.from === art.id ? r.to : r.from)!;
              return <div key={i} className="list-row" onClick={() => select(other.id)} style={{ cursor: "pointer" }}>
                <span className="kind news">{r.type}</span><span style={{ flex: 1, fontSize: 13 }}>{other.title}<br /><span style={{ color: "var(--muted)", fontSize: 12 }}>{r.reason}</span></span>
              </div>;
            })}
          </div>
        </div>
      )}
      {chat && art && <Chat target={{ kind: "article", label: `記事「${art.title.slice(0, 20)}…」` }} onClose={() => setChat(false)} />}
    </main>
  );
}
