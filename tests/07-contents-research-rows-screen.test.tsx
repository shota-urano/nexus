// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ContentSummary } from "../src/contracts/contents";
import { ExploreScreen } from "../src/screens/lists/explore-screen";
import { InboxScreen } from "../src/screens/lists/inbox-screen";
import { LibraryScreen } from "../src/screens/lists/library-screen";

// 07-contents の実装単位5（CR-020）: Inbox、Explore、Library の行で、種類が research の内容を
// 「週報」の種類の印で出し、押すと課題の週報 `/research/{contentId}`（SCR-011）を開く
// （SCR-007-A02、SCR-008-A03、SCR-009-A02、DD-01 M05、BD-03 2章 遷移表）。
// 受け入れ基準: 種類が research の行に「週報」と出る。その行を押すと `/research/{その内容ID}` へ移る。

const NOW = new Date("2026-12-01T00:00:00.000Z"); // 日本時間 2026-12-01 09:00

const RESEARCH_ID = 42;

const RESEARCH: ContentSummary = {
  contentId: RESEARCH_ID,
  kind: "research",
  title: "第二の脳の作り方（2週目）",
  targetDate: "2026-12-01",
  receivedAt: "2026-12-01T07:00:00.000+09:00",
  isNew: true,
  isRead: false,
  isSaved: true,
  savedAt: "2026-12-01T08:00:00.000+09:00",
};

const NEWS: ContentSummary = {
  contentId: 7,
  kind: "news",
  title: "記事の見出し",
  targetDate: "2026-12-01",
  receivedAt: "2026-12-01T06:00:00.000+09:00",
  isNew: true,
  isRead: false,
  isSaved: true,
  savedAt: "2026-12-01T08:00:00.000+09:00",
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  window.sessionStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({ items: [RESEARCH, NEWS], nextCursor: null }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
    ),
  );
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function showRows(name: string): Promise<HTMLElement[]> {
  if (name === "Explore") {
    fireEvent.change(screen.getByRole("searchbox", { name: "検索の言葉" }), {
      target: { value: "ノート" },
    });
    fireEvent.click(screen.getByRole("button", { name: "探す" }));
  }
  return screen.findAllByRole("listitem");
}

describe.each([
  ["Inbox", () => <InboxScreen />],
  ["Explore", () => <ExploreScreen />],
  ["Library", () => <LibraryScreen />],
])("%s の週報の行（CR-020）", (name, screenOf) => {
  it("種類が research の行を出し、種類の印に「週報」と出る", async () => {
    render(screenOf());
    const rows = await showRows(name);
    expect(rows).toHaveLength(2);
    const row = rows.find((r) =>
      r.textContent?.includes("第二の脳の作り方（2週目）"),
    );
    expect(row).toBeDefined();
    expect(row?.textContent).toContain("週報");
    // 種類の印（色の印）を出す。ほかの種類の行と同じ形。
    expect(row?.querySelector('[data-testid="kind-mark"]')).not.toBeNull();
    // ほかの種類の行は「週報」にならない。
    const newsRow = rows.find((r) => r.textContent?.includes("記事の見出し"));
    expect(newsRow?.textContent).toContain("ニュース");
    expect(newsRow?.textContent).not.toContain("週報");
  });

  it("行を押すと /research/{その内容ID} へ移る", async () => {
    render(screenOf());
    await showRows(name);
    const link = screen
      .getAllByRole("link")
      .find((a) => a.textContent?.includes("第二の脳の作り方（2週目）"));
    expect(link).toBeDefined();
    expect(link?.getAttribute("href")).toBe(`/research/${RESEARCH_ID}`);
  });
});
