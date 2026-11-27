// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HomeScreen, LEAVE_STEP_MS } from "../src/screens/home/home-screen";
import type { HomeWithResearch } from "./fixtures/home";

// 14-research の実装単位5（CR-020、Q-095）: ホームの円形 HUD（M02）を7つのセグメントにして Research を足し、
// Research のカードに「未読 {件数}」（`getHome` の `research.unreadCount`）を出し、カードを押すと `/research`
// （SCR-010）へ移る。HUD の7分割は試作のまま、Research のアイコンは虫眼鏡と折れ線（試作の `researchB`）。
// 受け入れ基準:
// - DD-10 TC143（このファイル）
// - DD-10 TC114（tests/11-home-screen-reduced-motion.test.tsx。7分割の角度に合わせた）
// - Research のアイコンの SVG の path が、試作 `prototype/app/page.tsx` の `researchB` の path と同じ（このファイル。
//   カードのアイコンは tests/11-home-card-icons.test.tsx でも確かめる）

const PROTOTYPE = join(__dirname, "..", "prototype", "app", "page.tsx");

interface PrototypeIcon {
  paths: string[];
  circles: string[];
}

// 試作の `const I = { ... }` から、アイコンごとの path の d と circle の属性を書いてある順に読む。
function prototypeIcons(): Record<string, PrototypeIcon> {
  const source = readFileSync(PROTOTYPE, "utf8");
  const block = /const I = \{([\s\S]*?)\n\};/.exec(source);
  if (block === null) throw new Error("試作のアイコンの定義が読めない");
  const result: Record<string, PrototypeIcon> = {};
  for (const line of block[1].split("\n")) {
    const entry = /^\s*(\w+):\s*(<>.*<\/>),?\s*$/.exec(line);
    if (entry === null) continue;
    result[entry[1]] = {
      paths: [...entry[2].matchAll(/<path\b[^>]*\bd="([^"]*)"/g)].map(
        (m) => m[1],
      ),
      circles: [...entry[2].matchAll(/<circle\b([^>]*?)\/>/g)].map((m) =>
        circleKey(
          /\bcx="([^"]*)"/.exec(m[1])?.[1],
          /\bcy="([^"]*)"/.exec(m[1])?.[1],
          /\br="([^"]*)"/.exec(m[1])?.[1],
        ),
      ),
    };
  }
  return result;
}

// 試作の MODULES の機能名を、並び（HUD のセグメントの並び）の順に読む。
function prototypeModuleNames(): string[] {
  const source = readFileSync(PROTOTYPE, "utf8");
  const block = /const MODULES[^=]*=\s*\[([\s\S]*?)\n\];/.exec(source);
  if (block === null) throw new Error("試作の MODULES が読めない");
  return [...block[1].matchAll(/\bname:\s*"([^"]*)"/g)].map((m) => m[1]);
}

function circleKey(
  cx: string | null | undefined,
  cy: string | null | undefined,
  r: string | null | undefined,
): string {
  return `${Number(cx ?? 0)} ${Number(cy ?? 0)} ${Number(r)}`;
}

// 描いたアイコン（svg）の path の d と circle の属性を、描いた順に読む。
function drawnIcon(svg: SVGSVGElement): PrototypeIcon {
  return {
    paths: [...svg.querySelectorAll("path")].map(
      (path) => path.getAttribute("d") ?? "",
    ),
    circles: [...svg.querySelectorAll("circle")].map((circle) =>
      circleKey(
        circle.getAttribute("cx"),
        circle.getAttribute("cy"),
        circle.getAttribute("r"),
      ),
    ),
  };
}

// セグメントの中のアイコン（viewBox 0 0 32 32 の svg）。
function segmentIcon(segment: HTMLElement): SVGSVGElement {
  const svg = segment.querySelector<SVGSVGElement>('svg[viewBox="0 0 32 32"]');
  if (svg === null) throw new Error("セグメントにアイコンが無い");
  return svg;
}

function cardIcon(key: string): SVGSVGElement {
  const svg = screen
    .getByTestId(`card-${key}`)
    .querySelector<SVGSVGElement>("svg");
  if (svg === null) throw new Error(`カード ${key} にアイコンが無い`);
  return svg;
}

// HUD のセグメント（HUD の輪の中の、押せるもの）。
function segments(): HTMLElement[] {
  return within(screen.getByTestId("hud-ring")).getAllByRole("button");
}

// 未読の週報の数が 2（TC143 の前提）。そのほかの数は Research の数と紛れない値にする。
const HOME: HomeWithResearch = {
  newCount: 12,
  unreadCount: 18,
  learning: { contentId: 7, learningTheme: "文型", isCompleted: false },
  ai: { writingCount: 5, hasFailure: false },
  picks: [],
  notices: [],
  research: { unreadCount: 2 },
};

// 機能の画面へ移った道（A03）。止められずに押された道（a 要素）を、押された順に記録する。
let navigations: string[] = [];
function recordNavigation(event: MouseEvent) {
  const anchor = (event.target as Element).closest("a");
  if (anchor !== null && !event.defaultPrevented) {
    navigations.push(anchor.getAttribute("href") ?? "");
  }
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    if (String(input) === "/api/app/home") return Response.json(HOME);
    throw new Error(`呼んではいけない API: ${String(input)}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  navigations = [];
  document.addEventListener("click", recordNavigation);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.removeEventListener("click", recordNavigation);
});

async function renderHome() {
  render(<HomeScreen now={new Date("2026-11-30T23:00:00.000Z")} />);
  await screen.findByRole("link", { name: "文型" });
}

describe("TC143 ホームの HUD の Research（BD-03 SCR-001-O01、O10。Q-095）", () => {
  it("HUD のセグメントが7つで、Research がある。並びは試作の7分割のまま", async () => {
    await renderHome();
    const names = segments().map((segment) =>
      segment.getAttribute("aria-label"),
    );
    expect(names).toHaveLength(7);
    expect(names).toContain("Research");
    expect(names).toEqual(prototypeModuleNames());
  });

  it("Research のセグメントのアイコンは虫眼鏡と折れ線（試作の researchB）で、Explore のアイコンと path が違う", async () => {
    await renderHome();
    const icons = prototypeIcons();
    expect(icons.researchB, "試作の researchB が読めない").toBeDefined();
    expect(icons.researchB.paths.length).toBeGreaterThan(0);

    const research = drawnIcon(
      segmentIcon(screen.getByRole("button", { name: "Research" })),
    );
    const explore = drawnIcon(
      segmentIcon(screen.getByRole("button", { name: "Explore" })),
    );
    expect(research.paths).toEqual(icons.researchB.paths);
    expect(research.circles).toEqual(icons.researchB.circles);
    expect(research.paths).not.toEqual(explore.paths);
    for (const d of research.paths) expect(explore.paths).not.toContain(d);
  });

  it("Research のカードのアイコンの path が、試作の researchB の path と同じで、Explore と違う", async () => {
    await renderHome();
    const icons = prototypeIcons();
    const research = drawnIcon(cardIcon("research"));
    expect(research.paths).toEqual(icons.researchB.paths);
    expect(research.circles).toEqual(icons.researchB.circles);
    expect(research.paths).not.toEqual(drawnIcon(cardIcon("explore")).paths);
  });

  it("Research のセグメントを選ぶと、Research のカードが前に出て「未読 2」を出す", async () => {
    await renderHome();
    fireEvent.click(screen.getByRole("button", { name: "Research" }));
    expect(screen.getByRole("button", { name: "Research" }).ariaPressed).toBe(
      "true",
    );
    const card = screen.getByTestId("card-research");
    expect(card.dataset.front).toBe("true");
    expect(within(card).getByText("Research")).toBeTruthy();
    expect(card.textContent?.replace(/\s+/g, " ")).toMatch(/未読 ?2(?!\d)/);
  });

  it("Research のカードの未読の数は research.unreadCount で、ほかの未読の数（unreadCount）ではない", async () => {
    await renderHome();
    const text = screen.getByTestId("card-research").textContent ?? "";
    expect(text).not.toMatch(/18/);
  });

  it("前の Research のカードを押すと、移る動きの後で /research（SCR-010）へ移る", async () => {
    await renderHome();
    fireEvent.click(screen.getByRole("button", { name: "Research" }));
    const link = screen.getByRole("link", { name: /^Research/ });
    expect(link.getAttribute("href")).toBe("/research");

    vi.useFakeTimers();
    fireEvent.click(link);
    act(() => {
      vi.advanceTimersByTime(
        LEAVE_STEP_MS.glow + LEAVE_STEP_MS.move + LEAVE_STEP_MS.expand,
      );
    });
    expect(navigations).toEqual(["/research"]);
  });
});
