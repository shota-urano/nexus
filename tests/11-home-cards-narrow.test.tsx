// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  NARROW_GAP,
  narrowSlots,
  SLOTS,
  SLOTS_NARROW,
} from "../src/screens/home/card-slots";
import { FeatureCards } from "../src/screens/home/feature-cards";
import { FEATURES } from "../src/screens/home/features";
import type { HomeWithResearch } from "./fixtures/home";

// 11-home の実装単位2。幅 480 ピクセル以下で、隣のカードを前のカードのすぐ上と下に詰める
// （BD-03 SCR-001 3.2「画面幅による違い」、BD-13 P02 の「前のカードの高さを測り、隣のカードをそのすぐ上と下に詰める」）。
// jsdom は大きさを計算しないので、カードの高さ（offsetHeight）を差し替えて、短いカードと長いカードで確かめる。

const HOME: HomeWithResearch = {
  newCount: 3,
  unreadCount: 5,
  learning: { contentId: 7, learningTheme: "文型", isCompleted: false },
  ai: { writingCount: 0, hasFailure: false },
  picks: [],
  notices: [],
  research: { unreadCount: 0 },
};

// カードの機能ごとの高さ（ピクセル）。前に出ているときと奥にあるときで変える。
let frontHeights: Record<string, number> = {};
let backHeight = 60;
const original = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "offsetHeight",
);

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get(this: HTMLElement) {
      const id = this.dataset.testid ?? "";
      if (!id.startsWith("card-")) return 0;
      const key = id.slice("card-".length);
      return this.dataset.front === "true"
        ? (frontHeights[key] ?? 100)
        : backHeight;
    },
  });
});

afterEach(() => {
  cleanup();
  if (original) {
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", original);
  }
});

function renderCards(selected: number, narrow = true) {
  const props = {
    features: FEATURES,
    home: HOME,
    narrow,
    reduceMotion: true,
    onPick: () => {},
    onOpenChat: () => {},
    onOpen: () => {},
  };
  const view = render(<FeatureCards {...props} selected={selected} />);
  return {
    rerender: (next: number) =>
      view.rerender(<FeatureCards {...props} selected={next} />),
  };
}

// カードの上の端の位置（translateY）を読む。
function topOf(key: string): number {
  const transform = screen.getByTestId(`card-${key}`).style.transform;
  const match = /translateY\((-?[\d.]+)px\)/.exec(transform);
  if (match === null) throw new Error(`位置が読めない: ${transform}`);
  return Number(match[1]);
}

const FRONT_TOP = SLOTS_NARROW[0].y;
const ABOVE_SCALE = SLOTS_NARROW[-1].scale;

describe("幅 480 ピクセル以下のカードの間隔（BD-03 SCR-001 3.2、BD-13 P02）", () => {
  it("短い前のカードでは、次のカードを前のカードのすぐ下に詰める", () => {
    frontHeights = { news: 90 };
    renderCards(0);
    expect(topOf("news")).toBe(FRONT_TOP);
    expect(topOf("english") - (FRONT_TOP + 90)).toBe(NARROW_GAP);
  });

  it("長い前のカード（写真と知らせ）では、次のカードをその高さの分だけ下げる", () => {
    frontHeights = { news: 230 };
    renderCards(0);
    expect(topOf("english") - (FRONT_TOP + 230)).toBe(NARROW_GAP);
  });

  it("前の（上の）カードは、縮めた高さの下の端を前のカードのすぐ上に置く", () => {
    backHeight = 70;
    frontHeights = { news: 100 };
    renderCards(0);
    // 上のカードは AI Chat（並びの位置 -1）。上の端を軸に縮めるので、下の端は y + 高さ × scale。
    const aboveBottom = topOf("chat") + 70 * ABOVE_SCALE;
    expect(FRONT_TOP - aboveBottom).toBeCloseTo(NARROW_GAP, 5);
    backHeight = 60;
  });

  it("選ぶ機能を変えると、新しい前のカードの高さで詰め直す", () => {
    frontHeights = { news: 90, english: 160 };
    const { rerender } = renderCards(0);
    expect(topOf("english") - (FRONT_TOP + 90)).toBe(NARROW_GAP);
    rerender(1);
    expect(topOf("english")).toBe(FRONT_TOP);
    // English の次（並びの位置 1）は Research（Q-095 の答えで HUD の7分割と並びは試作のまま。CR-020）。
    expect(topOf("research") - (FRONT_TOP + 160)).toBe(NARROW_GAP);
  });

  it("広い画面では高さによらず決まった位置に置く", () => {
    frontHeights = { news: 230 };
    renderCards(0, false);
    expect(topOf("news")).toBe(SLOTS[0].y);
    expect(topOf("english")).toBe(SLOTS[1].y);
    expect(topOf("chat")).toBe(SLOTS[-1].y);
  });

  it("高さを測れないとき（0）は、決まった位置に置く", () => {
    expect(narrowSlots(0, 0)).toEqual(SLOTS_NARROW);
  });
});
