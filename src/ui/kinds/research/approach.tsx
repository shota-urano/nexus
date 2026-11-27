"use client";

import { useState } from "react";
import type { ApproachMark, ApproachView } from "../../../contracts/research";
import { isSafeLink, ReceivedText } from "../../received-text";

// 週報の方法の行と印の表示部品（DD-01 M08。BD-03 SCR-011 の 3.2、SCR-011-O05〜O09、A02、A08。CR-020、Q-095）。
// - 行を押すと、その行のすぐ下に、そのためには、出典、反対の意見を広げる。もう一度押すと閉じる。
//   方法ごとに開閉を持つので、複数を同時に開ける。画面の幅によらず、左右に並べる形は作らない。
// - 印はタグ（記号と文字）を印ごとの色の枠と文字の色で出し、塗らない。印のある方法の行の左に帯を1本出し、
//   帯の色は 反対の意見あり → 今週足した → 出典が増えた の優先順で先の印の色にする（3.2）。
// - 出典は http と https の URL だけをリンクにし、ホスト名を出す（SCR-011-O09、A08）。

// 印のタグ（記号と文字）と色の class（src/app/globals.css の @theme）。
const MARKS: Record<
  ApproachMark,
  { symbol: string; label: string; tag: string; band: string }
> = {
  added: {
    symbol: "+",
    label: "今週足した",
    tag: "border-mark-added text-mark-added",
    band: "bg-mark-added",
  },
  more_sources: {
    symbol: "↑",
    label: "出典が増えた",
    tag: "border-mark-more text-mark-more",
    band: "bg-mark-more",
  },
  disputed: {
    symbol: "!",
    label: "反対の意見あり",
    tag: "border-mark-disputed text-mark-disputed",
    band: "bg-mark-disputed",
  },
};

// 帯の色の優先順（BD-03 SCR-011 3.2。Q-095 の答え）。
const BAND_ORDER: ApproachMark[] = ["disputed", "added", "more_sources"];

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

// 方法1件。行を押すたびに、その行のすぐ下で広げるか閉じる（方法ごとに持つので、同時に開ける）。
export function ApproachItem({ approach }: { approach: ApproachView }) {
  const [open, setOpen] = useState(false);
  const bandMark = BAND_ORDER.find((mark) => approach.marks.includes(mark));
  return (
    <li className="block">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((previous) => !previous)}
        className="relative flex min-h-11 w-full items-start gap-2 overflow-hidden rounded-hud border border-hud-veil py-2 pr-3 pl-4 text-left"
      >
        {bandMark !== undefined && (
          <span
            data-testid="approach-band"
            aria-hidden="true"
            className={`absolute inset-y-0 left-0 w-1 ${MARKS[bandMark].band}`}
          />
        )}
        <span
          aria-hidden="true"
          className={`pt-0.5 text-hud-amber transition-transform ${open ? "rotate-90" : ""}`}
        >
          ›
        </span>
        <span className="min-w-0 flex-1">
          {approach.marks.map((mark) => (
            <span
              key={mark}
              className={`mr-1 mb-1 inline-block rounded-full border px-2 text-xs ${MARKS[mark].tag}`}
            >
              {`${MARKS[mark].symbol} ${MARKS[mark].label}`}
            </span>
          ))}
          <span className="block font-bold leading-snug">{approach.title}</span>
        </span>
        <span className="shrink-0 text-xs text-hud-muted">
          {`出典 ${approach.sourceCount}`}
        </span>
      </button>
      {open && <ApproachDetail approach={approach} />}
    </li>
  );
}

function ApproachDetail({ approach }: { approach: ApproachView }) {
  return (
    <div className="flex flex-col gap-2 px-4 pt-2 pb-3">
      <h3 className="text-sm font-bold text-hud-amber">そのためには</h3>
      <ReceivedText markdown={approach.howToMd} />
      <h3 className="text-sm font-bold text-hud-amber">
        {`出典（${approach.sourceUrls.length}）`}
      </h3>
      <ul className="flex flex-col">
        {approach.sourceUrls.map((url, index) => (
          // 出典の URL は重ならない（DD-02 FN-025）が、順番で見分けて描く。
          <li key={index}>
            {isSafeLink(url) ? (
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-11 items-center underline underline-offset-2"
              >
                {`↗ ${hostOf(url)}`}
              </a>
            ) : (
              <span className="inline-flex min-h-11 items-center break-all text-hud-muted">
                {url}
              </span>
            )}
          </li>
        ))}
      </ul>
      {approach.counterMd !== null && approach.counterMd !== "" && (
        <div className="rounded-hud border-l-4 border-mark-disputed bg-hud-veil px-3 py-2">
          <h3 className="text-sm font-bold text-mark-disputed">反対の意見</h3>
          <ReceivedText markdown={approach.counterMd} />
        </div>
      )}
    </div>
  );
}
