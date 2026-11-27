// @vitest-environment jsdom
import {
  act,
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
import { NEWS_MESSAGES } from "../src/screens/news/messages";
import { MESSAGES } from "../src/server/shared/messages";
import { installReactFlowStubs } from "./fixtures/react-flow";

// 08-news の実装単位2。News Galaxy と記事の案内の画面 M03（SCR-002、SCR-003）と、ニュースの
// 表示部品 M08。受け入れ基準 DD-10 TC21、TC29。API の応答はここで作る（TC19、TC22 と同じ形）。
// API の本当の応答につないだ TC21 は 08-news-screens-api.test.tsx。

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

const A1 = node({ contentId: 1, title: "今日の記事 A1" });
const A2 = node({ contentId: 2, title: "今日の記事 A2" });
const A3 = node({ contentId: 3, title: "今日の記事 A3", theme: "半導体" });
const P1 = node({
  contentId: 4,
  title: "3日前の記事 P1",
  targetDate: "2026-11-28",
});
const P9 = node({
  contentId: 9,
  title: "6日前の記事 P9",
  theme: "半導体",
  targetDate: "2026-11-25",
});

// TC19 の応答: A1→A2、A1→P1 が有効（A2→A3 は無効なので出ない）。
const TC19_GALAXY: Galaxy = {
  date: "2026-12-01",
  availableDates: ["2026-12-01", "2026-11-28", "2026-11-23"],
  themes: ["AI", "半導体"],
  nodes: [A1, A2, A3, P1],
  links: [
    { fromContentId: 1, toContentId: 2, relationType: "follow_up" },
    { fromContentId: 1, toContentId: 4, relationType: "background" },
  ],
};

function detailOf(
  base: GalaxyNode,
  related: ArticleDetail["related"],
  state: Partial<ArticleDetail["state"]> = {},
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
      isNew: true,
      isRead: false,
      isSaved: false,
      savedAt: null,
      ...state,
    },
    related,
  };
}

// TC22 の応答: A1 の related に P1（direction from）と A2。
const A1_DETAIL = detailOf(A1, [
  {
    node: A2,
    relationType: "follow_up",
    reason: "A2 は A1 の続き",
    direction: "from",
  },
  {
    node: P1,
    relationType: "background",
    reason: "P1 は A1 の背景",
    direction: "from",
  },
]);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

type Call = { url: string; method: string; body: string | null };
let calls: Call[];

function stubFetch(
  respond: (call: Call) => Response | Promise<Response>,
): void {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const call = {
        url: String(input),
        method: init?.method ?? "GET",
        body: typeof init?.body === "string" ? init.body : null,
      };
      calls.push(call);
      return respond(call);
    }),
  );
}

function stateOf(detail: ArticleDetail, change: object) {
  return { ...detail.state, isNew: false, ...change };
}

// 図と案内の API。`overrides` で道ごとの応答を替える。
function newsApi(
  overrides: Record<string, (call: Call) => Response> = {},
): (call: Call) => Response {
  return (call) => {
    const key = `${call.method} ${call.url}`;
    if (overrides[key]) return overrides[key](call);
    if (key === "GET /api/app/news/galaxy") return jsonResponse(TC19_GALAXY);
    if (key === "GET /api/app/news/articles/1") return jsonResponse(A1_DETAIL);
    if (key === "POST /api/app/contents/1/opened") {
      return jsonResponse(stateOf(A1_DETAIL, {}));
    }
    throw new Error(`知らない呼び出し: ${key}`);
  };
}

function shownTitles(): string[] {
  return screen
    .queryAllByTestId("news-node")
    .map((element) => element.querySelector("p")?.textContent ?? "");
}

// テーマの選択欄（名前「テーマ」の select。CR-019）で、選択肢の文字が theme のものを選ぶ。
function chooseTheme(theme: string): void {
  const select = screen.getByRole("combobox", {
    name: "テーマ",
  }) as HTMLSelectElement;
  const option = [...select.options].find(
    (candidate) => candidate.textContent?.trim() === theme,
  );
  if (option === undefined) throw new Error(`テーマの選択肢が無い: ${theme}`);
  fireEvent.change(select, { target: { value: option.value } });
}

function nodeElement(title: string): HTMLElement {
  const found = screen
    .getAllByTestId("news-node")
    .find((element) => element.textContent?.includes(title));
  if (!found) throw new Error(`ノードが無い: ${title}`);
  return found;
}

async function openA1(): Promise<HTMLElement> {
  await screen.findByText("今日の記事 A1");
  fireEvent.click(screen.getByText("今日の記事 A1"));
  const sheet = await screen.findByRole("dialog", { name: "記事の案内" });
  await within(sheet).findByText("今日の記事 A1 の案内");
  return sheet;
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

describe("TC21 テーマで絞り、ノードを押すと記事を中心にして関係の先を足す（SCR-002-A03、A04、DD-02 FN-003 手順 4〜5）", () => {
  it("テーマを選ぶと、選んだテーマの記事だけが出て、サーバを呼ばない", async () => {
    stubFetch(newsApi());
    render(<NewsGalaxyScreen />);
    await screen.findByText("今日の記事 A1");
    expect(shownTitles()).toEqual([
      "今日の記事 A1",
      "今日の記事 A2",
      "今日の記事 A3",
      "3日前の記事 P1",
    ]);
    expect(calls.map((call) => call.url)).toEqual(["/api/app/news/galaxy"]);

    // テーマは名前「テーマ」の選択欄で選ぶ（CR-019）。
    chooseTheme("AI");
    await waitFor(() =>
      expect(shownTitles()).toEqual([
        "今日の記事 A1",
        "今日の記事 A2",
        "3日前の記事 P1",
      ]),
    );
    chooseTheme("半導体");
    await waitFor(() => expect(shownTitles()).toEqual(["今日の記事 A3"]));
    expect(calls).toHaveLength(1);
  });

  it("初めは中心を置かず、A1 を押すと getArticle が呼ばれ、A1 が中心になり、案内が下から出る", async () => {
    stubFetch(newsApi());
    render(<NewsGalaxyScreen />);
    await screen.findByText("今日の記事 A1");
    expect(
      screen
        .getAllByTestId("news-node")
        .filter((element) => element.dataset.center === "true"),
    ).toHaveLength(0);
    // 関係の種類の名前は、中心を選ぶまで出さない。
    expect(screen.queryByText("続報")).toBeNull();

    const sheet = await openA1();
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      "GET /api/app/news/galaxy",
      "GET /api/app/news/articles/1",
      "POST /api/app/contents/1/opened",
    ]);
    expect(nodeElement("今日の記事 A1").dataset.center).toBe("true");
    expect(nodeElement("今日の記事 A2").dataset.center).toBe("false");
    // 案内に、関係の種類の名前と見出しと根拠を出す（SCR-003-O06）。
    const related = within(sheet).getByRole("region", {
      name: "関係のある記事",
    });
    expect(related.textContent).toContain("続報");
    expect(related.textContent).toContain("今日の記事 A2");
    expect(related.textContent).toContain("A2 は A1 の続き");
    expect(related.textContent).toContain("背景");
    expect(related.textContent).toContain("3日前の記事 P1");
    expect(
      within(sheet)
        .getByRole("link", { name: "元の記事を開く" })
        .getAttribute("href"),
    ).toBe("https://example.com/news/1");
  });

  it("押した記事の related のうち、図に無い記事が図に足され、その記事を押すと中心が移る", async () => {
    const a2Detail = detailOf(A2, [
      {
        node: A1,
        relationType: "follow_up",
        reason: "A2 は A1 の続き",
        direction: "to",
      },
      {
        node: P9,
        relationType: "same_actor",
        reason: "同じ会社",
        direction: "from",
      },
    ]);
    const p9Detail = detailOf(P9, [
      {
        node: A2,
        relationType: "same_actor",
        reason: "同じ会社",
        direction: "to",
      },
    ]);
    stubFetch(
      newsApi({
        "GET /api/app/news/articles/2": () => jsonResponse(a2Detail),
        "POST /api/app/contents/2/opened": () =>
          jsonResponse(stateOf(a2Detail, {})),
        "GET /api/app/news/articles/9": () => jsonResponse(p9Detail),
        "POST /api/app/contents/9/opened": () =>
          jsonResponse(stateOf(p9Detail, {})),
      }),
    );
    render(<NewsGalaxyScreen />);
    await screen.findByText("今日の記事 A2");
    expect(shownTitles()).not.toContain("6日前の記事 P9");

    fireEvent.click(screen.getByText("今日の記事 A2"));
    await waitFor(() => expect(shownTitles()).toContain("6日前の記事 P9"));
    expect(nodeElement("今日の記事 A2").dataset.center).toBe("true");

    // 案内の関係のある記事を押すと、その記事の案内を開き、図の中心も移す（SCR-003-A06）。
    const sheet = screen.getByRole("dialog", { name: "記事の案内" });
    fireEvent.click(
      await within(sheet).findByRole("button", { name: /6日前の記事 P9/ }),
    );
    await within(sheet).findByText("6日前の記事 P9 の案内");
    expect(nodeElement("6日前の記事 P9").dataset.center).toBe("true");
    expect(nodeElement("今日の記事 A2").dataset.center).toBe("false");
  });

  it("記事が無い日の応答では MSG-001 を出し、日付は選べる", async () => {
    stubFetch(() =>
      jsonResponse({
        date: "2026-11-30",
        availableDates: ["2026-11-28"],
        themes: [],
        nodes: [],
        links: [],
      }),
    );
    render(<NewsGalaxyScreen />);
    expect(
      await screen.findByText("11月30日（月） の記事はありません。"),
    ).toBeTruthy();
    const dateSelect = screen.getByRole("combobox", { name: "日付" });
    expect((dateSelect as HTMLSelectElement).disabled).toBe(false);
    expect(screen.queryAllByTestId("news-node")).toHaveLength(0);
  });
});

describe("TC29 「保存」が失敗したら MSG-003 を下の知らせに出し、保存の印を変えない（FN-006 異常系、DD-06 E08）", () => {
  it("API が 500 を返すと、MSG-003（操作「保存」）が出て、ボタンは「保存」のまま", async () => {
    stubFetch(
      newsApi({
        "PUT /api/app/contents/1/saved": () =>
          jsonResponse(
            { error: { code: "internal", messageId: "MSG-003" } },
            500,
          ),
      }),
    );
    render(<NewsGalaxyScreen />);
    const sheet = await openA1();
    fireEvent.click(within(sheet).getByRole("button", { name: "保存" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(
      "保存できませんでした。もう一度押してください。",
    );
    expect(within(sheet).getByRole("button", { name: "保存" })).toBeTruthy();
    expect(
      within(sheet).queryByRole("button", { name: "保存を外す" }),
    ).toBeNull();
    const put = calls.find((call) => call.method === "PUT");
    expect(put?.url).toBe("/api/app/contents/1/saved");
    expect(put?.body).toBe(JSON.stringify({ isSaved: true }));
  });

  it("やり直して成功すると、知らせが消え、ボタンが「保存を外す」に替わる", async () => {
    let fail = true;
    stubFetch(
      newsApi({
        "PUT /api/app/contents/1/saved": () =>
          fail
            ? jsonResponse({ error: { code: "internal" } }, 500)
            : jsonResponse(
                stateOf(A1_DETAIL, {
                  isSaved: true,
                  savedAt: "2026-12-01T08:00:00.000+09:00",
                }),
              ),
      }),
    );
    render(<NewsGalaxyScreen />);
    const sheet = await openA1();
    fireEvent.click(within(sheet).getByRole("button", { name: "保存" }));
    await screen.findByRole("alert");

    fail = false;
    fireEvent.click(within(sheet).getByRole("button", { name: "保存" }));
    await within(sheet).findByRole("button", { name: "保存を外す" });
    // 知らせは消える動きの後に外れる。
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });

  it("「読んだ」が失敗すると、MSG-003（操作「既読に」）が出て、ボタンは「読んだ」のまま", async () => {
    stubFetch(
      newsApi({
        "PUT /api/app/contents/1/read": () => {
          throw new TypeError("Failed to fetch");
        },
      }),
    );
    render(<NewsGalaxyScreen />);
    const sheet = await openA1();
    fireEvent.click(within(sheet).getByRole("button", { name: "読んだ" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(
      "既読にできませんでした。もう一度押してください。",
    );
    expect(within(sheet).getByRole("button", { name: "読んだ" })).toBeTruthy();
  });
});

describe("M03 記事の案内（SCR-003）", () => {
  it("「読んだ」を押すと「未読に戻す」に替わり、図のノードが既読になる。結果が出るまで押せない", async () => {
    let resolve: (response: Response) => void = () => {};
    stubFetch(
      newsApi({
        "PUT /api/app/contents/1/read": () =>
          new Promise<Response>((r) => {
            resolve = r;
          }) as unknown as Response,
      }),
    );
    render(<NewsGalaxyScreen />);
    const sheet = await openA1();
    const button = within(sheet).getByRole("button", { name: "読んだ" });
    fireEvent.click(button);
    await waitFor(() =>
      expect((button as HTMLButtonElement).disabled).toBe(true),
    );
    fireEvent.click(button);
    expect(calls.filter((call) => call.method === "PUT")).toHaveLength(1);
    expect(calls.find((call) => call.method === "PUT")?.body).toBe(
      JSON.stringify({ isRead: true }),
    );

    resolve(jsonResponse(stateOf(A1_DETAIL, { isRead: true })));
    await within(sheet).findByRole("button", { name: "未読に戻す" });
    expect(nodeElement("今日の記事 A1").dataset.read).toBe("true");
  });

  it("記事が無ければ MSG-002 と戻る操作を出す", async () => {
    stubFetch(
      newsApi({
        "GET /api/app/news/articles/1": () =>
          jsonResponse(
            { error: { code: "not_found", messageId: "MSG-002" } },
            404,
          ),
      }),
    );
    render(<NewsGalaxyScreen />);
    await screen.findByText("今日の記事 A1");
    fireEvent.click(screen.getByText("今日の記事 A1"));
    const sheet = await screen.findByRole("dialog", { name: "記事の案内" });
    expect(
      await within(sheet).findByText("記事が見つかりません。"),
    ).toBeTruthy();
    fireEvent.click(within(sheet).getByRole("button", { name: "戻る" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "記事の案内" })).toBeNull(),
    );
  });

  it("案内を読めなければ MSG-019 を出す。markOpened が失敗しても案内を出したままで、知らせを出さない", async () => {
    stubFetch(
      newsApi({
        "POST /api/app/contents/1/opened": () =>
          jsonResponse({ error: { code: "internal" } }, 500),
      }),
    );
    render(<NewsGalaxyScreen />);
    const sheet = await openA1();
    await waitFor(() =>
      expect(calls.map((call) => call.url)).toContain(
        "/api/app/contents/1/opened",
      ),
    );
    expect(within(sheet).getByText("今日の記事 A1 の案内")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    cleanup();

    stubFetch(
      newsApi({
        "GET /api/app/news/articles/1": () =>
          jsonResponse({ error: { code: "internal" } }, 500),
      }),
    );
    render(<NewsGalaxyScreen />);
    await screen.findByText("今日の記事 A1");
    fireEvent.click(screen.getByText("今日の記事 A1"));
    const failedSheet = await screen.findByRole("dialog", {
      name: "記事の案内",
    });
    expect(
      await within(failedSheet).findByText(NEWS_MESSAGES["MSG-019"]),
    ).toBeTruthy();
  });

  it("届いた日時を日付と時刻で出す（SCR-003-O03）", async () => {
    stubFetch(newsApi());
    render(<NewsGalaxyScreen />);
    const sheet = await openA1();
    expect(sheet.textContent).toContain("AI ・ 12月1日（火） 07:00");
  });

  it("保存が成功した後に、先に呼んだ markOpened の古い応答が届いても、保存の印は戻らない", async () => {
    let resolveOpened: (response: Response) => void = () => {};
    stubFetch(
      newsApi({
        "POST /api/app/contents/1/opened": () =>
          new Promise<Response>((r) => {
            resolveOpened = r;
          }) as unknown as Response,
        "PUT /api/app/contents/1/saved": () =>
          jsonResponse(
            stateOf(A1_DETAIL, {
              isSaved: true,
              savedAt: "2026-12-01T08:00:00.000+09:00",
            }),
          ),
      }),
    );
    render(<NewsGalaxyScreen />);
    const sheet = await openA1();
    await waitFor(() =>
      expect(calls.map((call) => call.url)).toContain(
        "/api/app/contents/1/opened",
      ),
    );
    fireEvent.click(within(sheet).getByRole("button", { name: "保存" }));
    await within(sheet).findByRole("button", { name: "保存を外す" });

    // 保存より前の状態（isSaved false）を持つ、開いたときの応答が後から届く。
    await act(async () => {
      resolveOpened(jsonResponse(stateOf(A1_DETAIL, {})));
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(
      within(sheet).getByRole("button", { name: "保存を外す" }),
    ).toBeTruthy();
    expect(within(sheet).queryByRole("button", { name: "保存" })).toBeNull();
  });

  it("「AI に質問」を押すと、この記事の内容ID を渡す（SCR-003-A05）", async () => {
    stubFetch(newsApi());
    const onAskAi = vi.fn();
    render(<NewsGalaxyScreen onAskAi={onAskAi} />);
    const sheet = await openA1();
    fireEvent.click(within(sheet).getByRole("button", { name: "AI に質問" }));
    expect(onAskAi).toHaveBeenCalledWith(1);
  });
});

describe("M03 News Galaxy（SCR-002）", () => {
  it("上の帯に「AI に質問」を置かない。中心の記事を選んでも出ない（SCR-002-A05 は CR-018 でやめた）", async () => {
    stubFetch(newsApi());
    const onAskAi = vi.fn();
    render(<NewsGalaxyRoute onAskAi={onAskAi} />);
    await screen.findByText("今日の記事 A1");
    const header = screen.getByRole("banner");
    expect(
      within(header).queryByRole("button", { name: "AI に質問" }),
    ).toBeNull();

    const sheet = await openA1();
    expect(nodeElement("今日の記事 A1").dataset.center).toBe("true");
    expect(
      within(header).queryByRole("button", { name: "AI に質問", hidden: true }),
    ).toBeNull();
    // 「AI に質問」は記事の案内から開く（SCR-003-A05）。
    fireEvent.click(within(sheet).getByRole("button", { name: "AI に質問" }));
    expect(onAskAi).toHaveBeenCalledWith(1);
  });

  it("日付を選ぶと、その日を読み直す。選択肢は availableDates の新しい順", async () => {
    stubFetch((call) =>
      call.url === "/api/app/news/galaxy"
        ? jsonResponse(TC19_GALAXY)
        : jsonResponse({
            ...TC19_GALAXY,
            date: "2026-11-28",
            themes: ["AI"],
            nodes: [P1],
            links: [],
          }),
    );
    render(<NewsGalaxyScreen />);
    await screen.findByText("今日の記事 A1");
    const dateSelect = screen.getByRole("combobox", { name: "日付" });
    expect(
      within(dateSelect)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["12月1日（火）", "11月28日（土）", "11月23日（月）"]);

    fireEvent.change(dateSelect, { target: { value: "2026-11-28" } });
    await waitFor(() => expect(shownTitles()).toEqual(["3日前の記事 P1"]));
    expect(calls.map((call) => call.url)).toEqual([
      "/api/app/news/galaxy",
      "/api/app/news/galaxy?date=2026-11-28",
    ]);
  });

  it("読めなければ MSG-019 を出す", async () => {
    stubFetch(() => jsonResponse({ error: { code: "internal" } }, 500));
    render(<NewsGalaxyScreen />);
    expect(await screen.findByText(NEWS_MESSAGES["MSG-019"])).toBeTruthy();
  });

  it("既読の記事のノードは薄く出す（SCR-002-O01）", async () => {
    stubFetch(() =>
      jsonResponse({
        ...TC19_GALAXY,
        nodes: [{ ...A1, isRead: true, isNew: false }, A2],
        links: [],
      }),
    );
    render(<NewsGalaxyScreen />);
    await screen.findByText("今日の記事 A1");
    expect(nodeElement("今日の記事 A1").className).toContain("opacity-50");
    expect(nodeElement("今日の記事 A2").className).not.toContain("opacity-50");
  });

  it("M03 の文言は M23 の MSG と同じ", () => {
    for (const [id, text] of Object.entries(NEWS_MESSAGES)) {
      expect(text).toBe(MESSAGES[id as keyof typeof MESSAGES].text);
    }
  });
});
