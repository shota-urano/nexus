// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import tailwindcss from "@tailwindcss/postcss";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import postcss, { type Root } from "postcss";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ArticleDetail, Galaxy, GalaxyNode } from "../src/contracts/news";
import { NewsGalaxyRoute } from "../src/app/(screens)/news/galaxy-route";
import { NewsGalaxyScreen } from "../src/screens/news/galaxy-screen";
import { installReactFlowStubs } from "./fixtures/react-flow";

// 08-news の実装単位5（BD-03 SCR-002、CR-018）。News Galaxy の上の帯から「AI に質問」（SCR-002-A05）を
// 外し、テーマ（SCR-002-I02）を件数付きの選択ボタンの並びにし、並びの先頭に「未読」の切り替え
// （SCR-002-I03、SCR-002-A06）を置く。
// CR-019（実装単位7）で、テーマは名前「テーマ」の選択欄に戻り、「未読」はテーマの選択欄から離した
// 「未読だけ」のスイッチ（role="switch"）になった。テーマのボタンの並びと「未読」の並びの中の位置を
// 求めていた確かめは CR-019 に合わせて書き直し、絞り込みの決まりの確かめはそのまま残す。
// 受け入れ基準:
// - 記事を選んでも、上の帯に「AI に質問」が出ない。
// - テーマの選択がボタンの並びで、ボタンに件数が出て、押したテーマの記事だけが図に出る。
// - 「未読」の切り替えに、選んだ日の記事のうち既読でない記事の数が出る。
// - 「未読」を押すと既読の記事のノードが図から消え、もう一度押すと戻る。
// - 「未読」とテーマを両方選ぶと、そのテーマの未読の記事だけが出る。
// - 「未読」を押しても getGalaxy を呼ばない。
// - 記事の案内で「読んだ」を押すと、未読の数が1つ減る。
// - 押す場所が全て 44 ピクセル四方以上である。
//
// 「未読だけ」のスイッチの名前は「未読だけ」と未読の数とし、名前の中の数字を未読の数として読む。
// 数字の前後の飾り（「件」や括弧）は問わない。テーマは選択欄の選択肢の文字で選ぶ。

const ROOT = resolve(__dirname, "..");
const GLOBALS_CSS = join(ROOT, "src/app/globals.css");
const NOW = new Date("2026-11-30T23:00:00.000Z"); // 日本時間 2026-12-01 08:00

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

// 選んだ日（12-01）の記事。AI が3件（うち既読1件）、半導体が2件（うち既読1件）。
const A1 = node({ contentId: 1, title: "記事A1 AI 未読" });
const A2 = node({ contentId: 2, title: "記事A2 AI 未読" });
const A3 = node({
  contentId: 3,
  title: "記事A3 AI 既読",
  isRead: true,
  isNew: false,
});
const S1 = node({
  contentId: 11,
  title: "記事S1 半導体 未読",
  theme: "半導体",
});
const S2 = node({
  contentId: 12,
  title: "記事S2 半導体 既読",
  theme: "半導体",
  isRead: true,
  isNew: false,
});

// 選んだ日の記事だけの図（テーマの件数を、選んだ日の記事の数と図のノードの数のどちらで数えても同じになる）。
const SAME_DAY: Galaxy = {
  date: "2026-12-01",
  availableDates: ["2026-12-01"],
  themes: ["AI", "半導体"],
  nodes: [A1, A2, A3, S1, S2],
  links: [
    { fromContentId: 1, toContentId: 2, relationType: "follow_up" },
    { fromContentId: 3, toContentId: 11, relationType: "background" },
  ],
};

// 関係の先の過去の記事（選んだ日の記事ではない）。未読の数には入れない。
const P1 = node({
  contentId: 21,
  title: "記事P1 過去 未読",
  targetDate: "2026-11-28",
});
const P2 = node({
  contentId: 22,
  title: "記事P2 過去 既読",
  theme: "半導体",
  targetDate: "2026-11-28",
  isRead: true,
  isNew: false,
});

const WITH_PAST: Galaxy = {
  ...SAME_DAY,
  availableDates: ["2026-12-01", "2026-11-28"],
  nodes: [...SAME_DAY.nodes, P1, P2],
  links: [
    ...SAME_DAY.links,
    { fromContentId: 1, toContentId: 21, relationType: "background" },
    { fromContentId: 12, toContentId: 22, relationType: "same_actor" },
  ],
};

function detailOf(base: GalaxyNode): ArticleDetail {
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
      isSaved: false,
      savedAt: null,
    },
    related: [],
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

type Call = { url: string; method: string; body: string | null };
let calls: Call[];

// 図と案内と既読の API。
function stubApi(galaxy: Galaxy): void {
  calls = [];
  const byId = new Map(galaxy.nodes.map((n) => [n.contentId, n]));
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const call = {
        url: String(input),
        method: init?.method ?? "GET",
        body: typeof init?.body === "string" ? init.body : null,
      };
      calls.push(call);
      if (call.method === "GET" && call.url.startsWith("/api/app/news/galaxy"))
        return jsonResponse(galaxy);
      const article = call.url.match(/^\/api\/app\/news\/articles\/(\d+)$/);
      if (call.method === "GET" && article) {
        const found = byId.get(Number(article[1]));
        if (found) return jsonResponse(detailOf(found));
      }
      const opened = call.url.match(/^\/api\/app\/contents\/(\d+)\/opened$/);
      if (call.method === "POST" && opened) {
        const found = byId.get(Number(opened[1]));
        if (found)
          return jsonResponse({ ...detailOf(found).state, isNew: false });
      }
      const read = call.url.match(/^\/api\/app\/contents\/(\d+)\/read$/);
      if (call.method === "PUT" && read) {
        const found = byId.get(Number(read[1]));
        const { isRead } = JSON.parse(call.body ?? "{}") as {
          isRead: boolean;
        };
        if (found)
          return jsonResponse({
            ...detailOf(found).state,
            isNew: false,
            isRead,
          });
      }
      throw new Error(`知らない呼び出し: ${call.method} ${call.url}`);
    }),
  );
}

function galaxyCalls(): Call[] {
  return calls.filter((call) => call.url.startsWith("/api/app/news/galaxy"));
}

function shownTitles(): string[] {
  return screen
    .queryAllByTestId("news-node")
    .map((element) => element.querySelector("p")?.textContent ?? "")
    .sort();
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// 名前が「{label}」と数字（件数）だけのボタン。数字の前後の飾りは問わない。
function countButtonPattern(label: string, count?: number): RegExp {
  const digits = count === undefined ? "\\d+" : String(count);
  return new RegExp(`^\\s*${escapeRegExp(label)}[^0-9]*${digits}[^0-9]*$`);
}

// テーマの選択欄（CR-019）。
function themeSelect(): HTMLSelectElement {
  return screen.getByRole("combobox", { name: "テーマ" }) as HTMLSelectElement;
}

// 選択欄で、選択肢の文字が label のものを選ぶ。
function chooseTheme(label: string): void {
  const select = themeSelect();
  const option = [...select.options].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (option === undefined) throw new Error(`テーマの選択肢が無い: ${label}`);
  fireEvent.change(select, { target: { value: option.value } });
}

// 「未読だけ」のスイッチ（CR-019）。
function unreadToggle(): HTMLElement {
  return screen.getByRole("switch", { name: countButtonPattern("未読だけ") });
}

function countIn(element: HTMLElement): number {
  const name = element.getAttribute("aria-label") ?? element.textContent ?? "";
  const digits = name.match(/\d+/g);
  if (digits === null || digits.length !== 1)
    throw new Error(`件数が読めない: ${name}`);
  return Number(digits[0]);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  installReactFlowStubs();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("上の帯（SCR-002-A05 は CR-018 でやめた）", () => {
  it("記事を選んでも、上の帯に「AI に質問」が出ない", async () => {
    stubApi(SAME_DAY);
    render(<NewsGalaxyRoute onAskAi={vi.fn()} />);
    await screen.findByText("記事A1 AI 未読");
    const header = screen.getByRole("banner");
    expect(
      within(header).queryByRole("button", { name: "AI に質問" }),
    ).toBeNull();

    fireEvent.click(screen.getByText("記事A1 AI 未読"));
    const sheet = await screen.findByRole("dialog", { name: "記事の案内" });
    await within(sheet).findByText("記事A1 AI 未読 の案内");
    // 記事の案内には「AI に質問」がある（SCR-003-A05）が、上の帯には出ない。
    expect(
      within(sheet).getByRole("button", { name: "AI に質問" }),
    ).toBeTruthy();
    expect(
      within(header).queryByRole("button", { name: "AI に質問", hidden: true }),
    ).toBeNull();
    expect(header.textContent).not.toContain("AI に質問");
  });
});

describe("テーマの選択欄（SCR-002-I02、A03。CR-019 で選択欄に戻した）", () => {
  it("テーマは「すべて」と各テーマを選択肢に持つ選択欄で、テーマのボタンの並びは無い", async () => {
    stubApi(SAME_DAY);
    const { container } = render(<NewsGalaxyScreen />);
    await screen.findByText("記事A1 AI 未読");

    // select は日付とテーマの2つ。
    const selects = [...container.querySelectorAll("select")];
    expect(
      selects.map((select) => select.getAttribute("aria-label")).sort(),
    ).toEqual(["テーマ", "日付"].sort());
    const texts = [...themeSelect().options].map(
      (option) => option.textContent?.trim() ?? "",
    );
    expect(texts[0]).toBe("すべて");
    expect(texts.slice(1).sort()).toEqual(["AI", "半導体"].sort());
    expect(container.querySelectorAll("[aria-pressed]")).toHaveLength(0);
  });

  it("テーマを選ぶと、そのテーマの記事だけが図に出て、「すべて」で全てに戻る。サーバは呼ばない", async () => {
    stubApi(SAME_DAY);
    render(<NewsGalaxyScreen />);
    await screen.findByText("記事A1 AI 未読");
    expect(shownTitles()).toEqual(
      [
        "記事A1 AI 未読",
        "記事A2 AI 未読",
        "記事A3 AI 既読",
        "記事S1 半導体 未読",
        "記事S2 半導体 既読",
      ].sort(),
    );

    chooseTheme("半導体");
    await waitFor(() =>
      expect(shownTitles()).toEqual([
        "記事S1 半導体 未読",
        "記事S2 半導体 既読",
      ]),
    );
    chooseTheme("AI");
    await waitFor(() =>
      expect(shownTitles()).toEqual(
        ["記事A1 AI 未読", "記事A2 AI 未読", "記事A3 AI 既読"].sort(),
      ),
    );
    chooseTheme("すべて");
    await waitFor(() => expect(shownTitles()).toHaveLength(5));
    expect(calls.map((call) => call.url)).toEqual(["/api/app/news/galaxy"]);
  });
});

describe("「未読」の切り替え（SCR-002-I03、A06）", () => {
  it("「未読」の切り替えに、選んだ日の記事のうち既読でない記事の数が出る（関係の先の過去の記事は数えない）", async () => {
    stubApi(WITH_PAST);
    render(<NewsGalaxyScreen />);
    await screen.findByText("記事P1 過去 未読");
    // 12-01 の記事のうち未読は A1、A2、S1 の3件。11-28 の P1 は未読でも数えない。
    expect(countIn(unreadToggle())).toBe(3);
    expect(
      screen.getByRole("switch", { name: countButtonPattern("未読だけ", 3) }),
    ).toBeTruthy();
  });

  it("「未読だけ」は、テーマの選択欄から離して置く（CR-019）", async () => {
    stubApi(SAME_DAY);
    render(<NewsGalaxyScreen />);
    await screen.findByText("記事A1 AI 未読");
    const toggle = unreadToggle();
    const select = themeSelect();
    expect(select.contains(toggle)).toBe(false);
    expect(toggle.contains(select)).toBe(false);
  });

  it("「未読」を押すと既読の記事のノードが図から消え、もう一度押すと戻る", async () => {
    stubApi(WITH_PAST);
    render(<NewsGalaxyScreen />);
    await screen.findByText("記事A1 AI 未読");
    const everything = [
      "記事A1 AI 未読",
      "記事A2 AI 未読",
      "記事A3 AI 既読",
      "記事S1 半導体 未読",
      "記事S2 半導体 既読",
      "記事P1 過去 未読",
      "記事P2 過去 既読",
    ].sort();
    expect(shownTitles()).toEqual(everything);

    fireEvent.click(unreadToggle());
    await waitFor(() =>
      expect(shownTitles()).toEqual(
        [
          "記事A1 AI 未読",
          "記事A2 AI 未読",
          "記事S1 半導体 未読",
          "記事P1 過去 未読",
        ].sort(),
      ),
    );
    for (const element of screen.getAllByTestId("news-node")) {
      expect(element.dataset.read).toBe("false");
    }

    fireEvent.click(unreadToggle());
    await waitFor(() => expect(shownTitles()).toEqual(everything));
  });

  it("「未読」とテーマを両方選ぶと、そのテーマの未読の記事だけが出る（どちらを先に選んでも）", async () => {
    stubApi(WITH_PAST);
    render(<NewsGalaxyScreen />);
    await screen.findByText("記事A1 AI 未読");

    // テーマを先に選び、次に「未読」。
    chooseTheme("半導体");
    await waitFor(() => expect(shownTitles()).not.toContain("記事A1 AI 未読"));
    fireEvent.click(unreadToggle());
    await waitFor(() => expect(shownTitles()).toEqual(["記事S1 半導体 未読"]));

    // 「未読」のまま、テーマを替える。
    chooseTheme("AI");
    await waitFor(() =>
      expect(shownTitles()).toEqual(
        ["記事A1 AI 未読", "記事A2 AI 未読", "記事P1 過去 未読"].sort(),
      ),
    );

    // 「未読」を切ると、AI の既読の記事も戻る。
    fireEvent.click(unreadToggle());
    await waitFor(() =>
      expect(shownTitles()).toEqual(
        [
          "記事A1 AI 未読",
          "記事A2 AI 未読",
          "記事A3 AI 既読",
          "記事P1 過去 未読",
        ].sort(),
      ),
    );
  });

  it("「未読」を先に選び、次にテーマを選んでも、そのテーマの未読の記事だけが出る", async () => {
    stubApi(SAME_DAY);
    render(<NewsGalaxyScreen />);
    await screen.findByText("記事A1 AI 未読");
    fireEvent.click(unreadToggle());
    await waitFor(() => expect(shownTitles()).toHaveLength(3));
    chooseTheme("半導体");
    await waitFor(() => expect(shownTitles()).toEqual(["記事S1 半導体 未読"]));
  });

  it("「未読」を押しても getGalaxy を呼ばない", async () => {
    stubApi(WITH_PAST);
    render(<NewsGalaxyScreen />);
    await screen.findByText("記事A1 AI 未読");
    expect(calls.map((call) => call.url)).toEqual(["/api/app/news/galaxy"]);

    fireEvent.click(unreadToggle());
    await waitFor(() => expect(shownTitles()).not.toContain("記事A3 AI 既読"));
    fireEvent.click(unreadToggle());
    await waitFor(() => expect(shownTitles()).toContain("記事A3 AI 既読"));
    chooseTheme("AI");
    fireEvent.click(unreadToggle());
    await waitFor(() =>
      expect(shownTitles()).toEqual(
        ["記事A1 AI 未読", "記事A2 AI 未読", "記事P1 過去 未読"].sort(),
      ),
    );
    expect(galaxyCalls()).toHaveLength(1);
    expect(calls).toHaveLength(1);
  });

  it("記事の案内で「読んだ」を押すと、未読の数が1つ減る", async () => {
    stubApi(WITH_PAST);
    render(<NewsGalaxyScreen />);
    await screen.findByText("記事A1 AI 未読");
    expect(countIn(unreadToggle())).toBe(3);

    fireEvent.click(screen.getByText("記事A1 AI 未読"));
    const sheet = await screen.findByRole("dialog", { name: "記事の案内" });
    await within(sheet).findByText("記事A1 AI 未読 の案内");
    fireEvent.click(within(sheet).getByRole("button", { name: "読んだ" }));
    await within(sheet).findByRole("button", { name: "未読に戻す" });

    fireEvent.click(within(sheet).getByRole("button", { name: "閉じる" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "記事の案内" })).toBeNull(),
    );
    await waitFor(() => expect(countIn(unreadToggle())).toBe(2));
    expect(
      screen.getByRole("switch", { name: countButtonPattern("未読だけ", 2) }),
    ).toBeTruthy();
    expect(galaxyCalls()).toHaveLength(1);
  });
});

// ---- 押す場所の大きさ（Tailwind を通した src/app/globals.css の規則で測る） ----

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

function declarationsFor(root: Root, targets: Set<string>): Decl[] {
  const found: Decl[] = [];
  root.walkRules((rule) => {
    if (!isUnconditional(rule)) return;
    const selectors = rule.selectors.map((s) => unescapeSelector(s.trim()));
    if (!selectors.some((s) => targets.has(s))) return;
    rule.each((child) => {
      if (child.type === "decl")
        found.push({ prop: child.prop, value: child.value.trim() });
    });
  });
  return found;
}

// テーマの値（--spacing など）。
function themeVariables(root: Root): Map<string, string> {
  const vars = new Map<string, string>();
  for (const decl of declarationsFor(root, new Set([":root", ":host"]))) {
    if (decl.prop.startsWith("--")) vars.set(decl.prop, decl.value);
  }
  return vars;
}

// 長さをピクセルにする。px、rem、var(--x)、calc(a * b) を扱う。読めなければ null。
function toPixels(raw: string, vars: Map<string, string>): number | null {
  let value = raw.replace(/\s*!important$/, "").trim();
  for (let i = 0; i < 10 && value.includes("var("); i += 1) {
    value = value.replace(
      /var\((--[\w-]+)(?:\s*,\s*([^()]*))?\)/g,
      (_, name: string, fallback?: string) =>
        vars.get(name) ?? fallback ?? "NaN",
    );
  }
  const single = (text: string): number | null => {
    const m = text.trim().match(/^(-?[\d.]+)(px|rem)?$/);
    if (!m) return null;
    const n = Number(m[1]);
    if (m[2] === "rem") return n * 16;
    if (m[2] === "px") return n;
    return n === 0 ? 0 : null;
  };
  const calc = value.match(/^calc\((.+)\)$/);
  if (calc) {
    const parts = calc[1].split("*").map((p) => p.trim());
    if (parts.length !== 2) return null;
    const [a, b] = parts;
    const unitA = single(a);
    const unitB = single(b);
    if (unitA !== null && /^[\d.]+$/.test(b)) return unitA * Number(b);
    if (unitB !== null && /^[\d.]+$/.test(a)) return unitB * Number(a);
    return null;
  }
  return single(value);
}

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

// 要素の規則が決める、縦と横の最小の大きさ（min-height・height・min-width・width の大きい方）。
function minimumBox(
  root: Root,
  element: HTMLElement,
): { width: number; height: number } {
  const vars = themeVariables(root);
  let width = 0;
  let height = 0;
  for (const { prop, value } of elementDeclarations(root, element)) {
    const px = toPixels(value, vars);
    if (px === null) continue;
    if (prop === "min-height" || prop === "height" || prop === "block-size")
      height = Math.max(height, px);
    if (prop === "min-width" || prop === "width" || prop === "inline-size")
      width = Math.max(width, px);
  }
  return { width, height };
}

function describeElement(element: HTMLElement): string {
  const name =
    element.getAttribute("aria-label") ??
    element.textContent?.trim() ??
    element.tagName;
  return `${element.tagName.toLowerCase()}「${name}」`;
}

// 押す場所。図（React Flow）の中と、記事の案内の面の中は、この実装単位の外なので除く。
function pressables(container: HTMLElement): HTMLElement[] {
  return [
    ...container.querySelectorAll<HTMLElement>(
      'button, a[href], select, input, [role="button"], [role="switch"], [role="radio"], [role="checkbox"], [role="tab"], [role="option"]',
    ),
  ].filter(
    (element) =>
      element.closest(".react-flow") === null &&
      element.closest('[role="dialog"]') === null,
  );
}

describe("押す場所の大きさ（BD-09 5章）", () => {
  it("上の帯と、日付・「未読だけ」・テーマの選択欄の押す場所が全て 44 ピクセル四方以上である", async () => {
    stubApi(WITH_PAST);
    const { container } = render(<NewsGalaxyRoute onAskAi={vi.fn()} />);
    await screen.findByText("記事A1 AI 未読");
    const root = await compiledGlobals();

    const targets = pressables(container);
    // 少なくとも、ホームへ戻る操作、日付、「未読だけ」、テーマの選択欄がある（CR-019）。
    expect(targets.length).toBeGreaterThanOrEqual(4);
    expect(targets).toContain(unreadToggle());
    expect(targets).toContain(themeSelect());
    expect(targets).toContain(screen.getByRole("combobox", { name: "日付" }));

    const small: string[] = [];
    for (const element of targets) {
      // 見えない入力を包む label が押す場所なら、label で測る。
      const candidates = [element, element.closest("label")].filter(
        (el): el is HTMLElement => el !== null,
      );
      const ok = candidates.some((candidate) => {
        const box = minimumBox(root, candidate);
        return box.width >= 44 && box.height >= 44;
      });
      if (!ok) {
        const box = minimumBox(root, element);
        small.push(`${describeElement(element)} ${box.width}x${box.height}`);
      }
    }
    expect(small).toEqual([]);
  });

  it("「未読」を押した後も、押す場所が 44 ピクセル四方以上である", async () => {
    stubApi(WITH_PAST);
    const { container } = render(<NewsGalaxyRoute onAskAi={vi.fn()} />);
    await screen.findByText("記事A1 AI 未読");
    fireEvent.click(unreadToggle());
    chooseTheme("AI");
    await waitFor(() =>
      expect(shownTitles()).toEqual(
        ["記事A1 AI 未読", "記事A2 AI 未読", "記事P1 過去 未読"].sort(),
      ),
    );
    const root = await compiledGlobals();
    const small = pressables(container)
      .filter((element) => {
        const candidates = [element, element.closest("label")].filter(
          (el): el is HTMLElement => el !== null,
        );
        return !candidates.some((candidate) => {
          const box = minimumBox(root, candidate);
          return box.width >= 44 && box.height >= 44;
        });
      })
      .map(describeElement);
    expect(small).toEqual([]);
  });
});
