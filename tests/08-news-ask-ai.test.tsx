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
import NewsRoute from "../src/app/(screens)/news/page";
import type { ArticleDetail, Galaxy, GalaxyNode } from "../src/contracts/news";
import { installReactFlowStubs } from "./fixtures/react-flow";

// 08-news の実装単位3。記事の案内の「AI に質問」（SCR-003-A05）を押すと、その記事を対象（kind: "article" と内容ID）に AI チャットの面
// SCR-006（M06 の ChatSheet）を下から開く。記事の案内を全画面で開いたとき（/news?article={contentId}）も
// 同じにする（BD-03 SCR-003-A05・4章、DD-01 M01・M03・M06）。上の帯の「AI に質問」（SCR-002-A05）は
// CR-018 でやめたので、上の帯に出ないことを確かめる。
// 道（M01）の `/news` の入口（page.tsx）を描いて確かめる。質問の対象は、AI チャットの面が呼ぶ
// `listConversations` の targetContentId と、`createConversation` の本文の target で確かめる。

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
    useSearchParams: () => new URLSearchParams(currentSearch),
  };
});

let currentSearch = "";

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

const GALAXY: Galaxy = {
  date: "2026-12-01",
  availableDates: ["2026-12-01"],
  themes: ["AI", "半導体"],
  nodes: [A1, A2, A3],
  links: [{ fromContentId: 1, toContentId: 2, relationType: "follow_up" }],
};

function detailOf(
  base: GalaxyNode,
  related: ArticleDetail["related"],
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
    },
    related,
  };
}

const DETAILS: Record<number, ArticleDetail> = {
  1: detailOf(A1, [
    {
      node: A2,
      relationType: "follow_up",
      reason: "A2 は A1 の続き",
      direction: "from",
    },
  ]),
  2: detailOf(A2, [
    {
      node: A1,
      relationType: "follow_up",
      reason: "A2 は A1 の続き",
      direction: "to",
    },
  ]),
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

type Call = { url: string; method: string; body: string | null };
let calls: Call[];

// 図、案内、会話の API。会話は前の会話が無いものとして、対象どおりに新しい会話を作る。
function stubApi(): void {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const call: Call = {
        url: String(input),
        method: init?.method ?? "GET",
        body: typeof init?.body === "string" ? init.body : null,
      };
      calls.push(call);
      const key = `${call.method} ${call.url}`;
      if (key === "GET /api/app/news/galaxy") return jsonResponse(GALAXY);
      const article = /^GET \/api\/app\/news\/articles\/(\d+)$/.exec(key);
      if (article && DETAILS[Number(article[1])]) {
        return jsonResponse(DETAILS[Number(article[1])]);
      }
      const opened = /^POST \/api\/app\/contents\/(\d+)\/opened$/.exec(key);
      if (opened && DETAILS[Number(opened[1])]) {
        return jsonResponse({
          ...DETAILS[Number(opened[1])].state,
          isNew: false,
        });
      }
      if (
        call.method === "GET" &&
        call.url.startsWith("/api/app/conversations?")
      ) {
        return jsonResponse({ items: [], nextCursor: null });
      }
      if (key === "POST /api/app/conversations") {
        const { target } = JSON.parse(call.body ?? "{}") as {
          target?: { kind: string; contentId: number };
        };
        const title =
          target === undefined
            ? null
            : (DETAILS[target.contentId]?.title ?? null);
        return jsonResponse(
          {
            conversation: {
              conversationId: 50,
              target: target ?? null,
              targetTitle: title,
              firstQuestionText: null,
              startedAt: "2026-12-01T08:00:00.000+09:00",
              lastSpokenAt: "2026-12-01T08:00:00.000+09:00",
            },
            notice: null,
          },
          201,
        );
      }
      throw new Error(`知らない呼び出し: ${key}`);
    }),
  );
}

async function renderNews(search: Record<string, string> = {}) {
  currentSearch = new URLSearchParams(search).toString();
  const element = await NewsRoute({ searchParams: Promise.resolve(search) });
  return render(element);
}

function shownTitles(): string[] {
  return screen
    .queryAllByTestId("news-node")
    .map((element) => element.querySelector("p")?.textContent ?? "");
}

function nodeElement(title: string): HTMLElement {
  const found = screen
    .getAllByTestId("news-node")
    .find((element) => element.textContent?.includes(title));
  if (!found) throw new Error(`ノードが無い: ${title}`);
  return found;
}

// 図のノードを押して、記事の案内の面を開く。
async function openArticleSheet(title: string): Promise<HTMLElement> {
  await screen.findByText(title);
  fireEvent.click(nodeElement(title));
  const sheet = await screen.findByRole("dialog", { name: "記事の案内" });
  await within(sheet).findByText(`${title} の案内`);
  return sheet;
}

// AI チャットの面が開き、その面の質問の対象が、指定の記事であることを確かめる。
async function expectChatOpenedFor(contentId: number): Promise<HTMLElement> {
  const chat = await screen.findByRole("dialog", { name: "AI チャット" });
  await waitFor(() =>
    expect(
      calls.filter(
        (call) =>
          call.method === "POST" && call.url === "/api/app/conversations",
      ),
    ).toHaveLength(1),
  );
  const listCalls = calls.filter(
    (call) =>
      call.method === "GET" && call.url.startsWith("/api/app/conversations?"),
  );
  expect(listCalls.map((call) => call.url)).toEqual([
    `/api/app/conversations?targetContentId=${contentId}`,
  ]);
  const created = calls.find(
    (call) => call.method === "POST" && call.url === "/api/app/conversations",
  );
  expect(JSON.parse(created?.body ?? "null")).toEqual({
    target: { kind: "article", contentId },
  });
  return chat;
}

function chatCalls(): Call[] {
  return calls.filter((call) => call.url.startsWith("/api/app/conversations"));
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

describe("News Galaxy（/news）から AI チャットを開く", () => {
  it("記事を選び、記事の案内の「AI に質問」を押すと、その記事を対象に AI チャットの面が開く（SCR-003-A05）", async () => {
    stubApi();
    await renderNews();
    const sheet = await openArticleSheet("今日の記事 A1");
    expect(screen.queryByRole("dialog", { name: "AI チャット" })).toBeNull();
    expect(chatCalls()).toEqual([]);

    fireEvent.click(within(sheet).getByRole("button", { name: "AI に質問" }));
    await expectChatOpenedFor(1);
  });

  it("上の帯には「AI に質問」を置かず、中心の記事は記事の案内の「AI に質問」から開く（SCR-002-A05 は CR-018 でやめた）", async () => {
    stubApi();
    await renderNews();
    await screen.findByText("今日の記事 A2");
    // 上の帯（記事の案内の面を開く前の、ページの帯）。
    const header = screen.getByRole("banner");
    // A2 を押して中心にする。
    const sheet = await openArticleSheet("今日の記事 A2");
    expect(nodeElement("今日の記事 A2").dataset.center).toBe("true");
    expect(screen.queryByRole("dialog", { name: "AI チャット" })).toBeNull();
    expect(
      within(header).queryByRole("button", { name: "AI に質問", hidden: true }),
    ).toBeNull();

    fireEvent.click(within(sheet).getByRole("button", { name: "AI に質問" }));
    await expectChatOpenedFor(2);
  });

  it("AI チャットの面を閉じると、図と記事の案内がそのまま残っている", async () => {
    stubApi();
    await renderNews();
    const sheet = await openArticleSheet("今日の記事 A1");
    const titlesBefore = shownTitles();
    const articleCallsBefore = calls.filter((call) =>
      call.url.startsWith("/api/app/news/"),
    ).length;

    fireEvent.click(within(sheet).getByRole("button", { name: "AI に質問" }));
    const chat = await expectChatOpenedFor(1);

    fireEvent.click(within(chat).getByRole("button", { name: "閉じる" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "AI チャット" })).toBeNull(),
    );

    // 記事の案内の面は開いたままで、同じ記事の案内を出している。
    const still = screen.getByRole("dialog", { name: "記事の案内" });
    expect(within(still).getByText("今日の記事 A1 の案内")).toBeTruthy();
    expect(
      within(still).getByRole("button", { name: "AI に質問" }),
    ).toBeTruthy();
    // 図も同じノードを出し、中心は A1 のまま。
    expect(shownTitles()).toEqual(titlesBefore);
    expect(nodeElement("今日の記事 A1").dataset.center).toBe("true");
    // 図も案内も読み直していない。
    expect(
      calls.filter((call) => call.url.startsWith("/api/app/news/")).length,
    ).toBe(articleCallsBefore);
  });
});

describe("記事の案内を全画面で開いたとき（/news?article={contentId}）", () => {
  it("記事の案内の「AI に質問」を押すと、その記事を対象に AI チャットの面が開く（SCR-003-A05）", async () => {
    stubApi();
    await renderNews({ article: "2" });
    await screen.findByText("今日の記事 A2 の案内");
    expect(screen.queryByRole("dialog", { name: "AI チャット" })).toBeNull();
    expect(chatCalls()).toEqual([]);

    const askButtons = screen.getAllByRole("button", { name: "AI に質問" });
    // 案内の操作の並びの「AI に質問」（上の帯には置かない）。
    const inGuide = askButtons.filter(
      (button) => button.closest("header") === null,
    );
    expect(inGuide).toHaveLength(1);
    fireEvent.click(inGuide[0]);
    await expectChatOpenedFor(2);
  });

  it("AI チャットの面を閉じると、記事の案内がそのまま残っている", async () => {
    stubApi();
    await renderNews({ article: "2" });
    await screen.findByText("今日の記事 A2 の案内");
    const inGuide = screen
      .getAllByRole("button", { name: "AI に質問" })
      .filter((button) => button.closest("header") === null);
    fireEvent.click(inGuide[0]);
    const chat = await expectChatOpenedFor(2);

    fireEvent.click(within(chat).getByRole("button", { name: "閉じる" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "AI チャット" })).toBeNull(),
    );
    expect(screen.getByText("今日の記事 A2 の案内")).toBeTruthy();
    expect(
      calls.filter(
        (call) =>
          call.method === "GET" && call.url === "/api/app/news/articles/2",
      ),
    ).toHaveLength(1);
  });
});
