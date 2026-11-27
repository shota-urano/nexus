// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import tailwindcss from "@tailwindcss/postcss";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import postcss, { type Root } from "postcss";
import { isValidElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ArticleDetail, Galaxy, GalaxyNode } from "../src/contracts/news";
import { NewsGalaxyScreen } from "../src/screens/news/galaxy-screen";
import { BottomSheet } from "../src/ui/bottom-sheet";
import { installReactFlowStubs } from "./fixtures/react-flow";

// 08-news の実装単位4（BD-03 SCR-002・SCR-003、BD-09 5章、DD-01 M03・M07）。
// 記事の案内を下から出す面で開いている間に、面の中をスクロールしても後ろの図が動かないようにする。
// 受け入れ基準:
// - 下から出る面（M07 の BottomSheet）のスクロールする部分の overscroll-behavior が contain である。
// - html と body の overscroll-behavior が none である。
// - 記事の案内の面を開いている間、図（React Flow）の指でずらす操作と拡大縮小が切られている。
// - 記事の案内の面を閉じると、図を指でずらす操作と拡大縮小が元に戻る。
// - 記事の案内を読んで関係のある記事が図に足されても、図を画面に合わせ直す処理を呼ばない。
//
// 図の部品（@xyflow/react）は本物を使い、ReactFlow に渡した設定と、useReactFlow の fitView を
// 呼んだことだけを記録する。

const recorded = vi.hoisted(() => ({
  flowProps: [] as Record<string, unknown>[],
  fitView: [] as unknown[][],
}));

vi.mock("@xyflow/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@xyflow/react")>();
  const React = await import("react");
  function RecordingReactFlow(props: Record<string, unknown>) {
    recorded.flowProps.push(props);
    return React.createElement(
      actual.ReactFlow as unknown as React.FC<Record<string, unknown>>,
      props,
    );
  }
  function useRecordingReactFlow() {
    const instance = actual.useReactFlow();
    return React.useMemo(
      () => ({
        ...instance,
        fitView: (...args: Parameters<typeof instance.fitView>) => {
          recorded.fitView.push(args);
          return instance.fitView(...args);
        },
      }),
      [instance],
    );
  }
  return {
    ...actual,
    ReactFlow: RecordingReactFlow,
    useReactFlow: useRecordingReactFlow,
  };
});

// 根の layout は要求ごとに描くため `connection()` を待つ。テストでは待たずに進める。
vi.mock("next/server", () => ({ connection: async () => undefined }));

const ROOT = resolve(__dirname, "..");
const GLOBALS_CSS = join(ROOT, "src/app/globals.css");
const NOW = new Date("2026-11-30T23:00:00.000Z"); // 日本時間 2026-12-01 08:00

// ---- 組み上がった CSS（Tailwind を通した src/app/globals.css） ----

let compiled: Promise<Root> | null = null;
function compiledGlobals(): Promise<Root> {
  compiled ??= postcss([tailwindcss({ base: ROOT })])
    .process(readFileSync(GLOBALS_CSS, "utf8"), { from: GLOBALS_CSS })
    .then((result) => result.root);
  return compiled;
}

function unescapeSelector(selector: string): string {
  return selector.replace(/\\(.)/g, "$1");
}

// 画面の幅や状態に依らずに当たる規則か（@media、@supports、@container の中ではない）。
function isUnconditional(rule: { parent?: unknown }): boolean {
  let parent = rule.parent as
    { type?: string; name?: string; parent?: unknown } | undefined;
  while (parent && parent.type !== "root") {
    if (parent.type === "atrule" && parent.name !== "layer") return false;
    if (parent.type === "rule") return false;
    parent = parent.parent as typeof parent;
  }
  return true;
}

type Decl = { prop: string; value: string };

// 選ぶ子（`html`、`.name` など）のどれかに当たる規則の宣言を、CSS の順に返す。
function declarationsFor(root: Root, targets: Set<string>): Decl[] {
  const found: Decl[] = [];
  root.walkRules((rule) => {
    if (!isUnconditional(rule)) return;
    const selectors = rule.selectors.map((s) => unescapeSelector(s.trim()));
    if (!selectors.some((s) => targets.has(s))) return;
    rule.each((node) => {
      if (node.type === "decl")
        found.push({ prop: node.prop, value: node.value.trim() });
    });
  });
  return found;
}

// 宣言を順に当てたときの値（後に書いたものが勝つ。!important は後で当てる）。
type Overscroll = { x: string | null; y: string | null };
function overscrollOf(decls: Decl[]): Overscroll {
  const result: Overscroll = { x: null, y: null };
  const ordered = [
    ...decls.filter((d) => !/!important$/.test(d.value)),
    ...decls.filter((d) => /!important$/.test(d.value)),
  ];
  for (const { prop, value } of ordered) {
    const v = value.replace(/\s*!important$/, "").trim();
    if (prop === "overscroll-behavior") {
      const [first, second] = v.split(/\s+/);
      result.x = first;
      result.y = second ?? first;
    } else if (
      prop === "overscroll-behavior-x" ||
      prop === "overscroll-behavior-inline"
    ) {
      result.x = v;
    } else if (
      prop === "overscroll-behavior-y" ||
      prop === "overscroll-behavior-block"
    ) {
      result.y = v;
    }
  }
  return result;
}

function overflowYOf(decls: Decl[]): string | null {
  let value: string | null = null;
  for (const { prop, value: raw } of decls) {
    const v = raw.replace(/\s*!important$/, "").trim();
    if (prop === "overflow") {
      const parts = v.split(/\s+/);
      value = parts[1] ?? parts[0];
    } else if (prop === "overflow-y" || prop === "overflow-block") {
      value = v;
    }
  }
  return value;
}

// 要素に当たる宣言（class の規則、その後に要素に直に書いた style）。
function elementDeclarations(root: Root, element: HTMLElement): Decl[] {
  const targets = new Set<string>(
    [...element.classList].map((name) => `.${name}`),
  );
  const decls = declarationsFor(root, targets);
  for (let i = 0; i < element.style.length; i += 1) {
    const prop = element.style.item(i);
    decls.push({ prop, value: element.style.getPropertyValue(prop) });
  }
  return decls;
}

// 面の中で、縦にスクロールする部分（overflow-y が auto か scroll）。
function scrollParts(root: Root, sheet: HTMLElement): HTMLElement[] {
  return [sheet, ...sheet.querySelectorAll<HTMLElement>("*")].filter((el) => {
    const overflow = overflowYOf(elementDeclarations(root, el));
    return overflow === "auto" || overflow === "scroll";
  });
}

// ---- 根の layout（src/app/layout.tsx）が描く html と body ----

type El = { type: unknown; props: Record<string, unknown> };

async function rootLayoutTree(): Promise<El> {
  const mod = (await import("../src/app/layout")) as {
    default: (props: { children: ReactNode }) => unknown;
  };
  const tree = await mod.default({ children: null });
  if (!isValidElement(tree)) throw new Error("根の layout が要素を返さない");
  return tree as unknown as El;
}

function walk(node: unknown, visit: (el: El) => void): void {
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit);
    return;
  }
  if (!isValidElement(node)) return;
  const el = node as unknown as El;
  visit(el);
  if (typeof el.type === "string") walk(el.props.children, visit);
}

function kebab(name: string): string {
  return name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

// html か body に当たる宣言（要素の選ぶ子、付けた class の規則、直に書いた style の順）。
async function rootElementDeclarations(
  element: "html" | "body",
): Promise<Decl[]> {
  const root = await compiledGlobals();
  const classNames: string[] = [];
  const inline: Decl[] = [];
  walk(await rootLayoutTree(), (el) => {
    if (el.type !== element) return;
    const cls = el.props.className;
    if (typeof cls === "string")
      classNames.push(...cls.split(/\s+/).filter(Boolean));
    const style = el.props.style;
    if (style && typeof style === "object") {
      for (const [key, value] of Object.entries(style)) {
        inline.push({ prop: kebab(key), value: String(value) });
      }
    }
  });
  const elementTargets = new Set<string>([element]);
  if (element === "html") elementTargets.add(":root");
  const classTargets = new Set(classNames.map((name) => `.${name}`));
  return [
    ...declarationsFor(root, elementTargets),
    ...declarationsFor(root, classTargets),
    ...inline,
  ];
}

// ---- News Galaxy の応答 ----

function node(overrides: Partial<GalaxyNode> & { contentId: number }) {
  return {
    title: `記事 ${overrides.contentId}`,
    theme: "AI",
    imageUrl: null,
    targetDate: "2026-12-01",
    isNew: true,
    isRead: false,
    ...overrides,
  } satisfies GalaxyNode;
}

const A1 = node({ contentId: 1, title: "今日の記事 A1" });
const A2 = node({ contentId: 2, title: "今日の記事 A2" });
// 図には無く、A1 の案内を読むと足される記事。
const R7 = node({
  contentId: 7,
  title: "関係の先の記事 R7",
  targetDate: "2026-11-28",
});

const GALAXY: Galaxy = {
  date: "2026-12-01",
  availableDates: ["2026-12-01"],
  themes: ["AI"],
  nodes: [A1, A2],
  links: [{ fromContentId: 1, toContentId: 2, relationType: "follow_up" }],
};

const A1_DETAIL: ArticleDetail = {
  contentId: 1,
  title: A1.title,
  theme: A1.theme,
  guideMd: `${A1.title} の案内\n\n${"長い案内の本文。".repeat(200)}`,
  sourceUrl: "https://example.com/news/1",
  imageUrl: null,
  targetDate: A1.targetDate,
  receivedAt: "2026-12-01T07:00:00.000+09:00",
  state: {
    contentId: 1,
    isNew: true,
    isRead: false,
    isSaved: false,
    savedAt: null,
  },
  related: [
    {
      node: R7,
      relationType: "background",
      reason: "R7 は A1 の背景",
      direction: "from",
    },
  ],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// 記事の案内（getArticle）の応答を返す時を、テストが決められるようにする。
function stubNewsApi(): { releaseArticle: () => void } {
  let release: () => void = () => undefined;
  const articleGate = new Promise<void>((resolveGate) => {
    release = resolveGate;
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const key = `${init?.method ?? "GET"} ${String(input)}`;
      if (key === "GET /api/app/news/galaxy") return jsonResponse(GALAXY);
      if (key === "GET /api/app/news/articles/1") {
        await articleGate;
        return jsonResponse(A1_DETAIL);
      }
      if (key === "POST /api/app/contents/1/opened") {
        return jsonResponse({ ...A1_DETAIL.state, isNew: false });
      }
      throw new Error(`知らない呼び出し: ${key}`);
    }),
  );
  return { releaseArticle: () => release() };
}

function graphTitles(): string[] {
  return screen
    .queryAllByTestId("news-node")
    .map((element) => element.querySelector("p")?.textContent ?? "");
}

function lastFlowProps(): Record<string, unknown> {
  const props = recorded.flowProps.at(-1);
  if (!props) throw new Error("図（ReactFlow）が描かれていない");
  return props;
}

// 指でずらす操作と拡大縮小にかかわる ReactFlow の設定。
const GESTURE_PROPS = [
  "panOnDrag",
  "zoomOnPinch",
  "zoomOnScroll",
  "zoomOnDoubleClick",
  "panOnScroll",
] as const;

function gestureProps(props: Record<string, unknown>) {
  return Object.fromEntries(GESTURE_PROPS.map((name) => [name, props[name]]));
}

// 待っている setTimeout（図を画面に合わせる処理など）を先に進める。
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 50));
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  installReactFlowStubs();
  recorded.flowProps.length = 0;
  recorded.fitView.length = 0;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// ---- テスト ----

describe("下から出る面（M07 の BottomSheet）のスクロールする部分（BD-09 5章）", () => {
  for (const tone of ["plain", "hud"] as const) {
    for (const expanded of [false, true]) {
      it(`tone=${tone}、${expanded ? "広げたとき" : "広げる前"}: スクロールする部分の overscroll-behavior が contain である`, async () => {
        const root = await compiledGlobals();
        render(
          <BottomSheet
            open
            title="記事の案内"
            onClose={() => undefined}
            tone={tone}
          >
            <p>{"長い本文。".repeat(500)}</p>
          </BottomSheet>,
        );
        const sheet = screen.getByRole("dialog", { name: "記事の案内" });
        if (expanded) {
          fireEvent.click(
            within(sheet).getByRole("button", { name: "面を広げる" }),
          );
          await waitFor(() => expect(sheet.dataset.expanded).toBe("true"));
        }
        const parts = scrollParts(root, sheet);
        expect(parts.length).toBeGreaterThan(0);
        for (const part of parts) {
          expect(overscrollOf(elementDeclarations(root, part))).toEqual({
            x: "contain",
            y: "contain",
          });
        }
      });
    }
  }

  it("News Galaxy の記事の案内の面でも、スクロールする部分の overscroll-behavior が contain である", async () => {
    const root = await compiledGlobals();
    const { releaseArticle } = stubNewsApi();
    releaseArticle();
    render(<NewsGalaxyScreen />);
    fireEvent.click(await screen.findByText("今日の記事 A1"));
    const sheet = await screen.findByRole("dialog", { name: "記事の案内" });
    await within(sheet).findByText("今日の記事 A1 の案内", { exact: false });
    const parts = scrollParts(root, sheet);
    expect(parts.length).toBeGreaterThan(0);
    for (const part of parts) {
      expect(overscrollOf(elementDeclarations(root, part))).toEqual({
        x: "contain",
        y: "contain",
      });
    }
  });
});

describe("ページ全体を弾ませない（html と body）", () => {
  it("html の overscroll-behavior が none である", async () => {
    expect(overscrollOf(await rootElementDeclarations("html"))).toEqual({
      x: "none",
      y: "none",
    });
  });

  it("body の overscroll-behavior が none である", async () => {
    expect(overscrollOf(await rootElementDeclarations("body"))).toEqual({
      x: "none",
      y: "none",
    });
  });
});

describe("記事の案内の面を開いている間、後ろの図を指でずらす操作と拡大縮小を受け付けない（SCR-002、SCR-003）", () => {
  it("面を開く前は図の指でずらす操作と拡大縮小が使え、開いている間は切られ、閉じると元に戻る", async () => {
    const { releaseArticle } = stubNewsApi();
    releaseArticle();
    render(<NewsGalaxyScreen />);
    await screen.findByText("今日の記事 A1");
    await settle();

    // 開く前: 指でずらす操作と拡大縮小を切っていない。
    const before = gestureProps(lastFlowProps());
    expect(before.panOnDrag).not.toBe(false);
    expect(before.zoomOnPinch).not.toBe(false);
    expect(before.zoomOnScroll).not.toBe(false);
    expect(before.zoomOnDoubleClick).not.toBe(false);

    // 開いている間: 指でずらす操作と、拡大縮小（つまむ、スクロール、2回押す）を切る。
    // スクロールで図をずらす操作も受け付けない。
    fireEvent.click(screen.getByText("今日の記事 A1"));
    const sheet = await screen.findByRole("dialog", { name: "記事の案内" });
    await within(sheet).findByText("今日の記事 A1 の案内", { exact: false });
    await settle();
    const during = gestureProps(lastFlowProps());
    expect(during.panOnDrag).toBe(false);
    expect(during.zoomOnPinch).toBe(false);
    expect(during.zoomOnScroll).toBe(false);
    expect(during.zoomOnDoubleClick).toBe(false);
    expect(during.panOnScroll).not.toBe(true);

    // 閉じた後: 開く前と同じに戻る。
    fireEvent.click(within(sheet).getByRole("button", { name: "閉じる" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "記事の案内" })).toBeNull(),
    );
    await settle();
    const after = gestureProps(lastFlowProps());
    expect(after).toEqual(before);
  });

  it("案内の読み込みを待っている間も、図の指でずらす操作と拡大縮小が切られている", async () => {
    stubNewsApi(); // 案内の応答は返さないまま
    render(<NewsGalaxyScreen />);
    await screen.findByText("今日の記事 A1");
    fireEvent.click(screen.getByText("今日の記事 A1"));
    await screen.findByRole("dialog", { name: "記事の案内" });
    await settle();
    const during = gestureProps(lastFlowProps());
    expect(during.panOnDrag).toBe(false);
    expect(during.zoomOnPinch).toBe(false);
    expect(during.zoomOnScroll).toBe(false);
    expect(during.zoomOnDoubleClick).toBe(false);
    expect(during.panOnScroll).not.toBe(true);
  });
});

describe("関係のある記事を足しただけのときは、図を画面に合わせ直さない（SCR-002、DD-02 FN-003 手順 5）", () => {
  it("記事を押して中心が替わると図を画面に合わせ、その後に案内を読んで関係のある記事が足されても合わせ直さない", async () => {
    const { releaseArticle } = stubNewsApi();
    render(<NewsGalaxyScreen />);
    await screen.findByText("今日の記事 A1");
    await settle();

    // 中心の記事が替わったときは、図を画面に合わせる（この記録が効いていることの確かめ）。
    recorded.fitView.length = 0;
    fireEvent.click(screen.getByText("今日の記事 A1"));
    await screen.findByRole("dialog", { name: "記事の案内" });
    await waitFor(() => expect(recorded.fitView.length).toBeGreaterThan(0));
    await settle();
    expect(graphTitles()).not.toContain("関係の先の記事 R7");

    // 案内が届き、関係のある記事 R7 が図に足される。
    recorded.fitView.length = 0;
    releaseArticle();
    await waitFor(() => expect(graphTitles()).toContain("関係の先の記事 R7"));
    await settle();
    await settle();

    expect(recorded.fitView).toEqual([]);
    // 中心は A1 のまま。
    const centers = screen
      .getAllByTestId("news-node")
      .filter((element) => element.dataset.center === "true")
      .map((element) => element.querySelector("p")?.textContent);
    expect(centers).toEqual(["今日の記事 A1"]);
  });
});
