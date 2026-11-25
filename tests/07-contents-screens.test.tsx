// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchInbox, fetchSaved, fetchSearch } from "../src/client/contents";
import { onDeviceUnauthorized } from "../src/client/device-api";
import type { ContentSummary } from "../src/contracts/contents";
import { ExploreScreen } from "../src/screens/lists/explore-screen";
import { InboxScreen } from "../src/screens/lists/inbox-screen";
import { LibraryScreen } from "../src/screens/lists/library-screen";
import { LIST_MESSAGES } from "../src/screens/lists/messages";
import { MESSAGES } from "../src/server/shared/messages";

// 07-contents の実装単位4。通信層 M09（src/client/contents.ts）と、一覧の画面 M05
// （SCR-007 Inbox、SCR-008 Explore、SCR-009 Library）。

const NOW = new Date("2026-11-25T03:00:00.000Z"); // 日本時間 2026-11-25 12:00

function summary(overrides: Partial<ContentSummary> = {}): ContentSummary {
  return {
    contentId: "c1",
    kind: "news",
    title: "記事の見出し",
    targetDate: "2026-11-24",
    receivedAt: "2026-11-24T05:30:00.000+09:00",
    isNew: true,
    isRead: false,
    isSaved: false,
    savedAt: null,
    ...overrides,
  };
}

const PAGE = {
  items: [
    summary(),
    summary({
      contentId: "c2",
      kind: "english",
      title: "英語の教材",
      receivedAt: "2025-12-31T23:59:59.000+09:00",
      isNew: false,
      isRead: true,
      isSaved: true,
      savedAt: "2026-11-23T21:05:00.000+09:00",
    }),
  ],
  nextCursor: null,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

function stubFetch(
  respond: (url: string) => Response | Promise<Response>,
): void {
  fetchMock = vi.fn(async (input: RequestInfo | URL) => respond(String(input)));
  vi.stubGlobal("fetch", fetchMock);
}

function calledUrls(): string[] {
  return fetchMock.mock.calls.map(([input]) => String(input));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  window.sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// 時刻の形（05:30、23:59 など）。
const TIME_PATTERN = /\d{1,2}:\d{2}/;

async function searchFor(term: string): Promise<void> {
  fireEvent.change(screen.getByRole("searchbox", { name: "検索の言葉" }), {
    target: { value: term },
  });
  fireEvent.click(screen.getByRole("button", { name: "探す" }));
}

describe("TC84 一覧の行に日付だけが出て、時刻が出ない（BD-09 5章 表示書式、CR-004）", () => {
  it("Inbox は届いた日を出し、時刻を出さない", async () => {
    stubFetch(() => jsonResponse(PAGE));
    const { container } = render(<InboxScreen />);
    const rows = await screen.findAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("11月24日（火）");
    expect(rows[1].textContent).toContain("2025年12月31日");
    expect(container.textContent).not.toMatch(TIME_PATTERN);
    expect(calledUrls()).toEqual(["/api/app/contents/inbox"]);
  });

  it("Explore は届いた日を出し、時刻を出さない", async () => {
    stubFetch(() => jsonResponse(PAGE));
    const { container } = render(<ExploreScreen />);
    await searchFor("AI");
    const rows = await screen.findAllByRole("listitem");
    expect(rows[0].textContent).toContain("11月24日（火）");
    expect(rows[1].textContent).toContain("2025年12月31日");
    expect(container.textContent).not.toMatch(TIME_PATTERN);
    expect(calledUrls()).toEqual(["/api/app/contents/search?q=AI"]);
  });

  it("Library は保存した日を出し、時刻を出さない", async () => {
    stubFetch(() =>
      jsonResponse({
        items: [PAGE.items[1]],
        nextCursor: null,
      }),
    );
    const { container } = render(<LibraryScreen />);
    const rows = await screen.findAllByRole("listitem");
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain("11月23日（月）");
    expect(rows[0].textContent).not.toContain("2025年12月31日");
    expect(container.textContent).not.toMatch(TIME_PATTERN);
    expect(calledUrls()).toEqual(["/api/app/contents/saved"]);
  });
});

describe("M05 一覧の行", () => {
  it("種類の名前と色の印を出し、押すとニュースは /news?article=、英語は /english/ へ移る", async () => {
    stubFetch(() => jsonResponse(PAGE));
    render(<InboxScreen />);
    const links = await screen.findAllByRole("link");
    expect(links[0].getAttribute("href")).toBe("/news?article=c1");
    expect(links[0].textContent).toContain("ニュース");
    expect(links[0].textContent).toContain("記事の見出し");
    expect(links[1].getAttribute("href")).toBe("/english/c2");
    expect(links[1].textContent).toContain("英語");
    const marks = screen.getAllByTestId("kind-mark");
    expect(marks[0].style.backgroundColor).toBe("rgb(90, 169, 255)");
    expect(marks[1].style.backgroundColor).toBe("rgb(255, 176, 64)");
  });

  it("Inbox は新着のタグと未読の印を分けて出す（SCR-007-O04）", async () => {
    stubFetch(() =>
      jsonResponse({
        items: [
          summary({ contentId: "a", isNew: true, isRead: false }),
          summary({ contentId: "b", isNew: false, isRead: false }),
          summary({ contentId: "c", isNew: true, isRead: true }),
        ],
        nextCursor: null,
      }),
    );
    render(<InboxScreen />);
    const rows = await screen.findAllByRole("listitem");
    expect(rows[0].textContent).toContain("新着");
    expect(rows[0].textContent).toContain("未読");
    expect(rows[1].textContent).not.toContain("新着");
    expect(rows[1].textContent).toContain("未読");
    expect(rows[2].textContent).toContain("新着");
    expect(rows[2].textContent).not.toContain("未読");
  });

  it("Library と Explore には新着のタグと未読の印を出さない", async () => {
    stubFetch(() => jsonResponse({ items: [summary()], nextCursor: null }));
    render(<LibraryScreen />);
    const [row] = await screen.findAllByRole("listitem");
    expect(row.textContent).not.toContain("新着");
    expect(row.textContent).not.toContain("未読");
  });
});

describe("M05 画面の状態（BD-03 3.5）", () => {
  it("読み込み中は待つ印を出す", async () => {
    let resolve: (response: Response) => void = () => {};
    stubFetch(
      () =>
        new Promise<Response>((r) => {
          resolve = r;
        }),
    );
    render(<InboxScreen />);
    expect(screen.getByRole("status").textContent).toContain("読み込み中");
    resolve(jsonResponse(PAGE));
    await screen.findAllByRole("listitem");
  });

  it.each([
    ["Inbox", () => <InboxScreen />, LIST_MESSAGES["MSG-008"]],
    ["Library", () => <LibraryScreen />, LIST_MESSAGES["MSG-010"]],
  ])("%s の0件は空の状態を出す", async (_name, screenOf, message) => {
    stubFetch(() => jsonResponse({ items: [], nextCursor: null }));
    render(screenOf());
    expect(await screen.findByText(message)).toBeTruthy();
  });

  it("Explore の0件は MSG-009 に言葉を差し込んで出す", async () => {
    stubFetch(() => jsonResponse({ items: [], nextCursor: null }));
    render(<ExploreScreen />);
    await searchFor("量子 計算");
    expect(
      await screen.findByText("「量子 計算」に当たる内容はありません。"),
    ).toBeTruthy();
  });

  it.each([
    ["500", () => jsonResponse({ code: "x", message: "MSG-019" }, 500)],
    ["形が違う応答", () => jsonResponse({ items: [{ contentId: 1 }] })],
    [
      "つながらない",
      () => {
        throw new TypeError("Failed to fetch");
      },
    ],
  ])("読めないとき（%s）は MSG-019 を出す", async (_name, respond) => {
    stubFetch(respond);
    render(<InboxScreen />);
    expect(await screen.findByText(LIST_MESSAGES["MSG-019"])).toBeTruthy();
  });

  it("401 のときは何も出さず、M01 の枠に MSG-020 を渡す", async () => {
    stubFetch(() => jsonResponse({ code: "unauthorized" }, 401));
    const listener = vi.fn();
    const off = onDeviceUnauthorized(listener);
    try {
      const { container } = render(<LibraryScreen />);
      await waitFor(() => expect(listener).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(container.textContent).toBe(""));
    } finally {
      off();
    }
  });
});

describe("M05 続きを読む（BD-09 5章 一覧の決まり）", () => {
  let observers: { callback: IntersectionObserverCallback }[];

  beforeEach(() => {
    observers = [];
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        callback: IntersectionObserverCallback;
        constructor(callback: IntersectionObserverCallback) {
          this.callback = callback;
          observers.push(this);
        }
        observe() {}
        disconnect() {}
      },
    );
  });

  function reachBottom(): void {
    const observer = observers.at(-1);
    observer?.callback(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      observer as unknown as IntersectionObserver,
    );
  }

  it("下まで来ると nextCursor で続きを読み、一覧に足す。読み込み中はもう一度読まない", async () => {
    let resolveSecond: (response: Response) => void = () => {};
    stubFetch((url) => {
      if (!url.includes("cursor=")) {
        return jsonResponse({ items: [summary()], nextCursor: "next1" });
      }
      return new Promise<Response>((r) => {
        resolveSecond = r;
      });
    });
    render(<InboxScreen />);
    await screen.findAllByRole("listitem");
    reachBottom();
    reachBottom();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(calledUrls()[1]).toBe("/api/app/contents/inbox?cursor=next1");
    resolveSecond(
      jsonResponse({
        items: [summary({ contentId: "c9", title: "続きの記事" })],
        nextCursor: null,
      }),
    );
    expect(await screen.findByText("続きの記事")).toBeTruthy();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("続きを読めなければ一覧を残し、下に MSG-019 を出す", async () => {
    stubFetch((url) =>
      url.includes("cursor=")
        ? jsonResponse({ code: "x" }, 500)
        : jsonResponse({ items: [summary()], nextCursor: "next1" }),
    );
    render(<LibraryScreen />);
    await screen.findAllByRole("listitem");
    reachBottom();
    expect(await screen.findByText(LIST_MESSAGES["MSG-019"])).toBeTruthy();
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });
});

describe("M05 Explore（SCR-008）", () => {
  it("言葉が空か空白だけのときは「探す」を押せない", () => {
    stubFetch(() => jsonResponse(PAGE));
    render(<ExploreScreen />);
    const button = screen.getByRole("button", { name: "探す" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "  " },
    });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("言葉は 200 文字までにする", () => {
    stubFetch(() => jsonResponse(PAGE));
    render(<ExploreScreen />);
    const input = screen.getByRole("searchbox") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "あ".repeat(201) } });
    expect([...input.value]).toHaveLength(200);
  });

  it("探し直すと前の検索を止め、最後の検索の結果だけを出す", async () => {
    const signals: AbortSignal[] = [];
    fetchMock = vi.fn(
      (input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((resolve, reject) => {
          const signal = init?.signal as AbortSignal;
          signals.push(signal);
          if (String(input).includes("q=first")) {
            signal.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError")),
            );
            return;
          }
          resolve(
            jsonResponse({
              items: [summary({ title: "後の結果" })],
              nextCursor: null,
            }),
          );
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<ExploreScreen />);
    await searchFor("first");
    await waitFor(() => expect(signals).toHaveLength(1));
    await searchFor("second");
    expect(await screen.findByText("後の結果")).toBeTruthy();
    expect(signals[0].aborted).toBe(true);
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });

  it("画面を離れて戻ると、前に探した言葉を欄に戻して結果を読む（SCR-008-A01）", async () => {
    stubFetch(() => jsonResponse(PAGE));
    const first = render(<ExploreScreen />);
    await searchFor(" 半導体 ");
    await screen.findAllByRole("listitem");
    first.unmount();

    fetchMock.mockClear();
    render(<ExploreScreen />);
    const input = screen.getByRole("searchbox") as HTMLInputElement;
    await waitFor(() => expect(input.value).toBe("半導体"));
    await screen.findAllByRole("listitem");
    expect(calledUrls()).toEqual([
      `/api/app/contents/search?q=${encodeURIComponent("半導体")}`,
    ]);
  });

  it("初めて開いたときは欄だけを出し、探さない", async () => {
    stubFetch(() => jsonResponse(PAGE));
    const { container } = render(<ExploreScreen />);
    await Promise.resolve();
    expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("");
    expect(container.querySelector("ul")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("M09 一覧と検索の呼び出し", () => {
  it("cursor と q を問い合わせに付ける", async () => {
    stubFetch(() => jsonResponse(PAGE));
    await fetchInbox({ cursor: "abc" });
    await fetchSaved({ cursor: null });
    await fetchSearch("a b&c", { cursor: "xyz" });
    expect(calledUrls()).toEqual([
      "/api/app/contents/inbox?cursor=abc",
      "/api/app/contents/saved",
      "/api/app/contents/search?cursor=xyz&q=a+b%26c",
    ]);
  });

  it("正しい形の応答は ok で返す", async () => {
    stubFetch(() => jsonResponse(PAGE));
    expect(await fetchInbox()).toEqual({ status: "ok", page: PAGE });
  });

  it.each([
    ["items が無い", { nextCursor: null }],
    [
      "日時に時差が無い",
      {
        items: [summary({ receivedAt: "2026-11-24T05:30:00Z" })],
        nextCursor: null,
      },
    ],
    [
      "isNew が真偽値でない",
      { items: [{ ...summary(), isNew: "yes" }], nextCursor: null },
    ],
  ])("形が違う応答（%s）は failed で返す", async (_name, body) => {
    stubFetch(() => jsonResponse(body));
    expect(await fetchSaved()).toEqual({ status: "failed" });
  });

  it("401 は unauthorized、ほかの失敗は failed で返す", async () => {
    stubFetch(() => jsonResponse({}, 401));
    expect(await fetchInbox()).toEqual({ status: "unauthorized" });
    stubFetch(() => jsonResponse({}, 400));
    expect(await fetchSearch("x")).toEqual({ status: "failed" });
    stubFetch(() => new Response("not json", { status: 200 }));
    expect(await fetchInbox()).toEqual({ status: "failed" });
  });

  it("呼んだ画面が止めたときは AbortError を投げる", async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        controller.abort();
        throw new DOMException("aborted", "AbortError");
      }),
    );
    await expect(
      fetchInbox({ signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("M05 の MSG の文言", () => {
  it("サーバの側の MSG の一覧（M23）と同じ", () => {
    for (const [id, text] of Object.entries(LIST_MESSAGES)) {
      expect(text).toBe(MESSAGES[id as keyof typeof MESSAGES].text);
    }
  });
});
