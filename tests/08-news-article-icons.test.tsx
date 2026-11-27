// @vitest-environment jsdom
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { createElement, type ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import NewsRoute from "../src/app/(screens)/news/page";
import type { ArticleDetail, Galaxy, GalaxyNode } from "../src/contracts/news";
import { NewsGalaxyScreen } from "../src/screens/news/galaxy-screen";
import type { BottomSheet as BottomSheetType } from "../src/ui/bottom-sheet";
import { installReactFlowStubs } from "./fixtures/react-flow";
import {
  compiledGlobals,
  PRESSABLE_SELECTOR,
  smallPressables,
} from "./fixtures/tap-size";

// 08-news の実装単位6（BD-03 SCR-003、BD-09 4章、DD-01 M03・M08、CR-018）。記事の案内（SCR-003）を
// 下から出す面を暗い面（M07 の BottomSheet の tone="hud"）にし、「読んだ」「未読に戻す」（本）、
// 「保存」「保存を外す」（ブックマーク）、「AI に質問」（吹き出し）をアイコンのボタンにする。
// 受け入れ基準:
// - 記事の案内の面が tone="hud" で出る。
// - 既読・保存・AI に質問のボタンに文字が無く、ボタンの名前がそれぞれ「読んだ」か「未読に戻す」、
//   「保存」か「保存を外す」、「AI に質問」である。
// - 既読の記事では本のアイコンが塗られ、未読では塗られない。
// - 保存した記事ではブックマークのアイコンが塗られ、保存していない記事では塗られない。
// - 操作に失敗したときの MSG-003 の操作の名前が今と変わらない（「既読に」「未読に戻す」「保存」「保存を外す」）。
// - 灰色の文字（text-gray-*）を使っていない。
// - 押す場所が全て 44 ピクセル四方以上である。
// 下から出す面（News Galaxy から開く）と全画面（/news?article={contentId}）の両方で確かめる。
//
// 「塗る」の読み方: ボタンの中の SVG の図形（path、circle、rect、ellipse、polygon、polyline）の
// 実際の fill（自分か祖先の fill の属性・style・Tailwind の fill-* の class。何も無ければ SVG の
// 決まりの黒）が none・transparent でなく、fill-opacity が 0 でない図形が1つでもあれば「塗られている」、
// 1つも無ければ「塗られていない」とする。

const ROOT = resolve(__dirname, "..");
const NOW = new Date("2026-11-30T23:00:00.000Z"); // 日本時間 2026-12-01 08:00

// 下から出る面に渡された props を残す（中身は本物の BottomSheet で描く）。
const sheetCalls = vi.hoisted(
  () => [] as { title: string; open: boolean; tone?: string }[],
);

vi.mock("../src/ui/bottom-sheet", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/ui/bottom-sheet")>();
  function RecordingBottomSheet(props: ComponentProps<typeof BottomSheetType>) {
    sheetCalls.push({ title: props.title, open: props.open, tone: props.tone });
    return createElement(actual.BottomSheet, props);
  }
  return { ...actual, BottomSheet: RecordingBottomSheet };
});

vi.mock("next/navigation", () => {
  const router = {
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  };
  return {
    useRouter: () => router,
    usePathname: () => "/news",
    useSearchParams: () => new URLSearchParams(),
  };
});

function node(overrides: Partial<GalaxyNode> & { contentId: number }) {
  return {
    title: `記事 ${overrides.contentId}`,
    theme: "AI",
    imageUrl: "https://example.com/image.jpg",
    targetDate: "2026-12-01",
    isNew: true,
    isRead: false,
    ...overrides,
  } satisfies GalaxyNode;
}

// 未読で保存していない記事と、既読で保存した記事。互いに関係のある記事にする。
const UNREAD = node({ contentId: 1, title: "未読の記事" });
const READ = node({
  contentId: 2,
  title: "既読の記事",
  isRead: true,
  isNew: false,
});

const GALAXY: Galaxy = {
  date: "2026-12-01",
  availableDates: ["2026-12-01"],
  themes: ["AI"],
  nodes: [UNREAD, READ],
  links: [{ fromContentId: 1, toContentId: 2, relationType: "follow_up" }],
};

function detailOf(
  base: GalaxyNode,
  isSaved: boolean,
  other: GalaxyNode,
): ArticleDetail {
  return {
    contentId: base.contentId,
    title: base.title,
    theme: base.theme,
    guideMd: `${base.title} の案内`,
    sourceUrl: `https://example.com/news/${base.contentId}`,
    imageUrl: base.imageUrl,
    targetDate: base.targetDate,
    receivedAt: `${base.targetDate}T07:00:00.000+09:00`,
    state: {
      contentId: base.contentId,
      isNew: base.isNew,
      isRead: base.isRead,
      isSaved,
      savedAt: isSaved ? "2026-12-01T07:30:00.000+09:00" : null,
    },
    related: [
      {
        node: other,
        relationType: "follow_up",
        reason: `${other.title} とつながる`,
        direction: base.contentId === 1 ? "from" : "to",
      },
    ],
  };
}

const DETAILS: Record<number, ArticleDetail> = {
  1: detailOf(UNREAD, false, READ),
  2: detailOf(READ, true, UNREAD),
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// 図、案内、開いた日時、既読、保存の API。`failState` が true なら既読と保存の操作は 500 を返す。
function stubApi({ failState = false }: { failState?: boolean } = {}): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const body = typeof init?.body === "string" ? init.body : "{}";
      if (method === "GET" && url.startsWith("/api/app/news/galaxy"))
        return jsonResponse(GALAXY);
      const article = url.match(/^\/api\/app\/news\/articles\/(\d+)$/);
      if (method === "GET" && article && DETAILS[Number(article[1])])
        return jsonResponse(DETAILS[Number(article[1])]);
      const opened = url.match(/^\/api\/app\/contents\/(\d+)\/opened$/);
      if (method === "POST" && opened && DETAILS[Number(opened[1])])
        return jsonResponse({
          ...DETAILS[Number(opened[1])].state,
          isNew: false,
        });
      const state = url.match(/^\/api\/app\/contents\/(\d+)\/(read|saved)$/);
      if (method === "PUT" && state && DETAILS[Number(state[1])]) {
        if (failState) return jsonResponse({}, 500);
        const current = DETAILS[Number(state[1])].state;
        const change = JSON.parse(body) as {
          isRead?: boolean;
          isSaved?: boolean;
        };
        return jsonResponse({
          ...current,
          isNew: false,
          ...(change.isRead !== undefined ? { isRead: change.isRead } : {}),
          ...(change.isSaved !== undefined
            ? {
                isSaved: change.isSaved,
                savedAt: change.isSaved
                  ? "2026-12-01T08:00:00.000+09:00"
                  : null,
              }
            : {}),
        });
      }
      throw new Error(`知らない呼び出し: ${method} ${url}`);
    }),
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  installReactFlowStubs();
  sheetCalls.length = 0;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// ---- 開き方（下から出る面と全画面） ----

type Mode = "sheet" | "full";

// 記事の案内を開き、案内の置き場所（面か全画面の本文）を返す。
async function openArticle(mode: Mode, contentId: 1 | 2): Promise<HTMLElement> {
  const title = DETAILS[contentId].title;
  if (mode === "sheet") {
    render(<NewsGalaxyScreen />);
    await screen.findByText(title);
    fireEvent.click(screen.getByText(title));
    const sheet = await screen.findByRole("dialog", { name: "記事の案内" });
    await within(sheet).findByText(`${title} の案内`);
    return sheet;
  }
  const element = await NewsRoute({
    searchParams: Promise.resolve({ article: String(contentId) }),
  });
  const { container } = render(element);
  await screen.findByText(`${title} の案内`);
  return container;
}

// ---- アイコンのボタンの読み方 ----

const SHAPES = "path, circle, rect, ellipse, polygon, polyline";

// 図形の実際の fill が塗りか。自分から svg までの祖先の fill（style、属性、fill-* の class）を見る。
function paintsFill(shape: Element, svg: Element): boolean {
  let opacity: string | null = null;
  for (let cur: Element | null = shape; cur; cur = cur.parentElement) {
    const style = (cur as SVGElement).style;
    opacity ??=
      style?.getPropertyValue("fill-opacity") ||
      cur.getAttribute("fill-opacity") ||
      null;
    const fill =
      style?.getPropertyValue("fill") ||
      cur.getAttribute("fill") ||
      ([...cur.classList].find((name) => /^fill-[^:]+$/.test(name)) ?? null);
    if (fill !== null) {
      if (opacity !== null && Number(opacity) === 0) return false;
      return !["none", "transparent", "fill-none", "fill-transparent"].includes(
        fill.trim(),
      );
    }
    if (cur === svg) break;
  }
  // 何も書いていなければ SVG の決まりの黒で塗る。
  return !(opacity !== null && Number(opacity) === 0);
}

function iconOf(button: HTMLElement): SVGSVGElement {
  const svgs = button.querySelectorAll("svg");
  expect(svgs.length, "ボタンの中に SVG のアイコンが1つある").toBe(1);
  return svgs[0];
}

function isFilled(button: HTMLElement): boolean {
  const svg = iconOf(button);
  const shapes = [...svg.querySelectorAll(SHAPES)];
  expect(shapes.length, "アイコンに図形がある").toBeGreaterThan(0);
  return shapes.some((shape) => paintsFill(shape, svg));
}

// SVG を除いた、ボタンの中の文字。
function textOutsideIcon(button: HTMLElement): string {
  const clone = button.cloneNode(true) as HTMLElement;
  for (const svg of clone.querySelectorAll("svg")) svg.remove();
  return clone.textContent?.trim() ?? "";
}

// 名前が `name` のアイコンのボタン。名前は aria-label で付け、文字を出さず、SVG を部品の中に書く。
function iconButton(place: HTMLElement, name: string): HTMLElement {
  const button = within(place).getByRole("button", { name });
  expect(button.getAttribute("aria-label")).toBe(name);
  expect(textOutsideIcon(button)).toBe("");
  expect(button.querySelector("img")).toBeNull();
  for (const use of button.querySelectorAll("use")) {
    const href = use.getAttribute("href") ?? use.getAttribute("xlink:href");
    expect(href ?? "#").toMatch(/^#/);
  }
  iconOf(button);
  return button;
}

// ---- 記事の案内の面の色 ----

describe("記事の案内の面（M07 の BottomSheet）", () => {
  it('News Galaxy から開く記事の案内の面が tone="hud" で出る', async () => {
    stubApi();
    await openArticle("sheet", 1);
    const opened = sheetCalls.filter(
      (call) => call.title === "記事の案内" && call.open,
    );
    expect(opened.length).toBeGreaterThan(0);
    for (const call of opened) expect(call.tone).toBe("hud");
  });
});

// ---- アイコンのボタン ----

describe.each<[Mode, string]>([
  ["sheet", "下から出る面"],
  ["full", "全画面（/news?article={contentId}）"],
])("記事の案内のアイコンのボタン（%s: %s）", (mode) => {
  it("未読で保存していない記事: ボタンに文字が無く、名前が「読んだ」「保存」「AI に質問」で、本とブックマークのアイコンは塗られない", async () => {
    stubApi();
    const place = await openArticle(mode, 1);
    const read = iconButton(place, "読んだ");
    const save = iconButton(place, "保存");
    iconButton(place, "AI に質問");
    expect(
      within(place).queryByRole("button", { name: "未読に戻す" }),
    ).toBeNull();
    expect(
      within(place).queryByRole("button", { name: "保存を外す" }),
    ).toBeNull();
    expect(isFilled(read)).toBe(false);
    expect(isFilled(save)).toBe(false);
  });

  it("既読で保存した記事: ボタンに文字が無く、名前が「未読に戻す」「保存を外す」「AI に質問」で、本とブックマークのアイコンが塗られる", async () => {
    stubApi();
    const place = await openArticle(mode, 2);
    const unread = iconButton(place, "未読に戻す");
    const unsave = iconButton(place, "保存を外す");
    iconButton(place, "AI に質問");
    expect(within(place).queryByRole("button", { name: "読んだ" })).toBeNull();
    expect(within(place).queryByRole("button", { name: "保存" })).toBeNull();
    expect(isFilled(unread)).toBe(true);
    expect(isFilled(unsave)).toBe(true);
  });

  it("「読んだ」「保存」を押すと、名前が「未読に戻す」「保存を外す」に替わり、アイコンが塗られる。もう一度押すと戻る", async () => {
    stubApi();
    const place = await openArticle(mode, 1);

    fireEvent.click(iconButton(place, "読んだ"));
    const unread = await within(place).findByRole("button", {
      name: "未読に戻す",
    });
    expect(isFilled(iconButton(place, "未読に戻す"))).toBe(true);
    fireEvent.click(unread);
    await within(place).findByRole("button", { name: "読んだ" });
    expect(isFilled(iconButton(place, "読んだ"))).toBe(false);

    fireEvent.click(iconButton(place, "保存"));
    const unsave = await within(place).findByRole("button", {
      name: "保存を外す",
    });
    expect(isFilled(iconButton(place, "保存を外す"))).toBe(true);
    fireEvent.click(unsave);
    await within(place).findByRole("button", { name: "保存" });
    expect(isFilled(iconButton(place, "保存"))).toBe(false);
  });
});

// ---- MSG-003 の操作の名前 ----

describe.each<[Mode]>([["sheet"], ["full"]])(
  "操作に失敗したときの MSG-003（%s）",
  (mode) => {
    it.each<[1 | 2, string, string]>([
      [1, "読んだ", "既読にできませんでした。もう一度押してください。"],
      [2, "未読に戻す", "未読に戻すできませんでした。もう一度押してください。"],
      [1, "保存", "保存できませんでした。もう一度押してください。"],
      [2, "保存を外す", "保存を外すできませんでした。もう一度押してください。"],
    ])(
      "記事 %s で「%s」に失敗すると「%s」を出し、ボタンの名前は変わらない",
      async (contentId, name, message) => {
        stubApi({ failState: true });
        const place = await openArticle(mode, contentId);
        fireEvent.click(iconButton(place, name));
        expect(await screen.findByText(message)).toBeTruthy();
        await waitFor(() =>
          expect(
            (within(place).getByRole("button", { name }) as HTMLButtonElement)
              .disabled,
          ).toBe(false),
        );
      },
    );
  },
);

// ---- 灰色の文字 ----

function grayClasses(place: HTMLElement): string[] {
  return [place, ...place.querySelectorAll<HTMLElement>("*")].flatMap(
    (element) =>
      [...element.classList].filter((name) => /(^|:)text-gray-/.test(name)),
  );
}

describe("灰色の文字（text-gray-*）", () => {
  it.each<[Mode, 1 | 2]>([
    ["sheet", 1],
    ["sheet", 2],
    ["full", 1],
    ["full", 2],
  ])(
    "%s で記事 %s を開いたとき、案内の中に text-gray-* が無い",
    async (mode, id) => {
      stubApi();
      const place = await openArticle(mode, id);
      expect(grayClasses(place)).toEqual([]);
    },
  );

  it("記事の案内の部品（M03 の記事の案内、M08 のニュースの部品）のソースに text-gray-* が無い", () => {
    const files = [
      ...readdirSync(join(ROOT, "src/screens/news"))
        .filter((name) => /^(article-|ask-ai)/.test(name))
        .map((name) => join(ROOT, "src/screens/news", name)),
      ...readdirSync(join(ROOT, "src/ui/kinds/news")).map((name) =>
        join(ROOT, "src/ui/kinds/news", name),
      ),
    ];
    expect(files.length).toBeGreaterThan(0);
    const found = files.filter((file) =>
      /(^|[\s"'`:])text-gray-/.test(readFileSync(file, "utf8")),
    );
    expect(found).toEqual([]);
  });
});

// ---- 押す場所の大きさ ----

describe("押す場所の大きさ（BD-09 5章）", () => {
  it.each<[Mode, 1 | 2]>([
    ["sheet", 1],
    ["sheet", 2],
    ["full", 1],
    ["full", 2],
  ])(
    "%s で記事 %s を開いたとき、案内の押す場所が全て 44 ピクセル四方以上である",
    async (mode, id) => {
      stubApi();
      const place = await openArticle(mode, id);
      const root = await compiledGlobals();
      const targets = [
        ...place.querySelectorAll<HTMLElement>(PRESSABLE_SELECTOR),
      ];
      // 少なくとも、既読・保存・AI に質問、元の記事を開く、関係のある記事がある。
      expect(targets.length).toBeGreaterThanOrEqual(5);
      expect(targets).toContain(
        within(place).getByRole("button", { name: "AI に質問" }),
      );
      expect(
        targets.some((element) => element.textContent?.includes("とつながる")),
      ).toBe(true);
      expect(smallPressables(root, targets)).toEqual([]);
    },
  );
});
