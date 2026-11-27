// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ArticleDetail, Galaxy, GalaxyNode } from "../src/contracts/news";
import { NewsGalaxyRoute } from "../src/app/(screens)/news/galaxy-route";
import { NewsGalaxyScreen } from "../src/screens/news/galaxy-screen";
import { installReactFlowStubs } from "./fixtures/react-flow";
import {
  compiledGlobals,
  PRESSABLE_SELECTOR,
  smallPressables,
} from "./fixtures/tap-size";

// 08-news の実装単位7（BD-03 SCR-002、CR-019）。News Galaxy のテーマ（SCR-002-I02）を、件数付きの
// ボタンの並びから選択欄（<select>、名前「テーマ」、初めは「すべて」）に戻し、未読（SCR-002-I03）を
// テーマの選択欄から離した入と切のスイッチ（role="switch" と aria-checked、名前は「未読だけ」と未読の数）
// にする。絞り込みの決まり（未読だけを出す、テーマと重ねる、サーバを呼ばない、「読んだ」で数が減る）は
// 変えない。
// 受け入れ基準:
// - テーマが名前「テーマ」の選択欄で、選択肢が「すべて」と選んだ日の記事のテーマである。
// - テーマのボタンの並び（aria-pressed を持つボタン）が無い。
// - 「未読だけ」が role="switch" で、初めは aria-checked="false"、押すと "true"、もう一度押すと "false" になる。
// - 「未読だけ」の名前に選んだ日の記事のうち未読の数が入る。
// - 「未読だけ」が入のとき、既読の記事のノードが図から消え、切にすると戻る。
// - テーマを選び「未読だけ」を入にすると、そのテーマの未読の記事だけが出る。
// - 「未読だけ」もテーマの選択も getGalaxy を呼ばない。
// - 押す場所が全て 44 ピクセル四方以上である。
//
// スイッチの名前は「未読だけ」と数字（未読の数）とし、数字の前後の飾り（「件」や括弧）は問わない。
// 選択肢の文字は、BD-03 3.3 の SCR-002-I02 の表示書式どおり、テーマの名前（と「すべて」）そのものとする。
// テーマを選ぶときは、選択肢の文字で選択肢を見つけ、その value で選択欄を change する（value の中身は問わない）。

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

// 選んだ日（12-01）の記事。AI が3件（うち既読1件）、半導体が2件（うち既読1件）。未読は3件。
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

// 関係の先の過去の記事（選んだ日の記事ではない）。未読の数にも、テーマの選択肢にも入れない。
// P1 は AI の未読、P2 は選んだ日に無いテーマ「宇宙」の既読。
const P1 = node({
  contentId: 21,
  title: "記事P1 過去 AI 未読",
  targetDate: "2026-11-28",
});
const P2 = node({
  contentId: 22,
  title: "記事P2 過去 宇宙 既読",
  theme: "宇宙",
  targetDate: "2026-11-28",
  isRead: true,
  isNew: false,
});

// getGalaxy の themes は、選んだ日の記事のテーマ（DD-02 FN-003 手順3、DD-10 TC19）。
const GALAXY: Galaxy = {
  date: "2026-12-01",
  availableDates: ["2026-12-01", "2026-11-28"],
  themes: ["AI", "半導体"],
  nodes: [A1, A2, A3, S1, S2, P1, P2],
  links: [
    { fromContentId: 1, toContentId: 2, relationType: "follow_up" },
    { fromContentId: 3, toContentId: 11, relationType: "background" },
    { fromContentId: 1, toContentId: 21, relationType: "background" },
    { fromContentId: 12, toContentId: 22, relationType: "same_actor" },
  ],
};

const EVERYTHING = [
  "記事A1 AI 未読",
  "記事A2 AI 未読",
  "記事A3 AI 既読",
  "記事S1 半導体 未読",
  "記事S2 半導体 既読",
  "記事P1 過去 AI 未読",
  "記事P2 過去 宇宙 既読",
].sort();

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

function themeSelect(): HTMLSelectElement {
  const element = screen.getByRole("combobox", { name: "テーマ" });
  expect(element.tagName).toBe("SELECT");
  return element as HTMLSelectElement;
}

function optionTexts(select: HTMLSelectElement): string[] {
  return [...select.options].map((option) => option.textContent?.trim() ?? "");
}

// 選択肢の文字で選ぶ。
function chooseTheme(label: string): void {
  const select = themeSelect();
  const option = [...select.options].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (option === undefined)
    throw new Error(`テーマの選択肢が無い: ${label}（${optionTexts(select)}）`);
  fireEvent.change(select, { target: { value: option.value } });
}

function selectedThemeText(): string {
  const select = themeSelect();
  return select.selectedOptions[0]?.textContent?.trim() ?? "";
}

// 名前が「未読だけ」と数字（未読の数）だけのスイッチ。数字の前後の飾りは問わない。
function unreadSwitchPattern(count?: number): RegExp {
  const digits = count === undefined ? "\\d+" : String(count);
  return new RegExp(`^\\s*未読だけ[^0-9]*${digits}[^0-9]*$`);
}

function unreadSwitch(count?: number): HTMLElement {
  return screen.getByRole("switch", { name: unreadSwitchPattern(count) });
}

function countIn(element: HTMLElement): number {
  const name = element.getAttribute("aria-label") ?? element.textContent ?? "";
  const digits = name.match(/\d+/g);
  if (digits === null || digits.length !== 1)
    throw new Error(`未読の数が読めない: ${name}`);
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

describe("テーマの選択欄（SCR-002-I02、A03。CR-019）", () => {
  it("テーマが名前「テーマ」の選択欄で、選択肢が「すべて」と選んだ日の記事のテーマであり、初めは「すべて」", async () => {
    stubApi(GALAXY);
    render(<NewsGalaxyScreen />);
    await screen.findByText("記事A1 AI 未読");

    const select = themeSelect();
    const texts = optionTexts(select);
    // 先頭が「すべて」で、残りは選んだ日の記事のテーマ（過去の記事だけのテーマ「宇宙」は入らない）。
    expect(texts[0]).toBe("すべて");
    expect(texts.slice(1).sort()).toEqual(["AI", "半導体"].sort());
    expect(texts).toHaveLength(3);
    expect(selectedThemeText()).toBe("すべて");
    expect(shownTitles()).toEqual(EVERYTHING);
  });

  it("テーマを選ぶと、そのテーマの記事だけが図に出て、「すべて」で全てに戻る", async () => {
    stubApi(GALAXY);
    render(<NewsGalaxyScreen />);
    await screen.findByText("記事A1 AI 未読");

    chooseTheme("半導体");
    await waitFor(() =>
      expect(shownTitles()).toEqual(
        ["記事S1 半導体 未読", "記事S2 半導体 既読"].sort(),
      ),
    );
    expect(selectedThemeText()).toBe("半導体");

    chooseTheme("AI");
    await waitFor(() =>
      expect(shownTitles()).toEqual(
        [
          "記事A1 AI 未読",
          "記事A2 AI 未読",
          "記事A3 AI 既読",
          "記事P1 過去 AI 未読",
        ].sort(),
      ),
    );

    chooseTheme("すべて");
    await waitFor(() => expect(shownTitles()).toEqual(EVERYTHING));
  });

  it("テーマのボタンの並び（aria-pressed を持つボタン）が無い", async () => {
    stubApi(GALAXY);
    const { container } = render(<NewsGalaxyRoute onAskAi={vi.fn()} />);
    await screen.findByText("記事A1 AI 未読");

    const check = () => {
      expect(container.querySelectorAll("[aria-pressed]")).toHaveLength(0);
      expect(
        screen.queryAllByRole("button", { pressed: true, hidden: true }),
      ).toHaveLength(0);
      expect(
        screen.queryAllByRole("button", { pressed: false, hidden: true }),
      ).toHaveLength(0);
      // 「すべて」やテーマの名前を名前に持つボタンも無い。
      for (const label of ["すべて", "AI", "半導体"]) {
        expect(
          screen.queryAllByRole("button", {
            name: new RegExp(`^\\s*${label}(?:[^0-9]*\\d+[^0-9]*)?$`),
            hidden: true,
          }),
        ).toHaveLength(0);
      }
    };
    check();

    // テーマを選び、「未読だけ」を入にした後も無い。
    chooseTheme("AI");
    fireEvent.click(unreadSwitch());
    await waitFor(() =>
      expect(unreadSwitch().getAttribute("aria-checked")).toBe("true"),
    );
    check();
  });
});

describe("「未読だけ」のスイッチ（SCR-002-I03、A06。CR-019）", () => {
  it('「未読だけ」が role="switch" で、初めは aria-checked="false"、押すと "true"、もう一度押すと "false" になる', async () => {
    stubApi(GALAXY);
    render(<NewsGalaxyScreen />);
    await screen.findByText("記事A1 AI 未読");

    expect(unreadSwitch().getAttribute("aria-checked")).toBe("false");
    fireEvent.click(unreadSwitch());
    await waitFor(() =>
      expect(unreadSwitch().getAttribute("aria-checked")).toBe("true"),
    );
    fireEvent.click(unreadSwitch());
    await waitFor(() =>
      expect(unreadSwitch().getAttribute("aria-checked")).toBe("false"),
    );
  });

  it("「未読だけ」は、テーマの選択欄の中に無い（離して置く）", async () => {
    stubApi(GALAXY);
    render(<NewsGalaxyScreen />);
    await screen.findByText("記事A1 AI 未読");
    const select = themeSelect();
    const toggle = unreadSwitch();
    expect(select.contains(toggle)).toBe(false);
    expect(toggle.contains(select)).toBe(false);
  });

  it("「未読だけ」の名前に、選んだ日の記事のうち未読の数が入る（関係の先の過去の記事は数えない）", async () => {
    stubApi(GALAXY);
    render(<NewsGalaxyScreen />);
    await screen.findByText("記事P1 過去 AI 未読");
    // 12-01 の記事のうち未読は A1、A2、S1 の3件。11-28 の P1 は未読でも数えない。
    expect(countIn(unreadSwitch())).toBe(3);
    expect(unreadSwitch(3)).toBeTruthy();
  });

  it("記事の案内で「読んだ」を押すと、「未読だけ」の未読の数が1つ減る", async () => {
    stubApi(GALAXY);
    render(<NewsGalaxyScreen />);
    await screen.findByText("記事A1 AI 未読");
    expect(countIn(unreadSwitch())).toBe(3);

    fireEvent.click(screen.getByText("記事A1 AI 未読"));
    const sheet = await screen.findByRole("dialog", { name: "記事の案内" });
    await within(sheet).findByText("記事A1 AI 未読 の案内");
    fireEvent.click(within(sheet).getByRole("button", { name: "読んだ" }));
    await within(sheet).findByRole("button", { name: "未読に戻す" });

    fireEvent.click(within(sheet).getByRole("button", { name: "閉じる" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "記事の案内" })).toBeNull(),
    );
    await waitFor(() => expect(countIn(unreadSwitch())).toBe(2));
    expect(unreadSwitch(2)).toBeTruthy();
    expect(galaxyCalls()).toHaveLength(1);
  });

  it("「未読だけ」が入のとき、既読の記事のノードが図から消え、切にすると戻る", async () => {
    stubApi(GALAXY);
    render(<NewsGalaxyScreen />);
    await screen.findByText("記事A1 AI 未読");
    expect(shownTitles()).toEqual(EVERYTHING);

    fireEvent.click(unreadSwitch());
    await waitFor(() =>
      expect(shownTitles()).toEqual(
        [
          "記事A1 AI 未読",
          "記事A2 AI 未読",
          "記事S1 半導体 未読",
          "記事P1 過去 AI 未読",
        ].sort(),
      ),
    );
    expect(unreadSwitch().getAttribute("aria-checked")).toBe("true");
    for (const element of screen.getAllByTestId("news-node")) {
      expect(element.dataset.read).toBe("false");
    }

    fireEvent.click(unreadSwitch());
    await waitFor(() => expect(shownTitles()).toEqual(EVERYTHING));
    expect(unreadSwitch().getAttribute("aria-checked")).toBe("false");
  });

  it("テーマを選び「未読だけ」を入にすると、そのテーマの未読の記事だけが出る", async () => {
    stubApi(GALAXY);
    render(<NewsGalaxyScreen />);
    await screen.findByText("記事A1 AI 未読");

    // テーマを先に選び、次に「未読だけ」を入にする。
    chooseTheme("半導体");
    await waitFor(() => expect(shownTitles()).not.toContain("記事A1 AI 未読"));
    fireEvent.click(unreadSwitch());
    await waitFor(() => expect(shownTitles()).toEqual(["記事S1 半導体 未読"]));

    // 「未読だけ」を入のまま、テーマを替える。
    chooseTheme("AI");
    await waitFor(() =>
      expect(shownTitles()).toEqual(
        ["記事A1 AI 未読", "記事A2 AI 未読", "記事P1 過去 AI 未読"].sort(),
      ),
    );
    expect(unreadSwitch().getAttribute("aria-checked")).toBe("true");
    expect(selectedThemeText()).toBe("AI");

    // 「未読だけ」を切ると、そのテーマの既読の記事も戻る。
    fireEvent.click(unreadSwitch());
    await waitFor(() =>
      expect(shownTitles()).toEqual(
        [
          "記事A1 AI 未読",
          "記事A2 AI 未読",
          "記事A3 AI 既読",
          "記事P1 過去 AI 未読",
        ].sort(),
      ),
    );
  });

  it("「未読だけ」を先に入にし、次にテーマを選んでも、そのテーマの未読の記事だけが出る", async () => {
    stubApi(GALAXY);
    render(<NewsGalaxyScreen />);
    await screen.findByText("記事A1 AI 未読");
    fireEvent.click(unreadSwitch());
    await waitFor(() => expect(shownTitles()).toHaveLength(4));
    chooseTheme("半導体");
    await waitFor(() => expect(shownTitles()).toEqual(["記事S1 半導体 未読"]));
    expect(unreadSwitch().getAttribute("aria-checked")).toBe("true");
  });

  it("「未読だけ」もテーマの選択も getGalaxy を呼ばない", async () => {
    stubApi(GALAXY);
    render(<NewsGalaxyScreen />);
    await screen.findByText("記事A1 AI 未読");
    expect(calls.map((call) => call.url)).toEqual(["/api/app/news/galaxy"]);

    fireEvent.click(unreadSwitch());
    await waitFor(() => expect(shownTitles()).not.toContain("記事A3 AI 既読"));
    fireEvent.click(unreadSwitch());
    await waitFor(() => expect(shownTitles()).toContain("記事A3 AI 既読"));
    chooseTheme("半導体");
    await waitFor(() => expect(shownTitles()).toHaveLength(2));
    chooseTheme("AI");
    fireEvent.click(unreadSwitch());
    await waitFor(() =>
      expect(shownTitles()).toEqual(
        ["記事A1 AI 未読", "記事A2 AI 未読", "記事P1 過去 AI 未読"].sort(),
      ),
    );
    chooseTheme("すべて");
    await waitFor(() => expect(shownTitles()).toHaveLength(4));
    expect(galaxyCalls()).toHaveLength(1);
    expect(calls).toHaveLength(1);
  });
});

// 押す場所。図（React Flow）の中と、記事の案内の面の中は、この実装単位の外なので除く。
function pressables(container: HTMLElement): HTMLElement[] {
  return [
    ...container.querySelectorAll<HTMLElement>(PRESSABLE_SELECTOR),
  ].filter(
    (element) =>
      element.closest(".react-flow") === null &&
      element.closest('[role="dialog"]') === null,
  );
}

describe("押す場所の大きさ（BD-09 5章、RD-11 NFR-008）", () => {
  it("上の帯と、日付・テーマの選択欄・「未読だけ」の押す場所が全て 44 ピクセル四方以上である", async () => {
    stubApi(GALAXY);
    const { container } = render(<NewsGalaxyRoute onAskAi={vi.fn()} />);
    await screen.findByText("記事A1 AI 未読");
    const root = await compiledGlobals();

    const targets = pressables(container);
    // 少なくとも、ホームへ戻る操作、日付、テーマ、「未読だけ」がある。
    expect(targets.length).toBeGreaterThanOrEqual(4);
    expect(targets).toContain(screen.getByRole("combobox", { name: "日付" }));
    expect(targets).toContain(themeSelect());
    expect(targets).toContain(unreadSwitch());
    expect(smallPressables(root, targets)).toEqual([]);
  });

  it("テーマを選び「未読だけ」を入にした後も、押す場所が全て 44 ピクセル四方以上である", async () => {
    stubApi(GALAXY);
    const { container } = render(<NewsGalaxyRoute onAskAi={vi.fn()} />);
    await screen.findByText("記事A1 AI 未読");
    chooseTheme("AI");
    fireEvent.click(unreadSwitch());
    await waitFor(() =>
      expect(shownTitles()).toEqual(
        ["記事A1 AI 未読", "記事A2 AI 未読", "記事P1 過去 AI 未読"].sort(),
      ),
    );
    const root = await compiledGlobals();
    const targets = pressables(container);
    expect(targets).toContain(themeSelect());
    expect(targets).toContain(unreadSwitch());
    expect(smallPressables(root, targets)).toEqual([]);
  });
});
