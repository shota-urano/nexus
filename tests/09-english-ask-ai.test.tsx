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
import EnglishStudyRoute from "../src/app/(screens)/english/[contentId]/page";
import EnglishListRoute from "../src/app/(screens)/english/page";
import type {
  EnglishSetDetail,
  EnglishSetSummary,
  Reading,
} from "../src/contracts/english";

// 09-english の実装単位4。英語の学習（SCR-005）の上の帯に「AI に質問」（SCR-005-A09）を置き、
// 押すと AI チャットの面 SCR-006（M06 の ChatSheet）を下から開く。語句か文を選んでいれば、
// その語句と文と位置を対象（kind: "phrase"）にし、選んでいなければその教材のページ全体
// （kind: "page" と内容ID）を対象にする（BD-03 SCR-005-A09・4章、DD-01 M01・M04・M06、DD-02 FN-014）。
// 語句を選ぶのは読む教材の注のある語句を押したとき（SCR-005-A02）、文を選ぶのは文の注の無い所を
// 押したとき（SCR-005-O04）。位置は、読む教材なら part を reading にし、段落と文の番号を持つ
// （`docs/api/openapi.yaml` の QuestionTarget.position）。
// 道（M01）の `/english/{contentId}` と `/english` の入口（page.tsx）を描いて確かめる。質問の対象は、
// AI チャットの面が呼ぶ `listConversations` の targetContentId と、`createConversation` の本文の
// target で確かめる。

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
    usePathname: () => currentPath,
    useSearchParams: () => new URLSearchParams(),
  };
});

let currentPath = "/english/7";

const NOW = new Date("2026-11-30T23:00:00.000Z"); // 日本時間 2026-12-01 08:00

const CONTENT_ID = 7;

// 読む教材。段落 1 の文 1 に注のある語句「look forward to」がある。
const READING: Reading = {
  date: "2026-12-01",
  format: "story",
  title: "A Morning Walk",
  scene: "朝の公園",
  summary: "朝の散歩",
  paragraphs: [
    {
      sentences: [
        {
          en: "I walk in the park every morning.",
          ja: "私は毎朝公園を歩く。",
          notes: [{ text: "every morning", kind: "phrase", ja: "毎朝" }],
        },
      ],
    },
    {
      sentences: [
        {
          en: "It makes me happy.",
          ja: "それは私を幸せにする。",
          notes: [],
        },
        {
          en: "I look forward to it every day.",
          ja: "私は毎日それを楽しみにしている。",
          notes: [
            { text: "look forward to", kind: "phrase", ja: "楽しみにする" },
          ],
        },
      ],
    },
  ],
};

const SET: EnglishSetDetail = {
  contentId: CONTENT_ID,
  learningTheme: "現在形の使い方",
  targetDate: "2026-12-01",
  lessonMd: ["# 現在形", "", "習慣を表す。"].join("\n"),
  problems: [
    {
      no: 1,
      kind: "quiz",
      questionMd: "正しいものを選ぶ",
      answerMd: "正解は b",
      answerType: "choice",
      expected: "b",
      choices: ["a", "b", "c"],
    },
    {
      no: 2,
      kind: "quiz",
      questionMd: "語を書く",
      answerMd: "正解は walk",
      answerType: "text",
      expected: "walk",
    },
    { no: 3, kind: "quiz", questionMd: "訳す", answerMd: "私は歩く。" },
  ],
  closingMd: "また明日。",
  reading: READING,
  state: {
    contentId: CONTENT_ID,
    isNew: true,
    isRead: false,
    isSaved: false,
  },
  lastAnswer: null,
};

const SUMMARY: EnglishSetSummary = {
  contentId: CONTENT_ID,
  learningTheme: SET.learningTheme,
  targetDate: SET.targetDate,
  receivedAt: "2026-12-01T07:00:00.000+09:00",
  isNew: true,
  isRead: false,
  isSaved: false,
  isCompleted: false,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

type Call = { url: string; method: string; body: string | null };
let calls: Call[];

// 教材、一覧、開いた印、会話の API。会話は前の会話が無いものとして、対象どおりに新しい会話を作る。
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
      if (key === "GET /api/app/english/sets") {
        return jsonResponse({ items: [SUMMARY], nextCursor: null });
      }
      if (key === `GET /api/app/english/sets/${CONTENT_ID}`) {
        return jsonResponse(SET);
      }
      if (key === `POST /api/app/contents/${CONTENT_ID}/opened`) {
        return jsonResponse({ ...SET.state, isNew: false });
      }
      if (
        call.method === "GET" &&
        call.url.startsWith("/api/app/conversations?")
      ) {
        return jsonResponse({ items: [], nextCursor: null });
      }
      if (key === "POST /api/app/conversations") {
        const { target } = JSON.parse(call.body ?? "{}") as {
          target?: { kind: string; contentId: number; phrase?: string };
        };
        return jsonResponse(
          {
            conversation: {
              conversationId: 60,
              target: target ?? null,
              targetTitle: target === undefined ? null : SET.learningTheme,
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

async function renderStudy() {
  currentPath = `/english/${CONTENT_ID}`;
  const element = await EnglishStudyRoute({
    params: Promise.resolve({ contentId: String(CONTENT_ID) }),
  });
  const result = render(element);
  await screen.findByRole("region", { name: "教材の段" });
  return result;
}

function chatCalls(): Call[] {
  return calls.filter((call) => call.url.startsWith("/api/app/conversations"));
}

// 上の帯の「AI に質問」。
async function askAiButton(): Promise<HTMLElement> {
  const header = screen.getByRole("banner");
  return within(header).findByRole("button", { name: "AI に質問" });
}

// 「AI に質問」を押し、AI チャットの面が開いたことと、面が新しい会話を作るときに渡した対象を返す。
async function pressAskAi(): Promise<{
  chat: HTMLElement;
  target: unknown;
}> {
  expect(screen.queryByRole("dialog", { name: "AI チャット" })).toBeNull();
  expect(chatCalls()).toEqual([]);
  fireEvent.click(await askAiButton());
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
    `/api/app/conversations?targetContentId=${CONTENT_ID}`,
  ]);
  const created = calls.find(
    (call) => call.method === "POST" && call.url === "/api/app/conversations",
  );
  const body = JSON.parse(created?.body ?? "null") as { target?: unknown };
  return { chat, target: body?.target };
}

async function closeChat(chat: HTMLElement): Promise<void> {
  fireEvent.click(within(chat).getByRole("button", { name: "閉じる" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog", { name: "AI チャット" })).toBeNull(),
  );
}

function currentStage(): string | null {
  const stages = screen.getByRole("list", { name: "今の段" });
  const current = within(stages)
    .getAllByRole("listitem")
    .find((item) => item.getAttribute("aria-current") === "step");
  return current?.textContent ?? null;
}

function setReadCount(): number {
  return calls.filter(
    (call) =>
      call.method === "GET" &&
      call.url === `/api/app/english/sets/${CONTENT_ID}`,
  ).length;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  stubApi();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("英語の学習（/english/{contentId}）の上の帯の「AI に質問」（SCR-005-A09）", () => {
  it("上の帯に「AI に質問」があり、押すと AI チャットの面が開く", async () => {
    await renderStudy();
    const button = await askAiButton();
    expect(button.closest("header")).not.toBeNull();
    const { chat } = await pressAskAi();
    expect(chat).toBeTruthy();
  });

  it("語句も文も選んでいないときは、その教材のページ全体（kind: page と内容ID）を対象にする", async () => {
    await renderStudy();
    const { target } = await pressAskAi();
    expect(target).toEqual({ kind: "page", contentId: CONTENT_ID });
  });

  it("語句も文も選ばずに問題の段へ進んでいるときも、ページ全体を対象にする", async () => {
    await renderStudy();
    fireEvent.click(screen.getByRole("button", { name: "問題へ" }));
    await screen.findByRole("region", { name: "問題の段" });
    const { target } = await pressAskAi();
    expect(target).toEqual({ kind: "page", contentId: CONTENT_ID });
  });

  it("読む教材の注のある語句を選んでいるときは、kind: phrase で、選んだ語句とその文と位置を対象にする", async () => {
    await renderStudy();
    const reading = screen.getByRole("region", { name: "読む教材" });
    fireEvent.click(
      within(reading).getByRole("button", { name: "look forward to" }),
    );
    const { target } = await pressAskAi();
    expect(target).toEqual({
      kind: "phrase",
      contentId: CONTENT_ID,
      phrase: "look forward to",
      sentence: "I look forward to it every day.",
      position: { part: "reading", paragraphIndex: 1, sentenceIndex: 1 },
    });
  });

  it("読む教材の文を選んでいるときは、kind: phrase で、選んだ文と位置を対象にする", async () => {
    await renderStudy();
    const reading = screen.getByRole("region", { name: "読む教材" });
    fireEvent.click(
      within(reading).getByRole("button", { name: "It makes me happy." }),
    );
    const { target } = await pressAskAi();
    expect(target).toMatchObject({
      kind: "phrase",
      contentId: CONTENT_ID,
      sentence: "It makes me happy.",
    });
    const phraseTarget = target as {
      phrase?: unknown;
      position?: unknown;
    };
    // kind が phrase のときは語句も要る（DD-02 2章 C07、openapi.yaml の QuestionTarget）。
    expect(typeof phraseTarget.phrase).toBe("string");
    expect(phraseTarget.position).toEqual({
      part: "reading",
      paragraphIndex: 1,
      sentenceIndex: 0,
    });
  });

  it("AI チャットの面を閉じると、問題の段と入れた答えがそのまま残っている", async () => {
    await renderStudy();
    fireEvent.click(screen.getByRole("button", { name: "問題へ" }));
    const questions = await screen.findByRole("region", { name: "問題の段" });
    fireEvent.click(within(questions).getByRole("radio", { name: "b" }));
    fireEvent.click(
      within(questions).getByRole("button", { name: "次の問題" }),
    );
    fireEvent.change(
      within(questions).getByRole("textbox", { name: "問題 2 の答え" }),
      { target: { value: "walks" } },
    );
    expect(currentStage()).toBe("② 問題");

    const { chat } = await pressAskAi();
    await closeChat(chat);

    expect(currentStage()).toBe("② 問題");
    const still = screen.getByRole("region", { name: "問題の段" });
    expect(
      (
        within(still).getByRole("textbox", {
          name: "問題 2 の答え",
        }) as HTMLInputElement
      ).value,
    ).toBe("walks");
    fireEvent.click(within(still).getByRole("button", { name: "前の問題" }));
    expect(
      (within(still).getByRole("radio", { name: "b" }) as HTMLInputElement)
        .checked,
    ).toBe(true);
    // 教材を読み直していない。
    expect(setReadCount()).toBe(1);
  });

  it("AI チャットの面を閉じると、採点の段と答えと ○△× がそのまま残っている", async () => {
    await renderStudy();
    fireEvent.click(screen.getByRole("button", { name: "問題へ" }));
    const questions = await screen.findByRole("region", { name: "問題の段" });
    fireEvent.click(within(questions).getByRole("radio", { name: "b" }));
    fireEvent.click(
      within(questions).getByRole("button", { name: "次の問題" }),
    );
    fireEvent.change(
      within(questions).getByRole("textbox", { name: "問題 2 の答え" }),
      { target: { value: "walks" } },
    );
    fireEvent.click(within(questions).getByRole("button", { name: "採点へ" }));
    const grading = await screen.findByRole("region", { name: "採点の段" });
    fireEvent.click(
      within(
        within(grading).getByRole("group", { name: "問題 3 の採点" }),
      ).getByRole("button", { name: "△" }),
    );
    expect(currentStage()).toBe("③ 採点");

    const { chat } = await pressAskAi();
    await closeChat(chat);

    expect(currentStage()).toBe("③ 採点");
    const still = screen.getByRole("region", { name: "採点の段" });
    expect(within(still).getByText("あなたの答え: walks")).toBeTruthy();
    const pressed = (no: number) =>
      within(within(still).getByRole("group", { name: `問題 ${no} の採点` }))
        .getAllByRole("button")
        .filter((button) => button.getAttribute("aria-pressed") === "true")
        .map((button) => button.textContent);
    // 1 は自動の採点で ○、2 は自動の採点で ×、3 は本人が付けた △。
    expect(pressed(1)).toEqual(["○"]);
    expect(pressed(2)).toEqual(["×"]);
    expect(pressed(3)).toEqual(["△"]);
    expect(setReadCount()).toBe(1);
  });
});

describe("英語の教材の一覧（/english。SCR-004）", () => {
  it("「AI に質問」が無い", async () => {
    currentPath = "/english";
    render(<EnglishListRoute />);
    await screen.findByText(SET.learningTheme);
    expect(screen.queryAllByRole("button", { name: "AI に質問" })).toEqual([]);
    expect(screen.queryAllByRole("link", { name: "AI に質問" })).toEqual([]);
    expect(screen.queryAllByText("AI に質問")).toEqual([]);
    expect(chatCalls()).toEqual([]);
  });
});
