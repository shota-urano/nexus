// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { Home } from "../src/contracts/home";
import { FeatureCards } from "../src/screens/home/feature-cards";
import { FEATURES } from "../src/screens/home/features";

// 11-home の実装単位4。ホームのカードの機能のアイコンを、BD-13 の試作
// `prototype/app/page.tsx` の同じ機能のアイコンと同じ絵にする（SCR-001、BD-13 P01、DD-01 M02）。
// 受け入れ基準「機能ごとのアイコンの SVG の path が、試作の同じ機能のアイコンの path と同じである」を確かめる。
// 試作のアイコンは page.tsx の `const I = { ... }` に機能ごとに書いてあるので、その原文から path の d を読む。
// TC114 は 11-home-screen-reduced-motion.test.tsx で確かめる。

const PROTOTYPE = join(__dirname, "..", "prototype", "app", "page.tsx");

// 試作の `I` のキーと、本番の機能のキーの対応（試作の MODULES で同じ機能に使っているアイコン）。
const PROTOTYPE_KEY: Record<string, string> = {
  news: "news",
  english: "english",
  inbox: "inbox",
  explore: "explore",
  library: "library",
  chat: "chat",
};

// 試作のアイコンの機能ごとの path の d を、書いてある順に読む。
function prototypePaths(): Record<string, string[]> {
  const source = readFileSync(PROTOTYPE, "utf8");
  const block = /const I = \{([\s\S]*?)\n\};/.exec(source);
  if (block === null) throw new Error("試作のアイコンの定義が読めない");
  const result: Record<string, string[]> = {};
  for (const line of block[1].split("\n")) {
    const entry = /^\s*(\w+):\s*(<>.*<\/>),?\s*$/.exec(line);
    if (entry === null) continue;
    result[entry[1]] = [...entry[2].matchAll(/<path\b[^>]*\bd="([^"]*)"/g)].map(
      (m) => m[1],
    );
  }
  return result;
}

const HOME: Home = {
  newCount: 3,
  unreadCount: 5,
  learning: { contentId: 7, learningTheme: "文型", isCompleted: false },
  ai: { writingCount: 0, hasFailure: false },
  picks: [],
  notices: [],
};

afterEach(() => {
  cleanup();
});

// カードに描いたアイコンの path の d を、描いた順に読む。
function cardPaths(key: string): string[] {
  const card = screen.getByTestId(`card-${key}`);
  const svg = card.querySelector("svg");
  if (svg === null) throw new Error(`カード ${key} にアイコンが無い`);
  return [...svg.querySelectorAll("path")].map(
    (path) => path.getAttribute("d") ?? "",
  );
}

describe("ホームのカードの機能のアイコン（BD-13 P01 の試作と同じ絵）", () => {
  const expected = prototypePaths();

  it("試作の6つの機能のアイコンを読める", () => {
    for (const key of Object.values(PROTOTYPE_KEY)) {
      expect(expected[key], key).toBeDefined();
      expect(expected[key].length, key).toBeGreaterThan(0);
    }
  });

  it("ホームの機能は試作と同じ6つである", () => {
    expect(FEATURES.map((f) => f.key).sort()).toEqual(
      Object.keys(PROTOTYPE_KEY).sort(),
    );
  });

  it.each(Object.entries(PROTOTYPE_KEY))(
    "カード %s のアイコンの path が、試作の %s のアイコンの path と同じである",
    (key, prototypeKey) => {
      render(
        <FeatureCards
          features={FEATURES}
          selected={0}
          home={HOME}
          narrow={false}
          reduceMotion={true}
          onPick={() => {}}
          onOpenChat={() => {}}
          onOpen={() => {}}
        />,
      );
      expect(cardPaths(key)).toEqual(expected[prototypeKey]);
    },
  );
});
