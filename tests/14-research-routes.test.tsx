// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ResearchReportRoute from "../src/app/(screens)/research/[contentId]/page";
import ResearchTopicsRoute from "../src/app/(screens)/research/page";
import ScreensLayout from "../src/app/(screens)/layout";

// 14-research の実装単位4（DD-01 M01・M32、BD-03 2章 遷移表、CR-020。CR-023 で 06-app-shell から移した）。
// 画面の道 M01 に、課題の一覧 `/research`（SCR-010）と課題の週報 `/research/{contentId}`（SCR-011）を足し、
// 上の帯（ロゴでホームへ戻る）を付ける。道の中身は M32 の部品（src/screens/research の
// `ResearchTopicsScreen`、`ResearchReportScreen`）にする。
// 受け入れ基準:
// - `/research` と `/research/1` を開くと、上の帯と M32 の部品が出る。
// - 上の帯のロゴを押すと `/` へ戻る。
// - service worker の保存の対象が `/_next/static/` の中だけのままである。
//
// 道を開いたときに Next.js が描くものを、同じ layout（src/app/(screens)/layout.tsx）と
// page（src/app/(screens)/research/page.tsx、src/app/(screens)/research/[contentId]/page.tsx）から描く
// （06-app-shell の TC116、09-english の道のテストと同じ描き方）。`[contentId]` の page は、
// ほかの道（`/english/{contentId}`）と同じく `params`（Promise）で内容ID を受け取る。
// 上の帯は M01 の上の帯（BD-09 5章。SCR-002 と同じ。CR-018）で、`/` へのリンクが NEXUS のロゴ
// （public/img/home/logo_001.png）の画像を持ち、ボタンの名前が「ホーム」である。
// M32 の部品が出たことは、部品が呼ぶ API（SCR-010-A01 `listResearchTopics`、SCR-011-A01
// `getResearchReport`）と、その応答から部品が描く中身で確かめる。

const router = {
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
  forward: vi.fn(),
  refresh: vi.fn(),
  prefetch: vi.fn(),
};
let currentPath = "/research";

vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => currentPath,
  useSearchParams: () => new URLSearchParams(),
}));

const NOW = new Date("2026-12-02T00:00:00.000Z"); // 日本時間 2026-12-02 09:00
const LOGO_PATH = "/img/home/logo_001.png";
const REPORT_ID = 1;

// D2（DD-10 3章）の形の `listResearchTopics` の応答。
const TOPICS = {
  topics: [
    {
      topicId: "second-brain",
      title: "第二の脳の作り方",
      status: "active",
      lastWeek: 2,
      lastReceivedAt: "2026-12-01T07:30:00.000+09:00",
      latestContentId: 12,
      hasUnread: true,
    },
    {
      topicId: "rag-eval",
      title: "RAG の評価",
      status: "ended",
      lastWeek: 1,
      lastReceivedAt: "2026-11-23T21:05:00.000+09:00",
      latestContentId: 21,
      hasUnread: false,
    },
  ],
};

// `getResearchReport` の応答（内容ID 1 の週報）。
const REPORT = {
  contentId: REPORT_ID,
  topicId: "second-brain",
  topicTitle: "第二の脳の作り方",
  week: 1,
  sentOn: "2026-11-24",
  status: "active",
  answerMd: "まず小さく始めるのがよい。",
  approaches: [
    {
      title: "毎日ノートを書く",
      howToMd: "朝に5分だけ書く。",
      sourceUrls: ["https://notes.example.com/daily"],
      sourceCount: 1,
      marks: ["added"],
      counterMd: null,
    },
  ],
  unknownsMd: "長く続けたときの重さはまだ分からない。",
  changesMd: "最初の週の報告。",
  receivedAt: "2026-11-24T07:30:00.000+09:00",
  state: {
    contentId: REPORT_ID,
    isNew: true,
    isRead: false,
    isSaved: false,
    savedAt: null,
  },
  weeks: [
    {
      contentId: REPORT_ID,
      week: 1,
      sentOn: "2026-11-24",
      isRead: false,
    },
  ],
};

let calls: { url: string; method: string }[];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function pathOf(input: unknown): string {
  const raw =
    input instanceof Request
      ? input.url
      : input instanceof URL
        ? input.href
        : String(input);
  return new URL(raw, "http://localhost").pathname;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  window.sessionStorage.clear();
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const path = pathOf(input);
      const method = (
        init?.method ?? (input instanceof Request ? input.method : "GET")
      ).toUpperCase();
      calls.push({ url: path, method });
      if (path === "/api/app/research/topics") return jsonResponse(TOPICS);
      if (path === `/api/app/research/reports/${REPORT_ID}`) {
        return jsonResponse(REPORT);
      }
      if (path === `/api/app/contents/${REPORT_ID}/opened`) {
        return jsonResponse({ ...REPORT.state, isNew: false });
      }
      if (path.startsWith("/api/app/conversations")) {
        return jsonResponse({ conversations: [] });
      }
      return jsonResponse(
        { error: { code: "not_found", message: "", messageId: "MSG-019" } },
        404,
      );
    }),
  );
  Object.values(router).forEach((fn) => fn.mockClear());
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function openTopicsRoute() {
  currentPath = "/research";
  const page = await ResearchTopicsRoute();
  return render(<ScreensLayout>{page}</ScreensLayout>);
}

async function openReportRoute(contentId: string) {
  currentPath = `/research/${contentId}`;
  const page = await ResearchReportRoute({
    params: Promise.resolve({ contentId }),
  });
  return render(<ScreensLayout>{page}</ScreensLayout>);
}

// 上の帯のホームへ戻る操作（ボタンの名前「ホーム」の `/` へのリンクで、NEXUS のロゴの画像を持つ）。
// 画面に1つだけある。
function expectTopBarHomeLogo(): HTMLElement {
  const home = screen.getByRole("link", { name: "ホーム" });
  expect(home.getAttribute("href")).toBe("/");
  const logo = home.querySelector("img");
  expect(logo, "ロゴの画像").not.toBeNull();
  expect(new URL(logo!.getAttribute("src")!, "http://localhost").pathname).toBe(
    LOGO_PATH,
  );
  // 「ホーム」の文字は出さない（CR-018）。
  expect(home.textContent?.trim() ?? "").toBe("");
  return home;
}

// ロゴを押すと `/` へ戻ることを確かめる。リンクの既定の動き（href への移動）を止めないときは
// href の行き先が `/` であること、止めるときは router で `/` へ移ることを求める。
function expectClickGoesHome(home: HTMLElement) {
  const notPrevented = fireEvent.click(home);
  if (notPrevented) {
    const href = home.getAttribute("href")!;
    expect(new URL(href, "http://localhost/research/1").pathname).toBe("/");
  } else {
    const pushed = [...router.push.mock.calls, ...router.replace.mock.calls];
    expect(pushed.map(([to]) => String(to))).toContain("/");
  }
}

describe("`/research`（SCR-010 課題の一覧）", () => {
  it("開くと、上の帯（ロゴでホームへ戻る。題名 Research）と M32 の課題の一覧の部品が出る", async () => {
    await openTopicsRoute();
    expectTopBarHomeLogo();
    // BD-03 SCR-010 3.2「[ロゴ] Research」。
    expect(screen.getByRole("heading", { name: "Research" })).toBeTruthy();

    // M32 の部品が `listResearchTopics` を呼び、応答の課題を行で出す。
    await waitFor(() =>
      expect(screen.getByText("第二の脳の作り方")).toBeTruthy(),
    );
    expect(screen.getByText("RAG の評価")).toBeTruthy();
    expect(
      calls.some(
        (c) => c.url === "/api/app/research/topics" && c.method === "GET",
      ),
    ).toBe(true);
    // 行を押す場所は、その課題の最新の週の週報への道（SCR-010-A02）。
    const rows = screen.getAllByRole("listitem");
    const row = rows.find((r) => r.textContent?.includes("第二の脳の作り方"))!;
    expect(within(row).getByRole("link").getAttribute("href")).toBe(
      "/research/12",
    );
  });

  it("上の帯のロゴを押すと `/` へ戻る", async () => {
    await openTopicsRoute();
    const home = expectTopBarHomeLogo();
    await waitFor(() =>
      expect(screen.getByText("第二の脳の作り方")).toBeTruthy(),
    );
    expectClickGoesHome(home);
  });
});

describe("`/research/1`（SCR-011 課題の週報）", () => {
  it("開くと、上の帯（ロゴでホームへ戻る）と M32 の週報の部品が出る", async () => {
    await openReportRoute(String(REPORT_ID));
    expectTopBarHomeLogo();

    // M32 の部品が内容ID 1 で `getResearchReport` を呼び、週報を出す。
    await waitFor(() =>
      expect(screen.getByText("毎日ノートを書く")).toBeTruthy(),
    );
    expect(
      calls.some(
        (c) =>
          c.url === `/api/app/research/reports/${REPORT_ID}` &&
          c.method === "GET",
      ),
    ).toBe(true);
    expect(screen.getAllByText("第二の脳の作り方").length).toBeGreaterThan(0);
    expect(screen.getByText("最初の週の報告。")).toBeTruthy();
    // 週報の上の帯の「AI に質問」（SCR-011-A07）。
    expect(screen.getByRole("button", { name: "AI に質問" })).toBeTruthy();
    // 上の帯は1つだけ（ホームへ戻る操作が重ならない）。
    expect(screen.getAllByRole("link", { name: "ホーム" })).toHaveLength(1);
  });

  it("上の帯のロゴを押すと `/` へ戻る", async () => {
    await openReportRoute(String(REPORT_ID));
    const home = expectTopBarHomeLogo();
    await waitFor(() =>
      expect(screen.getByText("毎日ノートを書く")).toBeTruthy(),
    );
    expectClickGoesHome(home);
  });
});

// ---- service worker（public/sw.js）の保存の対象 ----
// 06-app-shell の service worker のテストと同じく、ブラウザの service worker の環境を偽にした vm で動かす。

const ORIGIN = "https://nexus.example.ts.net";

function loadServiceWorker() {
  const source = readFileSync(
    join(import.meta.dirname, "..", "public", "sw.js"),
    "utf8",
  );
  const listeners = new Map<string, (event: unknown) => void>();
  const store = new Map<string, Response>();
  const put = vi.fn(async (request: Request, response: Response) => {
    store.set(request.url, response);
  });
  const cache = {
    match: vi.fn(async (request: Request) => store.get(request.url)),
    put,
  };
  const names = new Set<string>();
  const caches = {
    open: vi.fn(async (name: string) => {
      names.add(name);
      return cache;
    }),
    keys: vi.fn(async () => [...names]),
    delete: vi.fn(async (name: string) => names.delete(name)),
  };
  const fetchMock = vi.fn(async () => new Response("body", { status: 200 }));
  const self = {
    location: new URL(`${ORIGIN}/sw.js`),
    addEventListener: (type: string, listener: (event: unknown) => void) =>
      listeners.set(type, listener),
    skipWaiting: vi.fn(),
    clients: { claim: vi.fn(async () => undefined) },
  };
  runInNewContext(source, { self, caches, fetch: fetchMock, URL, Promise });

  async function dispatchFetch(request: Request) {
    let responded: Promise<Response> | undefined;
    listeners.get("fetch")!({
      request,
      respondWith: (value: Promise<Response>) => {
        responded = value;
      },
    });
    return responded === undefined ? undefined : await responded;
  }
  return { source, dispatchFetch, put, fetchMock };
}

describe("service worker の保存の対象は `/_next/static/` の中だけのまま", () => {
  it("`/research` の道と週報の API は扱わず、保存しない", async () => {
    const sw = loadServiceWorker();
    for (const url of [
      `${ORIGIN}/research`,
      `${ORIGIN}/research/1`,
      `${ORIGIN}/research/12?week=2`,
      `${ORIGIN}/api/app/research/topics`,
      `${ORIGIN}/api/app/research/reports/1`,
      `${ORIGIN}/api/app/contents/1/opened`,
    ]) {
      expect(await sw.dispatchFetch(new Request(url)), url).toBeUndefined();
    }
    expect(sw.put).not.toHaveBeenCalled();
    expect(sw.fetchMock).not.toHaveBeenCalled();
  });

  it("`/_next/static/` の中のファイルは保存する", async () => {
    const sw = loadServiceWorker();
    const url = `${ORIGIN}/_next/static/chunks/app/research/page-3f9a2c.js`;
    const response = await sw.dispatchFetch(new Request(url));
    expect(await response?.text()).toBe("body");
    expect(sw.put).toHaveBeenCalledTimes(1);
    expect(sw.put.mock.calls[0][0].url).toBe(url);
  });

  it("保存する呼び出しは `cache.put` の1か所だけで、道を前もって保存しない", () => {
    const { source } = loadServiceWorker();
    expect(source.match(/\.put\(/g)).toHaveLength(1);
    expect(source).not.toMatch(/\.add(All)?\(/);
    expect(source).not.toMatch(/["'`]\/research/);
  });
});
