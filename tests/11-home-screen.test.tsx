// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { homeSchema, type Home } from "../src/contracts/home";
import { HomeScreen, LEAVE_STEP_MS } from "../src/screens/home/home-screen";
import {
  cardOffset,
  selectedAt,
  snapTurn,
  turnToSelect,
} from "../src/screens/home/hud-angle";
import { HOME_MESSAGES } from "../src/screens/home/messages";
import { MESSAGES } from "../src/server/shared/messages";

// 11-home の実装単位2。ホームの画面 M02（BD-03 SCR-001、BD-13 P01）。
// 動きを減らす設定の TC114 は 11-home-screen-reduced-motion.test.tsx。

const NOW = new Date("2026-11-30T23:00:00.000Z"); // 日本時間 2026-12-01 08:00

const HOME: Home = {
  newCount: 12,
  unreadCount: 18,
  learning: { contentId: 7, learningTheme: "文型", isCompleted: false },
  ai: { writingCount: 2, hasFailure: true },
  picks: [
    {
      contentId: 11,
      title: "記事 A",
      theme: "AI",
      imageUrl: "https://example.com/a.png",
    },
    { contentId: 12, title: "記事 B", theme: "半導体", imageUrl: null },
  ],
  notices: ["MSG-015", "MSG-016", "MSG-017"],
};

// 機能の画面へ移った道（A03）。止められずに押された道（a 要素）を、押された順に記録する。
// React の受け口（画面の根）の後で受けるため、document で聞く。
let navigations: string[] = [];
function recordNavigation(event: MouseEvent) {
  const anchor = (event.target as Element).closest("a");
  if (anchor !== null && !event.defaultPrevented) {
    navigations.push(anchor.getAttribute("href") ?? "");
  }
}

let fetchMock: ReturnType<typeof vi.fn>;

function stubHome(respond: () => Response | Promise<Response>) {
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    if (String(input) === "/api/app/home") return respond();
    throw new Error(`呼んではいけない API: ${String(input)}`);
  });
  vi.stubGlobal("fetch", fetchMock);
}

function card(key: string): HTMLElement {
  return screen.getByTestId(`card-${key}`);
}

beforeEach(() => {
  stubHome(() => Response.json(HOME));
  navigations = [];
  document.addEventListener("click", recordNavigation);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.removeEventListener("click", recordNavigation);
});

describe("ホームの値を出す（SCR-001-A01）", () => {
  it("未読、新着、学習の続き、AI の応答中、今日のピックアップを出す", async () => {
    render(<HomeScreen now={NOW} />);
    const status = await screen.findByRole("region", { name: "ホームの数" });
    await within(status).findByText("18");
    expect(within(status).getByText("12")).toBeTruthy();
    expect(within(status).getByText("2")).toBeTruthy();
    // 完了していない学習の続きは、その教材（SCR-005）を開く。
    expect(
      within(status).getByRole("link", { name: "文型" }).getAttribute("href"),
    ).toBe("/english/7");

    const pickup = screen.getByRole("region", { name: "今日のピックアップ" });
    const links = within(pickup).getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/news?article=11",
      "/news?article=12",
    ]);
    expect(within(links[0]).getByText("記事 A")).toBeTruthy();
    expect(within(links[1]).getByText("半導体")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("日付を日本時間の今日で出す", async () => {
    render(<HomeScreen now={NOW} />);
    expect(screen.getByText("12月1日（火）")).toBeTruthy();
  });

  it("未着と失敗の知らせは、該当する機能のカードの中に出す（BD-09 2章）", async () => {
    render(<HomeScreen now={NOW} />);
    await within(card("news")).findByText(HOME_MESSAGES["MSG-015"]);
    expect(
      within(card("english")).getByText(HOME_MESSAGES["MSG-016"]),
    ).toBeTruthy();
    expect(
      within(card("chat")).getByText(HOME_MESSAGES["MSG-017"]),
    ).toBeTruthy();
    for (const key of ["inbox", "explore", "library"]) {
      expect(within(card(key)).queryByText(/届いていません|失敗/)).toBeNull();
    }
  });

  it("知らせが無ければ、カードに知らせを出さない", async () => {
    stubHome(() => Response.json({ ...HOME, notices: [] }));
    render(<HomeScreen now={NOW} />);
    await screen.findByRole("link", { name: "文型" });
    for (const text of [
      HOME_MESSAGES["MSG-015"],
      HOME_MESSAGES["MSG-016"],
      HOME_MESSAGES["MSG-017"],
    ]) {
      expect(screen.queryByText(text)).toBeNull();
    }
  });

  it("0件のものは0か空にする（RD-03 R21）", async () => {
    stubHome(() =>
      Response.json({
        newCount: 0,
        unreadCount: 0,
        learning: null,
        ai: { writingCount: 0, hasFailure: false },
        picks: [],
        notices: [],
      } satisfies Home),
    );
    render(<HomeScreen now={NOW} />);
    const status = await screen.findByRole("region", { name: "ホームの数" });
    expect(await within(status).findAllByText("0")).toHaveLength(3);
    expect(within(status).queryByRole("link")).toBeNull();
    const pickup = screen.getByRole("region", { name: "今日のピックアップ" });
    expect(within(pickup).queryAllByRole("listitem")).toHaveLength(0);
  });

  it("完了した学習の続きは「完了」を出し、開く操作にしない", async () => {
    stubHome(() =>
      Response.json({
        ...HOME,
        learning: { contentId: 7, learningTheme: "文型", isCompleted: true },
      }),
    );
    render(<HomeScreen now={NOW} />);
    const status = await screen.findByRole("region", { name: "ホームの数" });
    await within(status).findByText("完了");
    expect(within(status).queryByRole("link")).toBeNull();
  });

  it("読み込み中は数の場所に待つ印を出し、HUD とカードは出して操作できる", () => {
    stubHome(() => new Promise<Response>(() => {}));
    render(<HomeScreen now={NOW} />);
    const status = screen.getByRole("region", { name: "ホームの数" });
    expect(within(status).getByText("読み込み中")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Inbox" }));
    expect(card("inbox").dataset.front).toBe("true");
  });

  it("読めなければ数の場所に MSG-019 を出し、HUD とカードは出す", async () => {
    stubHome(() => Response.json({}, { status: 500 }));
    render(<HomeScreen now={NOW} />);
    const status = screen.getByRole("region", { name: "ホームの数" });
    await within(status).findByText(HOME_MESSAGES["MSG-019"]);
    expect(screen.getByRole("button", { name: "English" })).toBeTruthy();
    expect(card("news").dataset.front).toBe("true");
  });

  it("応答の形が違えば MSG-019 を出す", async () => {
    stubHome(() => Response.json({ ...HOME, newCount: -1 }));
    render(<HomeScreen now={NOW} />);
    await screen.findByText(HOME_MESSAGES["MSG-019"]);
  });

  it("401（MSG-020）のときは数の場所に何も出さない（全面の知らせは M01 の枠が出す）", async () => {
    stubHome(() => Response.json({}, { status: 401 }));
    render(<HomeScreen now={NOW} />);
    const status = screen.getByRole("region", { name: "ホームの数" });
    await vi.waitFor(() =>
      expect(within(status).queryByText("読み込み中")).toBeNull(),
    );
    expect(screen.queryByText(HOME_MESSAGES["MSG-019"])).toBeNull();
  });
});

describe("HUD とカード（SCR-001-A02、A03、A05。BD-13 P01）", () => {
  it("初めは News Galaxy を選び、そのカードを前に出す", async () => {
    render(<HomeScreen now={NOW} />);
    expect(
      screen.getByRole("button", { name: "News Galaxy" }).ariaPressed,
    ).toBe("true");
    expect(card("news").dataset.front).toBe("true");
    expect(
      screen.getByRole("link", { name: /^News Galaxy/ }).getAttribute("href"),
    ).toBe("/news");
    await screen.findByRole("link", { name: "文型" });
  });

  it("セグメントを押すと選ぶだけで移らない。前のカードを押すと移る", async () => {
    render(<HomeScreen now={NOW} />);
    await screen.findByRole("link", { name: "文型" });
    fireEvent.click(screen.getByRole("button", { name: "Library" }));
    expect(screen.getByRole("button", { name: "Library" }).ariaPressed).toBe(
      "true",
    );
    expect(card("library").dataset.front).toBe("true");
    expect(
      screen.getByRole("link", { name: /^Library/ }).getAttribute("href"),
    ).toBe("/library");
  });

  it("6つの機能の前のカードは、遷移表の画面へ移る", async () => {
    render(<HomeScreen now={NOW} />);
    await screen.findByRole("link", { name: "文型" });
    const expected: [string, string][] = [
      ["News Galaxy", "/news"],
      ["English", "/english"],
      ["Inbox", "/inbox"],
      ["Explore", "/explore"],
      ["Library", "/library"],
    ];
    for (const [name, href] of expected) {
      fireEvent.click(screen.getByRole("button", { name }));
      expect(
        screen
          .getByRole("link", { name: new RegExp(`^${name}`) })
          .getAttribute("href"),
      ).toBe(href);
    }
  });

  it("奥のカードを押すと、その機能を選ぶ", async () => {
    render(<HomeScreen now={NOW} />);
    await screen.findByRole("link", { name: "文型" });
    fireEvent.click(within(card("english")).getByRole("button"));
    expect(card("english").dataset.front).toBe("true");
    expect(screen.getByRole("button", { name: "English" }).ariaPressed).toBe(
      "true",
    );
  });

  it("カードに件数と学習テーマを出す", async () => {
    render(<HomeScreen now={NOW} />);
    await within(card("english")).findByText("文型");
    expect(within(card("inbox")).getByText("12")).toBeTruthy();
    expect(within(card("chat")).getByText("2")).toBeTruthy();
  });

  it("中心の AI の印、AI Chat の前のカード、「AI に質問」は、対象の無い AI チャットを開く", async () => {
    stubHome(() => Response.json(HOME));
    const openers: (() => void)[] = [
      () =>
        fireEvent.click(
          screen.getByRole("button", { name: "AI チャットを開く" }),
        ),
      () => fireEvent.click(screen.getByRole("button", { name: "AI に質問" })),
      () => {
        fireEvent.click(screen.getByRole("button", { name: "AI Chat" }));
        fireEvent.click(within(card("chat")).getByRole("button"));
      },
    ];
    for (const open of openers) {
      render(<HomeScreen now={NOW} />);
      await screen.findByRole("link", { name: "文型" });
      expect(screen.queryByText("AI チャット")).toBeNull();
      open();
      expect(await screen.findByText("AI チャット")).toBeTruthy();
      cleanup();
    }
  });
});

describe("機能の画面へ移る動き（SCR-001-A03。RD-07 3章）", () => {
  function advance(ms: number) {
    act(() => {
      vi.advanceTimersByTime(ms);
    });
  }

  it("前のカードを押すと、セグメントの光 → カードの移動 → 広がる、の順に動かしてから移る", async () => {
    render(<HomeScreen now={NOW} />);
    await screen.findByRole("link", { name: "文型" });
    vi.useFakeTimers();
    const segment = screen.getByRole("button", { name: "News Galaxy" });
    const link = screen.getByRole("link", { name: /^News Galaxy/ });

    // 道のとおりにすぐには移らない（動きの後で移る）。
    expect(fireEvent.click(link)).toBe(false);

    // 1. セグメントの光。カードはまだ動かず、広がってもいない。
    expect(segment.dataset.flashing).toBe("true");
    expect(card("news").dataset.leaving).toBeUndefined();
    expect(screen.queryByTestId("home-leave-expand")).toBeNull();
    expect(navigations).toEqual([]);

    // 2. カードの移動。
    advance(LEAVE_STEP_MS.glow);
    expect(card("news").dataset.leaving).toBe("true");
    expect(screen.queryByTestId("home-leave-expand")).toBeNull();
    expect(navigations).toEqual([]);

    // 3. 広がる。
    advance(LEAVE_STEP_MS.move);
    expect(screen.getByTestId("home-leave-expand")).toBeTruthy();
    expect(navigations).toEqual([]);

    // 4. 移る。
    advance(LEAVE_STEP_MS.expand - 1);
    expect(navigations).toEqual([]);
    advance(1);
    expect(navigations).toEqual(["/news"]);
  });

  it("移る動きの間は、もう一度押しても受けない", async () => {
    render(<HomeScreen now={NOW} />);
    await screen.findByRole("link", { name: "文型" });
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "Inbox" }));
    const link = screen.getByRole("link", { name: /^Inbox/ });

    fireEvent.click(link);
    advance(LEAVE_STEP_MS.glow);
    // 同じカードをもう一度押しても、道のとおりに移らず、動きもやり直さない。
    expect(fireEvent.click(link)).toBe(false);
    expect(card("inbox").dataset.leaving).toBe("true");
    // ほかのセグメント、奥のカード、学習の続き、AI の印も受けない。
    fireEvent.click(screen.getByRole("button", { name: "Library" }));
    fireEvent.click(within(card("english")).getByRole("button"));
    expect(fireEvent.click(screen.getByRole("link", { name: "文型" }))).toBe(
      false,
    );
    fireEvent.click(screen.getByRole("button", { name: "AI チャットを開く" }));
    expect(card("inbox").dataset.front).toBe("true");
    expect(screen.queryByText("AI チャット")).toBeNull();

    advance(LEAVE_STEP_MS.move + LEAVE_STEP_MS.expand);
    expect(navigations).toEqual(["/inbox"]);
    advance(1000);
    expect(navigations).toHaveLength(1);
  });

  it("学習の続きを押すと、English を光らせて同じ順に動かし、その教材へ移る", async () => {
    render(<HomeScreen now={NOW} />);
    const learning = await screen.findByRole("link", { name: "文型" });
    vi.useFakeTimers();

    expect(fireEvent.click(learning)).toBe(false);
    const english = screen.getByRole("button", { name: "English" });
    expect(english.ariaPressed).toBe("true");
    expect(english.dataset.flashing).toBe("true");
    expect(card("english").dataset.front).toBe("true");

    advance(LEAVE_STEP_MS.glow);
    expect(card("english").dataset.leaving).toBe("true");
    advance(LEAVE_STEP_MS.move);
    expect(screen.getByTestId("home-leave-expand")).toBeTruthy();
    advance(LEAVE_STEP_MS.expand);
    expect(navigations).toEqual(["/english/7"]);
  });
});

describe("画像と飾り（BD-03 SCR-001 3.2）", () => {
  it("中心の球、右上の惑星、ロゴは Codex が作った画像を出す", async () => {
    const { container } = render(<HomeScreen now={NOW} />);
    expect(screen.getByTestId("hud-core").getAttribute("href")).toBe(
      "/img/home/core_orb_001.png",
    );
    const planet = screen.getByTestId("home-planet");
    expect(planet.getAttribute("src")).toBe("/img/home/planet_001.png");
    // 惑星は飾りで、機能を持たない。
    expect(planet.closest("a, button, [role=button]")).toBeNull();
    expect(
      container.querySelector('img[src="/img/home/logo_001.png"]'),
    ).toBeTruthy();
    await screen.findByRole("link", { name: "文型" });
  });

  it("写真の無い記事には代わりの絵を出す", async () => {
    render(<HomeScreen now={NOW} />);
    const pickup = await screen.findByRole("region", {
      name: "今日のピックアップ",
    });
    const links = await within(pickup).findAllByRole("link");
    expect(links[0].querySelector("img")?.getAttribute("src")).toBe(
      "https://example.com/a.png",
    );
    expect(
      within(links[1]).getByTestId("pick-fallback").getAttribute("src"),
    ).toBe("/img/home/news_fallback_001.png");
  });
});

describe("HUD の角度（BD-03 SCR-001-A02）", () => {
  it("指で約70度回すと隣の機能を選び、離すとその機能に合わせる（BD-13 P01）", () => {
    expect(selectedAt(-70, 6)).toBe(1);
    expect(snapTurn(-70)).toBe(-60);
    expect(selectedAt(-25, 6)).toBe(0);
    expect(snapTurn(-25)).toBe(-0);
    expect(selectedAt(70, 6)).toBe(5);
    expect(selectedAt(-400, 6)).toBe(1);
  });

  it("セグメントを押すと、近い向きに回る", () => {
    expect(turnToSelect(0, 1)).toBe(-60);
    expect(turnToSelect(0, 5)).toBe(60);
    expect(turnToSelect(-60, 5)).toBe(60);
    expect(turnToSelect(-300, 0)).toBe(-360);
  });

  it("選んだ機能を真ん中にして、前と次のカードを上と下に置く", () => {
    expect([0, 1, 2, 3, 4, 5].map((i) => cardOffset(i, 0, 6))).toEqual([
      0, 1, 2, 3, -2, -1,
    ]);
  });
});

describe("文言と形", () => {
  it("M02 の文言は M23 の MSG と同じ", () => {
    for (const [id, text] of Object.entries(HOME_MESSAGES)) {
      expect(text).toBe(MESSAGES[id as keyof typeof MESSAGES].text);
    }
  });

  it("M10 の形はピックアップを3件までにする（openapi.yaml の Home）", () => {
    const pick = HOME.picks[0];
    expect(homeSchema.safeParse(HOME).success).toBe(true);
    expect(
      homeSchema.safeParse({ ...HOME, picks: [pick, pick, pick, pick] })
        .success,
    ).toBe(false);
    expect(
      homeSchema.safeParse({ ...HOME, notices: ["MSG-019"] }).success,
    ).toBe(false);
  });
});
