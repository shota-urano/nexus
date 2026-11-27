"use client";
// SCR-011 課題の週報の試作（Q-095、CR-020）。データは作り物。
// 見比べるための切り替え（URL の引数）:
//   marks=b（既定。Q-095 の答え）: 行の左に色の帯、タグは枠と文字の色 / marks=a: 印を色を塗った丸いタグに記号と文字で出す（採らなかった案）
//   layout=inline（既定。Q-095 の答えで、どの幅でもこれ）: 方法をその場で下に広げる / layout=split: 方法の一覧を左、選んだ方法を右に出す（採らなかった案）
//   帯の色は、印が2つ以上あるとき 反対の意見あり → 今週足した → 出典が増えた の順で先の印の色（BD-03 SCR-011）
//   open=0,2: 初めから広げておく方法の番号（撮るため）
import "../../home.css";
import "../research.css";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import { formatDate } from "@/lib/data";
import { MARKS, host, reports, type Approach, type Mark } from "@/lib/research";
import { Chat } from "@/components/Chat";

// 帯の色の優先順（BD-03 SCR-011。Q-095 の答え）
const BAND_ORDER: Mark[] = ["disputed", "added", "more_sources"];

function MarkTag({ m }: { m: Mark }) {
  const d = MARKS[m];
  return (
    <span className="mk" style={{ ["--c" as string]: d.color }}>
      <i aria-hidden="true">{d.symbol}</i>
      {d.label}
    </span>
  );
}

function ApproachBody({ a }: { a: Approach }) {
  return (
    <div className="r-ap-body">
      <div className="r-section-title" style={{ marginTop: 4 }}>そのためには</div>
      <div className="r-md"><ReactMarkdown>{a.howToMd}</ReactMarkdown></div>
      <div className="r-section-title" style={{ marginTop: 10 }}>出典（{a.sourceUrls.length}）</div>
      <div className="r-sources">
        {a.sourceUrls.length === 0 && <span style={{ fontSize: 13, color: "#aab0c1" }}>出典はまだありません</span>}
        {a.sourceUrls.map((u) => <a key={u} href={u} target="_blank" rel="noreferrer">↗ {host(u)}{new URL(u).pathname}</a>)}
      </div>
      {a.counterMd && <div className="r-counter"><b>反対の意見</b><br />{a.counterMd}</div>}
    </div>
  );
}

function useWide() {
  const [w, setW] = useState(false);
  useEffect(() => { const f = () => setW(window.innerWidth >= 900); f(); window.addEventListener("resize", f); return () => window.removeEventListener("resize", f); }, []);
  return w;
}

function Body() {
  const sp = useSearchParams();
  const id = Number(sp.get("id") ?? 102);
  const marksVariant = sp.get("marks") === "a" ? "a" : "b";
  const wide = useWide();
  const layout = sp.get("layout") === "split" && wide ? "split" : "inline";
  const initialOpen = (sp.get("open") ?? "").split(",").filter(Boolean).map(Number);
  const [open, setOpen] = useState<number[]>(initialOpen);
  const [picked, setPicked] = useState<number>(initialOpen[0] ?? 0);
  const [chat, setChat] = useState(false);
  const r = reports.find((x) => x.contentId === id) ?? reports[0];
  const [read, setRead] = useState(r.isRead);
  const [saved, setSaved] = useState(false);
  const weeks = reports.filter((x) => x.topicId === r.topicId).sort((a, b) => b.week - a.week);
  const toggle = (i: number) => setOpen((o) => (o.includes(i) ? o.filter((x) => x !== i) : [...o, i]));

  const list = (
    <div className="r-card">
      <div className="r-section-title">方法の一覧（{r.approaches.length}）</div>
      <div className="r-legend">{(Object.keys(MARKS) as Mark[]).map((m) => <MarkTag key={m} m={m} />)}</div>
      <div style={{ marginTop: 8 }}>
        {r.approaches.map((a, i) => {
          const isOpen = layout === "split" ? picked === i : open.includes(i);
          const top = BAND_ORDER.find((m) => a.marks.includes(m));
          const lead = top ? MARKS[top].color : "transparent";
          return (
            <div className="r-ap" key={i}>
              <button className="r-ap-row" aria-expanded={isOpen} onClick={() => (layout === "split" ? setPicked(i) : toggle(i))} style={{ ["--lead" as string]: lead }}>
                <span className="r-chev" aria-hidden="true">›</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  {a.marks.length > 0 && <span className="r-marks">{a.marks.map((m) => <MarkTag key={m} m={m} />)}</span>}
                  <span className="r-ap-title">{a.title}</span>
                </span>
                <span className="r-ap-count">出典 {a.sourceUrls.length}</span>
              </button>
              {layout !== "split" && isOpen && <ApproachBody a={a} />}
            </div>
          );
        })}
      </div>
    </div>
  );

  const overview = (
    <>
      <div className="r-card r-change">
        <div className="r-section-title">今週の変化</div>
        <div className="r-md"><ReactMarkdown>{r.changesMd}</ReactMarkdown></div>
      </div>
      <div className="r-card">
        <div className="r-section-title">現時点の答え</div>
        <div className="r-md"><ReactMarkdown>{r.answerMd}</ReactMarkdown></div>
      </div>
    </>
  );

  const unknowns = r.unknownsMd && (
    <div className="r-card">
      <div className="r-section-title">まだ分かっていないこと</div>
      <div className="r-md"><ReactMarkdown>{r.unknownsMd}</ReactMarkdown></div>
    </div>
  );

  return (
    <>
      <div className="bg-stars" />
      <main className={`r-page marks-${marksVariant}`}>
        <div className="r-top">
          <Link href="/research" aria-label="課題の一覧"><img src="/img/logo.png" alt="" /></Link>
          <h1><b>Research</b></h1>
          <button className="r-ai" onClick={() => setChat(true)}>✦ AI に質問</button>
        </div>
        <div className="r-head">
          <div className="r-q">{r.topicTitle}</div>
          <div className="r-weekbar">
            <span className={`r-status${r.status === "ended" ? " ended" : ""}`}>{r.status === "ended" ? "終了（最後の報告）" : "進行中"}</span>
            <select aria-label="週" value={r.contentId} onChange={(e) => { window.location.search = `?id=${e.target.value}&marks=${marksVariant}${sp.get("layout") ? `&layout=${layout}` : ""}`; }}>
              {weeks.map((w) => <option key={w.contentId} value={w.contentId}>{w.week}週目（{formatDate(w.sentOn)}）{w.isRead ? "" : " ・未読"}</option>)}
            </select>
          </div>
          <div className="r-actions">
            <button aria-label={read ? "未読に戻す" : "読んだ"} onClick={() => setRead(!read)} style={{ borderColor: read ? "#ffb85e" : undefined, color: read ? "#ffd08a" : undefined }}>📖 {read ? "読んだ" : "読んだにする"}</button>
            <button aria-label={saved ? "保存を外す" : "保存"} onClick={() => setSaved(!saved)} style={{ borderColor: saved ? "#ffb85e" : undefined, color: saved ? "#ffd08a" : undefined }}>🔖 {saved ? "保存した" : "保存"}</button>
          </div>
        </div>
        {layout === "split" ? (
          <>
            {overview}
            <div className="r-split">
              <div>{list}{unknowns}</div>
              <div className="r-detail r-card">
                {r.approaches[picked] ? (
                  <>
                    {r.approaches[picked].marks.length > 0 && <div className="r-marks">{r.approaches[picked].marks.map((m) => <MarkTag key={m} m={m} />)}</div>}
                    <div style={{ fontSize: 16, fontWeight: 700, lineHeight: 1.5, margin: "2px 8px 6px" }}>{r.approaches[picked].title}</div>
                    <ApproachBody a={r.approaches[picked]} />
                  </>
                ) : <div className="empty">方法はまだありません</div>}
              </div>
            </div>
          </>
        ) : (
          <>{overview}{list}{unknowns}</>
        )}
      </main>
      <div className="r-variant">印 {marksVariant.toUpperCase()} ／ {layout === "split" ? "右に並べる" : "その場で広げる"}</div>
      {chat && <Chat target={{ kind: "page", label: `週報: ${r.topicTitle}（${r.week}週目）` }} onClose={() => setChat(false)} />}
    </>
  );
}

export default function ReportPage() {
  return <Suspense><Body /></Suspense>;
}
