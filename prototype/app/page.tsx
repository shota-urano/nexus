"use client";
// SCR-001 ホームの試作（P01、P02）。見た目は依頼の資料のモック（references/nexus-home-mock-v3-handoff.html）と参考の画像に寄せた。
// 要件に無い部品（宣伝文、検索と設定、学習連続、ワークスペース、下の帯）は入れない（2026-11-24 本人）。
// P01（2026-11-24 本人の案）: 指で HUD を回し、離すといちばん近い機能が右の真ん中に合い、その機能のカードが前に出る。セグメントを押しても回る。カードを押すと移る。
// 画像（中心の球、記事の見本の写真）は Codex（gpt-image）が作った（2026-11-24 本人の指示）。
import "./home.css";
import { motion, useReducedMotion } from "motion/react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { articles, TODAY, formatDate, imageOf } from "@/lib/data";
import { Chat } from "@/components/Chat";

const I = {
  // 32 × 32 の共通座標。ホイールとカードで同じ輪郭を使う。
  news: <><ellipse cx="16" cy="16" rx="14" ry="7" transform="rotate(-32 16 16)" opacity=".65" /><path d="m7 20 8-13 5 12 6-7" /><circle cx="7" cy="20" r="2" /><circle cx="15" cy="7" r="2" /><circle cx="20" cy="19" r="2" /><circle cx="26" cy="12" r="1.5" /></>,
  english: <><path d="M4 7c5-2 9-1 12 2 3-3 7-4 12-2v18c-5-2-9-1-12 2-3-3-7-4-12-2Z" /><path d="M16 9v18M8 18l3-7 3 7M9 16h4M21 13h3M21 17h3" /></>,
  inbox: <><path d="m4 20 3-12h18l3 12v7H4Z" /><path d="M4 20h7l2 3h6l2-3h7M12 13h8M16 10v6" /></>,
  explore: <><circle cx="16" cy="16" r="11" /><path d="m21 10-3 9-8 3 3-9Z" /><path d="M16 2v3M16 27v3M2 16h3M27 16h3" /></>,
  library: <><path d="M5 7v20h22M9 6h5v17H9ZM17 5h5v18h-5ZM25 7l4 15" /><path d="M10 11h3M18 10h3" /></>,
  chat: <><path d="M7 7h18a3 3 0 0 1 3 3v11a3 3 0 0 1-3 3H15l-7 5v-5H7a3 3 0 0 1-3-3V10a3 3 0 0 1 3-3Z" /><path d="M9 16h3l2-4 4 8 2-4h3" /></>,
};
const MODULES: { key: string; name: string; icon: ReactNode; href: string; sub: string; count?: string; color: string }[] = [
  { key: "galaxy", name: "News Galaxy", icon: I.news, href: "/galaxy", sub: "今日のニュース", count: "10件", color: "#ffb85e" },
  { key: "english", name: "English", icon: I.english, href: "/english", sub: "学習の続き・文型", color: "#8eb5fa" },
  { key: "inbox", name: "Inbox", icon: I.inbox, href: "/inbox", sub: "新着", count: "3件", color: "#ffb85e" },
  { key: "explore", name: "Explore", icon: I.explore, href: "/inbox?view=explore", sub: "言葉で探す", color: "#c3a2fb" },
  { key: "library", name: "Library", icon: I.library, href: "/inbox?view=library", sub: "保存", count: "5件", color: "#8ed2bc" },
  { key: "chat", name: "AI Chat", icon: I.chat, href: "", sub: "なんでも質問", color: "#c3a2fb" },
];
const N = MODULES.length;
const STEP = 360 / N;
// カードの置き方（モックの main / top / bottom / ghost に合わせた）
const SLOT: Record<number, { y: number; rz: number; s: number; o: number }> = {
  0: { y: -70, rz: -5, s: 1, o: 1 }, [-1]: { y: -150, rz: -8, s: 0.83, o: 0.63 }, 1: { y: 70, rz: 6, s: 0.87, o: 0.72 },
  [-2]: { y: -210, rz: -10, s: 0.7, o: 0 }, 2: { y: 140, rz: 8, s: 0.73, o: 0.25 }, 3: { y: 190, rz: 10, s: 0.6, o: 0 },
};

// スマートフォンの幅（480 ピクセル以下）では、前のカードのすぐ上と下に隣のカードを詰める（2026-11-24 本人: 上下の間隔があきすぎ）
const SLOT_NARROW: Record<number, { y: number; rz: number; s: number; o: number }> = {
  0: { y: -78, rz: -4, s: 1, o: 1 }, [-1]: { y: -128, rz: -6, s: 0.86, o: 0.6 }, 1: { y: 96, rz: 4, s: 0.88, o: 0.7 },
  [-2]: { y: -160, rz: -8, s: 0.74, o: 0 }, 2: { y: 140, rz: 6, s: 0.76, o: 0.3 }, 3: { y: 170, rz: 8, s: 0.6, o: 0 },
};
function useNarrow() {
  const [n, setN] = useState(false);
  useEffect(() => { const f = () => setN(window.innerWidth <= 480); f(); window.addEventListener("resize", f); return () => window.removeEventListener("resize", f); }, []);
  return n;
}

export default function Home() {
  const narrow = useNarrow();
  const router = useRouter();
  const reduce = useReducedMotion();
  const [sel, setSel] = useState(0);
  const [turn, setTurn] = useState(0); // 回した角度（度）。選んだセグメントを右の真ん中（0度）に置く
  const [chat, setChat] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ start: number; turn0: number; moved: boolean } | null>(null);
  const [dragging, setDragging] = useState(false);
  // 前のカードの高さを測り、下のカードをそのすぐ下に置く（カードの中身で高さが変わるため）。描いた直後に、その時点の前のカードを測る
  const [mainH, setMainH] = useState(170);
  useEffect(() => {
    const measure = () => { const el = document.querySelector<HTMLElement>(".fcard.main"); if (el) setMainH(el.offsetHeight); };
    const id = requestAnimationFrame(measure);
    window.addEventListener("resize", measure);
    return () => { cancelAnimationFrame(id); window.removeEventListener("resize", measure); };
  }, [sel, narrow]);

  const pick = (i: number) => {
    let d = -i * STEP - (turn % 360);
    d = ((((d + 540) % 360) + 360) % 360) - 180;
    setTurn(turn + d);
    setSel(i);
  };
  const angleAt = (e: React.PointerEvent) => {
    const r = svgRef.current!.getBoundingClientRect();
    return (Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)) * 180) / Math.PI;
  };
  const onDown = (e: React.PointerEvent) => { drag.current = { start: angleAt(e), turn0: turn, moved: false }; };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current; if (!d) return;
    let delta = angleAt(e) - d.start; delta = ((delta + 540) % 360) - 180;
    if (!d.moved && Math.abs(delta) > 4) { d.moved = true; setDragging(true); (e.target as Element).setPointerCapture?.(e.pointerId); }
    if (d.moved) { const t = d.turn0 + delta; setTurn(t); setSel((((Math.round(-t / STEP) % N) + N) % N)); }
  };
  const onUp = () => {
    const d = drag.current; drag.current = null;
    if (!d || !d.moved) return;
    setDragging(false);
    setTurn((t) => Math.round(t / STEP) * STEP);
  };
  const go = (i: number) => {
    const m = MODULES[i];
    if (m.key === "chat") { setChat(true); return; }
    router.push(m.href);
  };

  const R = 100;
  const picks = articles.filter((a) => a.date === TODAY).slice(0, 3);
  const dur = reduce || dragging ? 0 : 0.45;

  return (
    <>
      <div className="bg-stars"><img className="planet" src="/img/planet_001.png" alt="" /></div>
      <main className="home">
        <header className="brand">
          <img src="/img/logo.png" alt="" />
          <div><h1>NEXUS</h1><span>{formatDate(TODAY)}</span></div>
        </header>

        <section className="hero">
          <div className="wheel">
            <svg ref={svgRef} viewBox="-135 -135 270 270" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
              <defs>
                <radialGradient id="segFill" cx="0" cy="0" r="130" gradientUnits="userSpaceOnUse"><stop offset="40%" stopColor="#2b303b" /><stop offset="100%" stopColor="#1a1f29" /></radialGradient>
                <radialGradient id="goldFill" cx="0" cy="0" r="130" gradientUnits="userSpaceOnUse"><stop offset="40%" stopColor="#6b4520" /><stop offset="100%" stopColor="#c27a35" /></radialGradient>
                <filter id="glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="4" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
                <clipPath id="coreClip"><circle r="56" /></clipPath>
              </defs>
              <circle r="131" fill="none" stroke="rgba(255,176,64,0.28)" strokeDasharray="1 5" />
              <motion.g initial={false} animate={{ rotate: turn }} transition={{ duration: dur, ease: "easeInOut" }} style={{ transformBox: "fill-box", originX: 0.5, originY: 0.5 }}>
                {MODULES.map((m, i) => {
                  const c = (i * STEP * Math.PI) / 180;
                  const half = (STEP / 2) * (Math.PI / 180);
                  const a0 = c - half + 0.03, a1 = c + half - 0.03;
                  const p = (r: number, a: number) => `${r * Math.cos(a)} ${r * Math.sin(a)}`;
                  const d = `M ${p(R + 22, a0)} A ${R + 22} ${R + 22} 0 0 1 ${p(R + 22, a1)} L ${p(R - 42, a1)} A ${R - 42} ${R - 42} 0 0 0 ${p(R - 42, a0)} Z`;
                  const on = sel === i;
                  const lx = (R - 10) * Math.cos(c), ly = (R - 10) * Math.sin(c);
                  return (
                    <g key={m.key} className={`seg${on ? " on" : ""}`} onClick={() => { if (!dragging) pick(i); }} style={{ cursor: "pointer" }} role="button" aria-label={m.name}>
                      <path className="sector" d={d} />
                      <motion.g initial={false} animate={{ rotate: -turn }} transition={{ duration: dur, ease: "easeInOut" }} style={{ transformBox: "fill-box", originX: 0.5, originY: 0.5 }}>
                        <g transform={`translate(${lx - 12} ${ly - 25}) scale(0.75)`} className="seg-icon" color={on ? "#ffd08a" : m.color} aria-hidden="true">{m.icon}</g>
                        <text className="seg-label" x={lx} y={ly + 10}>{m.name}</text>
                      </motion.g>
                    </g>
                  );
                })}
              </motion.g>
              <g onClick={() => setChat(true)} style={{ cursor: "pointer" }} role="button" aria-label="AI に質問">
                <circle r="56" fill="#07090e" stroke="rgba(255,190,110,0.35)" />
                <image className="core-img" href="/img/core_orb_001.png" x="-88" y="-88" width="176" height="176" clipPath="url(#coreClip)" />
              </g>
            </svg>
          </div>

          <div className="stack">
            {MODULES.map((m, i) => {
              let off = i - sel;
              if (off > N / 2) off -= N;
              if (off <= -N / 2) off += N;
              const table = narrow ? SLOT_NARROW : SLOT;
              const base = table[off] ?? table[3];
              const slot = narrow && off > 0 ? { ...base, y: table[0].y + mainH + 6 + (off - 1) * 44 } : base;
              const front = off === 0;
              return (
                <motion.div key={m.key} className={`fcard${front ? " main" : ""}`} onClick={() => (front ? go(i) : pick(i))} initial={false}
                  animate={{ y: slot.y, rotateZ: slot.rz, rotateY: -8, scale: slot.s, opacity: slot.o }}
                  transition={{ duration: reduce ? 0 : 0.5, ease: [0.19, 1, 0.22, 1] }}
                  style={{ zIndex: 10 - Math.abs(off), transformOrigin: "top right", pointerEvents: slot.o === 0 ? "none" : "auto" }}>
                  {front ? (
                    <div className="fmain">
                      <div className="frow">
                        <div className="ficon" style={{ color: m.color }}><svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">{m.icon}</svg></div>
                        <div className="ftitle wide">{m.name}</div>
                        <span style={{ opacity: 0.6, fontSize: 20, marginLeft: "auto" }}>›</span>
                      </div>
                      <div className="ftitle narrow">{m.name}</div>
                      <div className="fsub">{m.sub} {m.count && <b>{m.count}</b>}</div>
                    </div>
                  ) : (
                    <div className="frow">
                      <div className="ficon" style={{ color: m.color }}><svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">{m.icon}</svg></div>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div className="ftitle">{m.name}</div>
                        <div className="fsub">{m.sub} {m.count && <b>{m.count}</b>}</div>
                      </div>
                      <span style={{ opacity: 0.6, fontSize: 20 }}>›</span>
                    </div>
                  )}
                  {front && m.key === "galaxy" && (
                    <div style={{ display: "flex", gap: 6, marginTop: 8, width: "100%" }}>
                      {picks.map((a) => <img key={a.id} src={imageOf(a)} alt="" style={{ width: "32%", aspectRatio: "16/10", objectFit: "cover", borderRadius: 7, border: "1px solid #fff3" }} />)}
                    </div>
                  )}
                  {front && m.key === "english" && <div style={{ fontSize: 11, color: "#ff9a6b", marginTop: 6 }}>今朝の英語の教材がまだ届いていません。（MSG-016 の見本）</div>}
                </motion.div>
              );
            })}
          </div>
          <div className="hint">指で回して選び、カードを押して開く</div>
        </section>

        <section className="status">
          <div className="stat"><div className="stat-top">未読</div><div className="stat-value">18<span className="stat-unit">件</span></div></div>
          <div className="stat"><div className="stat-top">新着</div><div className="stat-value">12<span className="stat-unit">件</span></div></div>
          <div className="stat"><div className="stat-top">学習の続き</div><div className="stat-value" style={{ fontSize: 15, marginTop: 10 }}>文型</div></div>
          <div className="stat"><div className="stat-top">AI の応答中</div><div className="stat-value">0<span className="stat-unit">件</span></div></div>
        </section>

        <button className="ask" onClick={() => setChat(true)}><span className="ask-label"><svg className="ask-icon" viewBox="0 0 32 32" aria-hidden="true" focusable="false">{I.chat}</svg>AI に質問</span><span style={{ color: "#ffcf87" }}>→</span></button>

        <section className="pickup">
          <div style={{ fontWeight: 700, fontSize: 16 }}>今日のピックアップ</div>
          {picks.map((a) => (
            <div key={a.id} className="pickup-card" onClick={() => router.push("/galaxy")}>
              <img src={imageOf(a)} alt="" />
              <div style={{ minWidth: 0 }}><span className="ptag">{a.theme}</span><h3>{a.title}</h3></div>
            </div>
          ))}
        </section>
      </main>
      {chat && <Chat target={{ kind: "none", label: "対象なし（ホーム）" }} onClose={() => setChat(false)} />}
    </>
  );
}
