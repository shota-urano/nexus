"use client";

import { motion } from "motion/react";
import Link from "next/link";
import type { MouseEvent, ReactNode } from "react";
import type { Home } from "../../contracts/home";
import { type Feature, FeatureIcon, type FeatureKey } from "./features";
import { cardOffset } from "./hud-angle";
import { HOME_MESSAGES } from "./messages";

// 機能のカード（BD-03 SCR-001-O03、O09、A02、A03）。
// - 選んだ機能のカードを前に出し、ほかを上下に奥へ薄く置く（A02）。
// - 前のカードを押すと、その機能の画面へ移る（A03。遷移表）。AI Chat は下から出る面で開く。
//   移る動き（セグメントの光 → カードの移動 → 広がって移る）は画面（home-screen）が進め、
//   ここでは `leaving` が "move" か "expand" のとき、前のカードを前へ引き出す。
//   奥のカードを押すと、その機能を選ぶ（HUD が回る）。
// - 知らせ（MSG-015〜MSG-017）は、該当する機能のカードの中に出す（BD-09 2章「ホームのカード」）。
// - 幅 480 ピクセル以下では、前のカードは「アイコン、見出し、件数」を縦に並べ、隣のカードを
//   前のカードのすぐ上と下に詰める（BD-03 SCR-001 3.2）。
// - 動きを減らす設定（NFR-008）のときは、カードの移動の動きを使わず、置いた後の位置で描く。

// カードを動かす長さ（秒）。
const MOVE_SECONDS = 0.5;

interface Slot {
  /** 上下の位置（ピクセル。並びの真ん中から） */
  y: number;
  /** 傾き（度） */
  tilt: number;
  scale: number;
  opacity: number;
}

// 移る動きの段階（A03。home-screen の LeaveStep と同じ）。
export type LeaveStep = "glow" | "move" | "expand";

// 移る動きで前のカードを引き出す置き方（並びの真ん中から HUD の側へ寄せ、正面に向ける）。
const LEAVING_SLOT = { x: -36, y: -70, tilt: 0, scale: 1.08, opacity: 1 };
// 移る動きでカードを動かす長さ（秒）。
const LEAVE_MOVE_SECONDS = 0.28;

// 並びの位置（cardOffset）ごとの置き方。
const SLOTS: Record<number, Slot> = {
  [-2]: { y: -210, tilt: -10, scale: 0.7, opacity: 0 },
  [-1]: { y: -150, tilt: -7, scale: 0.84, opacity: 0.62 },
  0: { y: -70, tilt: -4, scale: 1, opacity: 1 },
  1: { y: 76, tilt: 5, scale: 0.87, opacity: 0.72 },
  2: { y: 140, tilt: 8, scale: 0.74, opacity: 0.25 },
  3: { y: 190, tilt: 10, scale: 0.6, opacity: 0 },
};
const SLOTS_NARROW: Record<number, Slot> = {
  [-2]: { y: -160, tilt: -8, scale: 0.74, opacity: 0 },
  [-1]: { y: -128, tilt: -6, scale: 0.86, opacity: 0.6 },
  0: { y: -80, tilt: -3, scale: 1, opacity: 1 },
  1: { y: 92, tilt: 4, scale: 0.88, opacity: 0.7 },
  2: { y: 136, tilt: 6, scale: 0.76, opacity: 0.3 },
  3: { y: 170, tilt: 8, scale: 0.6, opacity: 0 },
};

// カードの下の行（件数や学習テーマ）。データを読めていなければ出さない。
function summaryOf(key: FeatureKey, home: Home | null): ReactNode {
  switch (key) {
    case "news":
      return "今日のピックアップ";
    case "english":
      if (home === null || home.learning === null) return "学習の続き";
      return home.learning.isCompleted
        ? `${home.learning.learningTheme}（完了）`
        : home.learning.learningTheme;
    case "inbox":
      return (
        <>
          新着 {home !== null && <b className="text-base">{home.newCount}</b>}
          {home !== null && "件"}
        </>
      );
    case "explore":
      return "言葉で探す";
    case "library":
      return "保存した内容";
    case "chat":
      return (
        <>
          応答中{" "}
          {home !== null && <b className="text-base">{home.ai.writingCount}</b>}
          {home !== null && "件"}
        </>
      );
  }
}

function CardBody({
  feature,
  home,
  front,
}: {
  feature: Feature;
  home: Home | null;
  front: boolean;
}) {
  const notice =
    home !== null &&
    feature.notice !== null &&
    home.notices.includes(feature.notice)
      ? HOME_MESSAGES[feature.notice]
      : null;
  const photos =
    front && feature.key === "news" && home !== null
      ? home.picks.filter((pick) => pick.imageUrl !== null)
      : [];
  return (
    <>
      <span
        className={`flex w-full items-center gap-2 ${front ? "max-[480px]:flex-col max-[480px]:items-start" : ""}`}
      >
        <FeatureIcon
          feature={feature}
          className={`size-7 shrink-0 ${front ? "" : "max-[480px]:hidden"}`}
        />
        <span className="min-w-0 flex-1">
          <span
            className={`block font-bold text-[#f9f8fa] ${front ? "text-[15px]" : "text-[13px] max-[480px]:text-xs"}`}
          >
            {feature.name}
          </span>
          <span
            className={`mt-0.5 block text-[11px] leading-snug ${front ? "text-[#e7b981]" : "text-[#b7bac5] max-[480px]:text-[10px]"}`}
          >
            {summaryOf(feature.key, home)}
          </span>
        </span>
      </span>
      {photos.length > 0 && (
        <span className="mt-2 flex w-full gap-1.5" aria-hidden="true">
          {photos.map((pick) => (
            // 画像は記事のサイトにあり、Next.js の画像の最適化を通さない（RD-12 T12）。
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={pick.contentId}
              src={pick.imageUrl ?? undefined}
              alt=""
              referrerPolicy="no-referrer"
              className="aspect-[16/10] w-[32%] rounded-md border border-white/20 object-cover"
            />
          ))}
        </span>
      )}
      {notice !== null && (
        <span className="mt-1.5 block text-[11px] leading-snug text-[#ff9a6b]">
          {notice}
        </span>
      )}
    </>
  );
}

export function FeatureCards({
  features,
  selected,
  home,
  narrow,
  reduceMotion,
  onPick,
  onOpenChat,
  onOpen,
  leaving = null,
}: {
  features: readonly Feature[];
  selected: number;
  /** ホームの値。読み込み中か読めなかったときは null */
  home: Home | null;
  narrow: boolean;
  reduceMotion: boolean;
  onPick: (index: number) => void;
  onOpenChat: () => void;
  /** 前のカードの道を押したとき（A03）。移る動きを使うなら `event.preventDefault()` する */
  onOpen: (index: number, event: MouseEvent) => void;
  /** 移る動きの段階。移っていなければ null */
  leaving?: LeaveStep | null;
}) {
  const slots = narrow ? SLOTS_NARROW : SLOTS;
  return (
    <div className="absolute top-1/2 right-1.5 left-[62%] h-0 [perspective:900px]">
      {features.map((feature, index) => {
        const offset = cardOffset(index, selected, features.length);
        const slot = slots[offset] ?? slots[3];
        const front = offset === 0;
        const hidden = slot.opacity === 0;
        const className = `block w-full rounded-[18px] border px-3 py-3 text-left backdrop-blur-lg max-[480px]:px-2.5 max-[480px]:py-2.5 ${
          front
            ? "border-[#ffba6b] bg-[linear-gradient(120deg,#513926ea,#26252bf5_64%,#1f2431)] shadow-[0_0_0_1px_#ffba6b4f,0_0_30px_#ed9f4b48,0_22px_30px_#0009]"
            : "border-[#c9cdd32b] bg-[linear-gradient(120deg,#2d2b2dce,#1b212df5_60%,#131925e8)] shadow-[0_17px_25px_#0008]"
        }`;
        const style = {
          zIndex: 10 - Math.abs(offset),
          transformOrigin: "top right",
          pointerEvents: hidden ? ("none" as const) : ("auto" as const),
        };
        const body = <CardBody feature={feature} home={home} front={front} />;

        let card: ReactNode;
        if (!front) {
          card = (
            <button
              type="button"
              className={`${className} min-h-11`}
              tabIndex={hidden ? -1 : undefined}
              aria-hidden={hidden || undefined}
              onClick={() => onPick(index)}
            >
              {body}
            </button>
          );
        } else if (feature.href === null) {
          card = (
            <button
              type="button"
              className={`${className} min-h-11`}
              onClick={onOpenChat}
            >
              {body}
            </button>
          );
        } else {
          card = (
            <Link
              href={feature.href}
              className={`${className} min-h-11`}
              onClick={(event) => onOpen(index, event)}
            >
              {body}
            </Link>
          );
        }
        const pulled = front && (leaving === "move" || leaving === "expand");

        if (reduceMotion) {
          return (
            <div
              key={feature.key}
              data-testid={`card-${feature.key}`}
              data-front={front}
              className="absolute right-0 left-0"
              style={{
                ...style,
                transform: `translateY(${slot.y}px) rotate(${slot.tilt}deg) scale(${slot.scale})`,
                opacity: slot.opacity,
              }}
            >
              {card}
            </div>
          );
        }
        return (
          <motion.div
            key={feature.key}
            data-testid={`card-${feature.key}`}
            data-front={front}
            data-leaving={pulled || undefined}
            className="absolute right-0 left-0"
            initial={false}
            animate={
              pulled
                ? {
                    x: LEAVING_SLOT.x,
                    y: LEAVING_SLOT.y,
                    rotateZ: LEAVING_SLOT.tilt,
                    rotateY: 0,
                    scale: LEAVING_SLOT.scale,
                    opacity: LEAVING_SLOT.opacity,
                  }
                : {
                    x: 0,
                    y: slot.y,
                    rotateZ: slot.tilt,
                    rotateY: -8,
                    scale: slot.scale,
                    opacity: slot.opacity,
                  }
            }
            transition={{
              duration: pulled ? LEAVE_MOVE_SECONDS : MOVE_SECONDS,
              ease: [0.19, 1, 0.22, 1],
            }}
            style={style}
          >
            {card}
          </motion.div>
        );
      })}
    </div>
  );
}
