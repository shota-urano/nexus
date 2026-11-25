"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchHome } from "../../client/home";
import type { Home } from "../../contracts/home";
import { formatListDate } from "../../ui/list-date";
import { useReduceMotion } from "../../ui/motion";
import { ChatSheet } from "../chat/chat-sheet";
import { FeatureCards } from "./feature-cards";
import { FEATURES } from "./features";
import { Hud } from "./hud";
import { selectedAt, snapTurn, turnToSelect } from "./hud-angle";
import { HOME_MESSAGES } from "./messages";

// SCR-001 ホーム（DD-01 M02。BD-03 SCR-001、BD-02 FN-020、BD-13 P01、P02、NFR-008）。
// - A01 画面を開いたら `getHome` で値を読む。HUD とカードは読み込みを待たずに出し、操作できる。
//   読み込み中は数の場所に待つ印、読めなければ数の場所に MSG-019 を出す（3.5）。
// - A02 HUD を指で回すかセグメントを押して機能を選ぶ。選ぶ操作と移る操作は分ける（BD-13 P01）。
// - A03 前のカードを押すと機能の画面へ移る。学習の続きを押すと、完了していない教材を開く。
// - A04 今日のピックアップの記事を押すと、記事の案内（SCR-003）を全画面で開く。
// - A05 中心の AI の印か「AI に質問」を押すと、対象の無い AI チャット（SCR-006）を開く。
// - 0件のものは0か空にする（RD-03 R21）。
// - 401（MSG-020）のときは何も出さない。全面の知らせは M01 の枠が出す。
// - 動きを減らす設定（NFR-008）のときは、HUD の回転とカードの移動を動かさずに切り替える。

type Phase = "loading" | "ready" | "failed" | "unauthorized";

// 前のカードを縦に並べる幅（BD-03 SCR-001 3.2）。
const NARROW_MAX_WIDTH = 480;

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

// 日本時間の今日（`YYYY-MM-DD`）と今年。
function todayInJapan(now: Date): { date: string; year: number } {
  const shifted = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return {
    date: shifted.toISOString().slice(0, 10),
    year: shifted.getUTCFullYear(),
  };
}

function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const update = () => setNarrow(window.innerWidth <= NARROW_MAX_WIDTH);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return narrow;
}

function WaitMark() {
  return (
    <span role="status" className="inline-flex justify-center py-1">
      <span className="sr-only">読み込み中</span>
      <span
        aria-hidden="true"
        className="size-5 rounded-full border-2 border-current border-t-transparent motion-safe:animate-spin"
      />
    </span>
  );
}

function Count({ value }: { value: number }) {
  return (
    <span className="mt-1.5 block text-[22px] font-bold">
      {value}
      <span className="ml-0.5 text-[10px] font-medium text-[#bcc2cc]">件</span>
    </span>
  );
}

// O04〜O07 の数の並び。
function StatusRow({ phase, home }: { phase: Phase; home: Home | null }) {
  const frame =
    "rounded-[19px] border border-[#d0c1b12f] bg-[linear-gradient(140deg,rgba(44,43,45,.8),rgba(16,22,30,.9))] px-1 py-3.5";
  if (phase === "failed") {
    return (
      <section aria-label="ホームの数" className={frame}>
        <p role="status" className="px-3 text-center text-sm">
          {HOME_MESSAGES["MSG-019"]}
        </p>
      </section>
    );
  }
  if (home === null) {
    return (
      <section aria-label="ホームの数" className={`${frame} text-center`}>
        {phase === "loading" && <WaitMark />}
      </section>
    );
  }
  const learning = home.learning;
  const cell = "border-r border-[#b0b3be29] px-1 text-center last:border-r-0";
  const label = "block text-[10px] whitespace-nowrap text-[#aaafbf]";
  return (
    <section aria-label="ホームの数" className={`${frame} grid grid-cols-4`}>
      <div className={cell}>
        <span className={label}>未読</span>
        <Count value={home.unreadCount} />
      </div>
      <div className={cell}>
        <span className={label}>新着</span>
        <Count value={home.newCount} />
      </div>
      <div className={cell}>
        <span className={label}>学習の続き</span>
        {learning === null ? null : learning.isCompleted ? (
          <span className="mt-2 block text-sm font-bold">
            {learning.learningTheme}
            <span className="ml-1 rounded-full border border-[#8ed2bc80] px-1.5 text-[10px] text-[#8ed2bc]">
              完了
            </span>
          </span>
        ) : (
          <Link
            href={`/english/${learning.contentId}`}
            className="mt-1 inline-flex min-h-11 min-w-11 items-center justify-center text-sm font-bold underline-offset-2 hover:underline"
          >
            {learning.learningTheme}
          </Link>
        )}
      </div>
      <div className={cell}>
        <span className={label}>AI の応答中</span>
        <Count value={home.ai.writingCount} />
      </div>
    </section>
  );
}

// O08 今日のピックアップ（3件まで）。無ければ空にする。
function Pickup({ home }: { home: Home | null }) {
  const picks = home?.picks ?? [];
  return (
    <section
      aria-label="今日のピックアップ"
      className="rounded-[23px] border border-[#b3acb034] bg-[linear-gradient(145deg,#161b25ed,#0d121af9)] px-3.5 py-4"
    >
      <h2 className="text-base font-bold">今日のピックアップ</h2>
      <ul>
        {picks.map((pick) => (
          <li key={pick.contentId} className="mt-2.5">
            <Link
              href={`/news?article=${pick.contentId}`}
              className="flex min-h-11 items-center gap-3 rounded-2xl border border-[#81899533] bg-[linear-gradient(125deg,#252831,#141b27)] p-2"
            >
              {pick.imageUrl === null ? (
                <span
                  aria-hidden="true"
                  className="flex h-[72px] w-24 shrink-0 items-center justify-center rounded-xl bg-[#0b0f17]"
                >
                  <span className="size-3 rounded-full bg-[#ffb040] shadow-[0_0_10px_#ffb040]" />
                </span>
              ) : (
                // 画像は記事のサイトにあり、Next.js の画像の最適化を通さない（RD-12 T12）。
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={pick.imageUrl}
                  alt=""
                  referrerPolicy="no-referrer"
                  className="h-[72px] w-24 shrink-0 rounded-xl border border-white/10 object-cover"
                />
              )}
              <span className="min-w-0">
                <span className="inline-flex rounded-full border border-[#e9a75a9a] bg-[#6c4c272b] px-2 py-0.5 text-[10px] text-[#ffc077]">
                  {pick.theme}
                </span>
                <span className="mt-1.5 block text-[13px] leading-normal font-semibold">
                  {pick.title}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function HomeScreen({ now }: { now?: Date } = {}) {
  const reduceMotion = useReduceMotion();
  const narrow = useNarrow();
  const [phase, setPhase] = useState<Phase>("loading");
  const [home, setHome] = useState<Home | null>(null);
  // HUD を回した角度（度）と、右の真ん中にある機能。初めは News Galaxy（O01 の初期値）。
  const [turn, setTurn] = useState(0);
  const [selected, setSelected] = useState(0);
  const [chatOpen, setChatOpen] = useState(false);
  const [today] = useState(() => todayInJapan(now ?? new Date()));

  useEffect(() => {
    const controller = new AbortController();
    fetchHome({ signal: controller.signal }).then(
      (result) => {
        if (controller.signal.aborted) return;
        if (result.status === "ok") {
          setHome(result.value);
          setPhase("ready");
        } else {
          setPhase(result.status);
        }
      },
      (error: unknown) => {
        if (controller.signal.aborted || isAbortError(error)) return;
        setPhase("failed");
      },
    );
    return () => controller.abort();
  }, []);

  function pick(index: number) {
    setTurn((current) => turnToSelect(current, index));
    setSelected(index);
  }

  function drag(next: number) {
    setTurn(next);
    setSelected(selectedAt(next, FEATURES.length));
  }

  function release() {
    setTurn((current) => snapTurn(current));
  }

  const openChat = () => setChatOpen(true);

  return (
    <div className="relative min-h-dvh overflow-x-hidden bg-[#080b11] text-[#f1ece4]">
      <div className="relative mx-auto max-w-[1180px] px-3.5 pt-6 pb-10">
        <header className="flex h-16 items-center gap-3">
          <span
            aria-hidden="true"
            className="size-10 rounded-full border border-[#ffc07780] bg-[radial-gradient(circle,#ffb04055,transparent_70%)] shadow-[0_0_14px_#ef9e4c66]"
          />
          <div>
            <h1 className="text-[22px] font-bold tracking-[7px]">NEXUS</h1>
            <span className="mt-1 block text-[11px] tracking-[1px] text-[#98a0b0]">
              {formatListDate(today.date, today.year)}
            </span>
          </div>
        </header>

        <section
          aria-label="機能の選択"
          className="relative -mx-3.5 h-[min(122vw,620px)] overflow-hidden"
        >
          <div className="absolute top-1/2 -left-[2vw] z-[3] aspect-square w-[min(66vw,560px)] -translate-y-1/2">
            <Hud
              features={FEATURES}
              selected={selected}
              turn={turn}
              reduceMotion={reduceMotion}
              onPick={pick}
              onDrag={drag}
              onRelease={release}
              onCenter={openChat}
            />
          </div>
          <div className="pointer-events-none absolute inset-0 z-[4]">
            <FeatureCards
              features={FEATURES}
              selected={selected}
              home={home}
              narrow={narrow}
              reduceMotion={reduceMotion}
              onPick={pick}
              onOpenChat={openChat}
            />
          </div>
          <p className="absolute bottom-2.5 left-[18px] text-[10px] tracking-[1.2px] text-[#aab0c1]">
            指で回して選び、カードを押して開く
          </p>
        </section>

        <StatusRow phase={phase} home={home} />

        <button
          type="button"
          onClick={openChat}
          className="my-5 flex h-[58px] w-full items-center justify-between rounded-[18px] border border-[#ffb85c] bg-[linear-gradient(100deg,#503421,#2c2524_67%,#34231c)] px-[18px] text-base font-bold shadow-[0_0_26px_#d8863936]"
        >
          <span>AI に質問</span>
          <span aria-hidden="true" className="text-[#ffcf87]">
            →
          </span>
        </button>

        <Pickup home={home} />
      </div>
      <ChatSheet
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        target={null}
      />
    </div>
  );
}
