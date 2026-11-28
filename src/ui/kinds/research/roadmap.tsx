"use client";

import { useSyncExternalStore } from "react";
import type {
  ApproachView,
  ResearchStepStatus,
  StepView,
} from "../../../contracts/research";
import { ApproachItem } from "./approach";

// 週報の道のりの表示部品（DD-01 M08。BD-03 SCR-011 3.2「道のり」、SCR-011-O13。CR-024、Q-101、Q-102）。
// 1本の幹から枝が生えた木の形にする。下が根元で、幹は上へ伸び、てっぺんがゴール。
// - 段は番号の小さい順に下から上へ並べる（段1が一番下）。幹は根元から今ここの段までを実線、今ここより上を
//   点線にする（今ここが無いときは全て実線）。
// - 段の状態は点の形と文字の両方で出す（色だけに頼らない。BD-09 5章）。
// - 各段の高さから枝を出し、枝の先の節に方法を1件ずつ付ける。節は方法の行（M08 の `ApproachItem`）で、押すと
//   その節のすぐ下に詳細を広げる（Q-095 の決定のまま）。
// - 幅 768 ピクセル未満は幹を左に寄せて枝を右だけに、768 ピクセル以上は幹を真ん中に置き、段の方法を送られた
//   順に右、左と交互に出す（Q-102 の答え）。
// - 段の名前の横に、その段のまだ確かめていない NEW の数を「NEW n」で出す（RD-03 R26）。
// 参考の画像（ゲームのスキルツリー）から取り入れたのは構造だけで、絵柄、色、質感、飾りは写さない。色は HUD の
// 色（src/app/globals.css の @theme）だけを使う。

// 幹を真ん中に置く幅（Tailwind の `md` と同じ）。
const WIDE_QUERY = "(min-width: 768px)";

function subscribeWide(onChange: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function")
    return () => {};
  const media = window.matchMedia(WIDE_QUERY);
  media.addEventListener("change", onChange);
  window.addEventListener("resize", onChange);
  return () => {
    media.removeEventListener("change", onChange);
    window.removeEventListener("resize", onChange);
  };
}

function isWideNow(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(WIDE_QUERY).matches
  );
}

// 幅が 768 ピクセル以上か。サーバで描くときは狭い形にする。
export function useWideLayout(): boolean {
  return useSyncExternalStore(subscribeWide, isWideNow, () => false);
}

const STATE_LABELS: Record<ResearchStepStatus, string> = {
  done: "できた",
  doing: "途中",
  current: "今ここ",
  todo: "まだ",
};

// まだ確かめていない NEW（今週足した印があり、確かめていない方法）。
export function isUnseenNew(approach: ApproachView): boolean {
  return approach.marks.includes("added") && !approach.seen;
}

// 段の状態の点。形で状態を見分ける（できた=塗った丸、途中=半分を塗った丸、今ここ=大きい二重丸、まだ=中の空いた丸）。
function StepDot({ status }: { status: ResearchStepStatus }) {
  const base = "block shrink-0 rounded-full";
  if (status === "current") {
    return (
      <span
        aria-hidden="true"
        className={`${base} size-5 border-2 border-hud-amber bg-hud-bg p-0.5`}
      >
        <span className="block size-full rounded-full bg-hud-amber" />
      </span>
    );
  }
  if (status === "done") {
    return (
      <span
        aria-hidden="true"
        className={`${base} size-3.5 border-2 border-hud-muted bg-hud-muted`}
      />
    );
  }
  if (status === "doing") {
    return (
      <span
        aria-hidden="true"
        className={`${base} size-3.5 overflow-hidden border-2 border-hud-muted bg-hud-bg`}
      >
        <span className="block h-full w-1/2 bg-hud-muted" />
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      className={`${base} size-3.5 border-2 border-dashed border-hud-muted bg-hud-bg`}
    />
  );
}

// 段の名前と状態と NEW の数。
function StepLabel({
  step,
  newCount,
  centered,
}: {
  step: StepView;
  newCount: number;
  centered: boolean;
}) {
  const current = step.status === "current";
  return (
    <div
      className={`min-w-0 rounded-hud px-2 py-1 ${current ? "border border-hud-amber bg-hud-panel" : ""} ${centered ? "text-center" : ""}`}
    >
      <p className="text-sm leading-snug">
        <span className="mr-1 font-bold text-hud-amber">{`段${step.no}`}</span>
        <span className={current ? "font-bold" : ""}>{step.title}</span>
      </p>
      <p
        className={`mt-1 flex flex-wrap items-center gap-1 text-xs ${centered ? "justify-center" : ""}`}
      >
        <span
          className={`rounded-full border px-2 ${current ? "border-hud-amber text-hud-amber" : "border-hud-veil text-hud-muted"}`}
        >
          {STATE_LABELS[step.status]}
        </span>
        {newCount > 0 && (
          <span
            data-testid="step-new-count"
            className="rounded-full border border-mark-added px-2 text-mark-added"
          >
            {`NEW ${newCount}`}
          </span>
        )}
      </p>
    </div>
  );
}

// 幹の線。今ここより上は点線。
function Trunk({ solid, className }: { solid: boolean; className: string }) {
  return (
    <span
      data-testid="roadmap-trunk"
      data-line={solid ? "solid" : "dashed"}
      aria-hidden="true"
      className={`absolute w-0 border-l-2 border-hud-line ${solid ? "" : "border-dashed"} ${className}`}
    />
  );
}

// 枝の先の節1つ。枝の線は幹の側に出す。
function Node({
  approach,
  side,
  onOpen,
}: {
  approach: ApproachView;
  side: "left" | "right";
  onOpen: (approach: ApproachView) => void;
}) {
  return (
    <li
      data-testid="roadmap-node"
      data-approach-no={approach.no ?? undefined}
      data-side={side}
      className={`relative ${side === "right" ? "pl-5" : "pr-5"}`}
    >
      <span
        aria-hidden="true"
        className={`absolute top-5 w-5 border-t-2 border-hud-line ${side === "right" ? "left-0" : "right-0"}`}
      />
      <span
        aria-hidden="true"
        className={`absolute top-[1.0625rem] size-2 rotate-45 bg-hud-amber ${side === "right" ? "left-4" : "right-4"}`}
      />
      <ApproachItem as="div" approach={approach} onOpen={onOpen} />
    </li>
  );
}

export function Roadmap({
  goal,
  steps,
  approaches,
  onOpen,
}: {
  // ゴール（課題名）。
  goal: string;
  steps: StepView[];
  // 段にぶら下がる方法（送られた順）。
  approaches: ApproachView[];
  onOpen: (approach: ApproachView) => void;
}) {
  const wide = useWideLayout();
  const ordered = [...steps].sort((a, b) => b.no - a.no);
  const currentNo = steps.find((s) => s.status === "current")?.no ?? null;
  const solidUpTo = (no: number) => currentNo === null || no <= currentNo;

  return (
    <div data-testid="roadmap" className="mt-3">
      <div
        data-testid="roadmap-goal"
        className={`relative flex items-center gap-2 pb-2 ${wide ? "flex-col text-center" : "pl-1"}`}
      >
        <span
          aria-hidden="true"
          className="flex size-7 shrink-0 items-center justify-center rounded-full border-2 border-hud-amber text-hud-amber"
        >
          ★
        </span>
        <p className="min-w-0 text-sm leading-snug">
          <span className="mr-1 font-bold text-hud-amber">ゴール</span>
          <span>{goal}</span>
        </p>
      </div>
      <ol className="flex flex-col">
        {ordered.map((step) => {
          const items = approaches.filter((a) => a.step === step.no);
          const newCount = items.filter(isUnseenNew).length;
          // この段の高さの幹。根元から今ここの段までは実線、今ここより上は点線。
          const solid = solidUpTo(step.no);
          if (wide) {
            const right = items.filter((_, i) => i % 2 === 0);
            const left = items.filter((_, i) => i % 2 === 1);
            return (
              <li
                key={step.no}
                data-testid="roadmap-step"
                data-step-no={step.no}
                data-state={step.status}
                className="grid grid-cols-[minmax(0,1fr)_12rem_minmax(0,1fr)]"
              >
                <ul className="flex flex-col gap-2 py-2">
                  {left.map((a, i) => (
                    <Node
                      key={a.no ?? `l${i}`}
                      approach={a}
                      side="left"
                      onOpen={onOpen}
                    />
                  ))}
                </ul>
                <div className="relative flex flex-col items-center gap-1 py-2">
                  <Trunk solid={solid} className="inset-y-0 left-1/2 -ml-px" />
                  <span className="relative">
                    <StepDot status={step.status} />
                  </span>
                  <div className="relative bg-hud-bg">
                    <StepLabel step={step} newCount={newCount} centered />
                  </div>
                </div>
                <ul className="flex flex-col gap-2 py-2">
                  {right.map((a, i) => (
                    <Node
                      key={a.no ?? `r${i}`}
                      approach={a}
                      side="right"
                      onOpen={onOpen}
                    />
                  ))}
                </ul>
              </li>
            );
          }
          return (
            <li
              key={step.no}
              data-testid="roadmap-step"
              data-step-no={step.no}
              data-state={step.status}
              className="relative pl-9"
            >
              <Trunk solid={solid} className="inset-y-0 left-[0.8125rem]" />
              <div className="relative py-2">
                <span className="absolute top-3 -left-9 flex w-7 justify-center">
                  <StepDot status={step.status} />
                </span>
                <StepLabel step={step} newCount={newCount} centered={false} />
              </div>
              {items.length > 0 && (
                <ul className="flex flex-col gap-2 pb-3">
                  {items.map((a, i) => (
                    <Node
                      key={a.no ?? `n${i}`}
                      approach={a}
                      side="right"
                      onOpen={onOpen}
                    />
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ol>
      <div
        data-testid="roadmap-root"
        className={`flex items-center gap-2 pt-1 text-xs text-hud-muted ${wide ? "flex-col" : ""}`}
      >
        <span
          aria-hidden="true"
          className={`block h-0.5 w-10 rounded-full bg-hud-line ${wide ? "" : "ml-0"}`}
        />
        <span>根元</span>
      </div>
    </div>
  );
}
