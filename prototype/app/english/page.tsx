"use client";
// SCR-005 英語の学習の試作（P06、P07）。sharpen の 2026-11-19 のセットの写しを使う（本人の許し 2026-11-24）。
// P06（本人の指摘）: 教材の本文（lessonMd）を、表を含めて整えて見せる。HTML として埋め込まず、Markdown を決めた書式だけで描く（NFR-018）。
// P07（本人の指摘）: 文を押すと和訳を出す。注を種類ごとに色分けし、熟語（phrase）をヒントとして目立たせる。今の read.html と同じ見せ方。
import Link from "next/link";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import set from "@/data/english-set.json";
import read from "@/data/english-read.json";
import { Chat } from "@/components/Chat";
import { formatDate } from "@/lib/data";

type Note = { text: string; kind: string; ja: string };
type Sent = { en: string; ja: string; notes: Note[] };
const KIND_NAME: Record<string, string> = { today: "今日の規則", word: "単語", phrase: "熟語", grammar: "文法" };

// 読む教材が届いているときは、教材の本文の「## 読む」で始まる節を出さない。
// sharpen は読む教材を出せない cerebellum のために本文にも同じ英文を入れているので、2回出さないため（2026-11-24 本人の指摘）。
function lessonWithoutReading(md: string) {
  const lines = md.split("\n");
  const out: string[] = [];
  let skip = false;
  for (const l of lines) {
    if (/^## /.test(l)) skip = /^## 読む/.test(l);
    if (!skip) out.push(l);
  }
  return out.join("\n");
}

// Markdown を描く。生の HTML は描かない（react-markdown の既定。NFR-018）。リンクは端末のブラウザで開く。
function Md({ text }: { text: string }) {
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> }}>
        {text}
      </ReactMarkdown>
    </div>
  );
}

function Sentence({ s, id, on, onSentence, onNote }: { s: Sent; id: string; on: boolean; onSentence: () => void; onNote: (n: Note, el: HTMLElement) => void }) {
  let parts: (string | Note)[] = [s.en];
  for (const n of s.notes) {
    parts = parts.flatMap((p) => {
      if (typeof p !== "string") return [p];
      const i = p.indexOf(n.text);
      return i < 0 ? [p] : [p.slice(0, i), n, p.slice(i + n.text.length)];
    });
  }
  return (
    <span id={id} className={`sent${on ? " on" : ""}`} onClick={onSentence}>
      {parts.map((p, i) => typeof p === "string" ? p : (
        <span key={i} className={`n-${p.kind}`} onClick={(e) => { e.stopPropagation(); onNote(p, e.currentTarget); }}>{p.text}</span>
      ))}{" "}
    </span>
  );
}

export default function English() {
  const [stage, setStage] = useState<1 | 2 | 3>(1);
  const [note, setNote] = useState<{ n: Note; top: number; left: number } | null>(null);
  const [ja, setJa] = useState<{ id: string; text: string } | null>(null);
  const [plain, setPlain] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [toast, setToast] = useState(false);
  const [chat, setChat] = useState(false);

  const onNote = (n: Note, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    setJa(null);
    setNote({ n, top: r.bottom + window.scrollY + 6, left: Math.max(8, Math.min(r.left, window.innerWidth - 330)) });
  };

  return (
    <main style={{ paddingBottom: "45vh" }}>
      <div className="topbar"><Link href="/">ホーム</Link><span className="title">{set.theme}</span><button onClick={() => setChat(true)}>AI</button></div>
      <div style={{ display: "flex", gap: 6, padding: 10, fontSize: 13 }}>
        {["① 教材", "② 問題", "③ 採点"].map((t, i) => <span key={t} style={{ padding: "4px 8px", borderRadius: 8, border: "1px solid var(--line)", background: stage === i + 1 ? "rgba(255,176,64,0.2)" : "none" }}>{t}</span>)}
        <span style={{ marginLeft: "auto", color: "var(--muted)" }}>{formatDate(set.date)}</span>
      </div>

      {stage === 1 && (
        <section style={{ padding: "0 16px", lineHeight: 1.8, maxWidth: 720, margin: "0 auto" }}>
          <Md text={read ? lessonWithoutReading(set.lessonMd) : set.lessonMd} />
          <hr style={{ borderColor: "var(--line)", margin: "20px 0" }} />
          <div style={{ fontSize: 13, color: "var(--muted)" }}>読む（{read.format}）</div>
          <h3 style={{ margin: "4px 0 10px" }}>{read.title}</h3>
          <div style={{ border: "1px solid var(--line)", borderRadius: 10, padding: "8px 12px", fontSize: 14, marginBottom: 10 }}><b style={{ fontSize: 12, color: "var(--muted)" }}>場面</b><br />{read.scene}</div>
          <p style={{ fontSize: 13, color: "var(--muted)" }}>色の付いた語を押すと意味が出ます。文のそれ以外の所を押すと、その文の和訳が出ます。</p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", fontSize: 13, marginBottom: 12 }}>
            {Object.entries(KIND_NAME).map(([k, v]) => <span key={k} className={`n-${k}`} style={{ cursor: "default" }}>{v}</span>)}
            <label style={{ marginLeft: "auto" }}><input type="checkbox" checked={plain} onChange={(e) => setPlain(e.target.checked)} /> 印を隠す</label>
          </div>
          <div className={plain ? "plain" : ""} style={{ fontSize: 17 }}>
            {(read.paragraphs as { sentences: Sent[] }[]).map((p, i) => (
              <p key={i}>{p.sentences.map((s, j) => {
                const id = `s${i}-${j}`;
                return <Sentence key={j} s={s} id={id} on={ja?.id === id} onNote={onNote} onSentence={() => { setNote(null); setJa(ja?.id === id ? null : { id, text: s.ja }); }} />;
              })}</p>
            ))}
          </div>
          <details style={{ fontSize: 14, color: "var(--muted)" }}><summary>あらまし</summary>{read.summary}</details>
          <button style={{ marginTop: 16 }} onClick={() => setStage(2)}>問題へ</button>
        </section>
      )}
      {stage === 2 && (
        <section style={{ padding: "0 16px" }}>
          {set.problems.slice(0, 3).map((p) => <div key={p.no} style={{ borderBottom: "1px solid var(--line)", padding: "8px 0" }}><Md text={p.questionMd} /><input style={{ width: "100%", fontSize: 16, minHeight: 44 }} placeholder="答え" /></div>)}
          <p style={{ color: "var(--muted)" }}>（試作では3問だけ出す）</p>
          <button onClick={() => setStage(1)}>教材へ戻る</button> <button onClick={() => setStage(3)}>採点へ</button>
        </section>
      )}
      {stage === 3 && (
        <section style={{ padding: "0 16px" }}>
          {set.problems.slice(0, 3).map((p) => <div key={p.no} style={{ borderBottom: "1px solid var(--line)", padding: "8px 0" }}><Md text={p.answerMd} /><button>○</button> <button>△</button> <button>×</button></div>)}
          <Md text={set.closingMd ?? ""} />
          <button onClick={() => setStage(2)}>問題へ戻る</button> <button onClick={() => setConfirm(true)}>完了</button> <button onClick={() => setToast(true)}>失敗の知らせの見本</button>
        </section>
      )}

      {note && <div className="popover" style={{ top: note.top, left: note.left }}><b className={`n-${note.n.kind}`} style={{ cursor: "default" }}>{KIND_NAME[note.n.kind] ?? note.n.kind}</b><br />{note.n.ja}</div>}
      {ja && <div className="ja-sheet"><div style={{ fontSize: 12, color: "var(--muted)" }}>和訳</div>{ja.text}<div style={{ textAlign: "right" }}><button onClick={() => setJa(null)}>閉じる</button></div></div>}
      {confirm && (
        <div className="dialog-back"><div className="dialog">
          <p>前の答えを、今回の答えで置き換えます。置き換えますか。（MSG-006）</p>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}><button onClick={() => setConfirm(false)}>やめる</button><button onClick={() => setConfirm(false)}>置き換える</button></div>
        </div></div>
      )}
      {toast && <div className="toast"><span style={{ flex: 1 }}>答えを残せませんでした。答えはこの画面に残っています。もう一度「完了」を押してください。（MSG-007）</span><button onClick={() => setToast(false)}>閉じる</button></div>}
      {chat && <Chat target={{ kind: note ? "phrase" : "page", label: note ? `語句「${note.n.text}」` : `教材「${set.theme}」` }} onClose={() => setChat(false)} />}
    </main>
  );
}
