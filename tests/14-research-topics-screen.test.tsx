// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ResearchTopicsScreen } from "../src/screens/research/topics-screen";
import { MESSAGES } from "../src/server/shared/messages";

// 14-research の実装単位2（FN-026、DD-01 M32、BD-03 SCR-010、CR-020）。
// 課題の一覧の画面 SCR-010 の部品（M32。`src/screens/research`）。
// 受け入れ基準: DD-10 TC140 が通る。
// TC140: M32 の部品に `listResearchTopics` の応答（D2）と空の応答を渡し、課題の一覧を描く。
// 課題名、「進行中」か「終了」、「{n}週目」、最後に届いた日（日付だけ）、未読の課題にだけ点。
// 空なら MSG-047。行を押すと `/research/{latestContentId}` へ移る。
//
// 部品は SCR-010-A01 で `listResearchTopics`（GET /api/app/research/topics）を呼んで応答を受け取る。
// テストは fetch を差し替えて応答を渡す（ほかの一覧の画面のテストと同じ渡し方）。
// 行は一覧の項目（listitem）で、押す場所は行き先を持つリンク（ほかの一覧の行と同じ）。
// 未読の点は `data-testid="unread-mark"` の要素（種類の印 `kind-mark` と同じ見分け方）。

const NOW = new Date("2026-12-02T00:00:00.000Z"); // 日本時間 2026-12-02 09:00

// D2（DD-10 3章）の `listResearchTopics` の応答。最後に届いた日時の新しい順。
// 課題 A（second-brain、進行中）は2週目が最新で未読がある。課題 B（rag-eval、終了）は全て既読。
const TOPIC_A_LATEST = 12;
const TOPIC_B_LATEST = 21;

const D2_TOPICS = {
  topics: [
    {
      topicId: "second-brain",
      title: "第二の脳の作り方",
      status: "active",
      lastWeek: 2,
      lastReceivedAt: "2026-12-01T07:30:00.000+09:00",
      latestContentId: TOPIC_A_LATEST,
      hasUnread: true,
    },
    {
      topicId: "rag-eval",
      title: "RAG の評価",
      status: "ended",
      lastWeek: 1,
      lastReceivedAt: "2026-11-23T21:05:00.000+09:00",
      latestContentId: TOPIC_B_LATEST,
      hasUnread: false,
    },
  ],
};

// 時刻の形（07:30、21:05 など）。
const TIME_PATTERN = /\d{1,2}:\d{2}/;

let fetchMock: ReturnType<typeof vi.fn>;

function stubTopics(body: unknown): void {
  fetchMock = vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
}

function calledUrls(): string[] {
  return fetchMock.mock.calls.map(([input]) => String(input));
}

function rowOf(rows: HTMLElement[], title: string): HTMLElement {
  const row = rows.find((r) => r.textContent?.includes(title));
  if (row === undefined) throw new Error(`「${title}」の行が無い`);
  return row;
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

describe("TC140 課題の一覧 SCR-010（M32）", () => {
  it("listResearchTopics を呼び、課題を応答の順に1行ずつ出す", async () => {
    stubTopics(D2_TOPICS);
    render(<ResearchTopicsScreen />);
    const rows = await screen.findAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("第二の脳の作り方");
    expect(rows[1].textContent).toContain("RAG の評価");
    expect(calledUrls()).toEqual(["/api/app/research/topics"]);
  });

  it("行に課題名、「進行中」か「終了」、「{n}週目」を出す", async () => {
    stubTopics(D2_TOPICS);
    render(<ResearchTopicsScreen />);
    const rows = await screen.findAllByRole("listitem");
    const a = rowOf(rows, "第二の脳の作り方");
    const b = rowOf(rows, "RAG の評価");
    expect(a.textContent).toContain("進行中");
    expect(a.textContent).not.toContain("終了");
    expect(a.textContent).toContain("2週目");
    expect(b.textContent).toContain("終了");
    expect(b.textContent).not.toContain("進行中");
    expect(b.textContent).toContain("1週目");
  });

  it("最後に届いた日を日付だけで出し、時刻を出さない（BD-09 5章 表示書式）", async () => {
    stubTopics(D2_TOPICS);
    const { container } = render(<ResearchTopicsScreen />);
    const rows = await screen.findAllByRole("listitem");
    expect(rowOf(rows, "第二の脳の作り方").textContent).toContain(
      "12月1日（火）",
    );
    expect(rowOf(rows, "RAG の評価").textContent).toContain("11月23日（月）");
    expect(container.textContent).not.toMatch(TIME_PATTERN);
  });

  it("今年でない日は年を付けた日付で出す（BD-09 5章 表示書式）", async () => {
    stubTopics({
      topics: [
        {
          ...D2_TOPICS.topics[1],
          lastReceivedAt: "2025-12-31T23:59:59.000+09:00",
        },
      ],
    });
    const { container } = render(<ResearchTopicsScreen />);
    const rows = await screen.findAllByRole("listitem");
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain("2025年12月31日");
    expect(container.textContent).not.toMatch(TIME_PATTERN);
  });

  it("未読の週報がある課題の行にだけ点を出す", async () => {
    stubTopics(D2_TOPICS);
    render(<ResearchTopicsScreen />);
    const rows = await screen.findAllByRole("listitem");
    const a = rowOf(rows, "第二の脳の作り方");
    const b = rowOf(rows, "RAG の評価");
    expect(a.querySelectorAll('[data-testid="unread-mark"]')).toHaveLength(1);
    expect(b.querySelector('[data-testid="unread-mark"]')).toBeNull();
  });

  it("行を押すと /research/{latestContentId} へ移る", async () => {
    stubTopics(D2_TOPICS);
    render(<ResearchTopicsScreen />);
    const rows = await screen.findAllByRole("listitem");
    const linkA = within(rowOf(rows, "第二の脳の作り方")).getByRole("link");
    const linkB = within(rowOf(rows, "RAG の評価")).getByRole("link");
    expect(linkA.getAttribute("href")).toBe(`/research/${TOPIC_A_LATEST}`);
    expect(linkB.getAttribute("href")).toBe(`/research/${TOPIC_B_LATEST}`);
    // 課題名は押す場所（リンク）の中にある。
    expect(linkA.textContent).toContain("第二の脳の作り方");
    expect(linkB.textContent).toContain("RAG の評価");
  });

  it("空の応答なら MSG-047 を出し、行を出さない", async () => {
    stubTopics({ topics: [] });
    render(<ResearchTopicsScreen />);
    expect(await screen.findByText(MESSAGES["MSG-047"].text)).toBeTruthy();
    expect(MESSAGES["MSG-047"].text).toBe("調査の週報はまだ届いていません。");
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(calledUrls()).toEqual(["/api/app/research/topics"]);
  });
});
