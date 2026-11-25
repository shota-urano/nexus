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
import { streamReply } from "../src/client/chat";
import type {
  ChatMessage,
  Conversation,
  QuestionTarget,
} from "../src/contracts/chat";
import { ChatSheet } from "../src/screens/chat/chat-sheet";
import { CHAT_MESSAGES } from "../src/screens/chat/messages";
import { MESSAGES } from "../src/server/shared/messages";

// 10-chat の実装単位7。AI チャットの面 M06（src/screens/chat）と、会話の通信層 M09（src/client/chat.ts）。
// 受け入れ基準 DD-10 TC75（BD-09 5章 誤操作の防止、SCR-006-A04）。

const NOW = new Date("2026-11-25T03:00:00.000Z"); // 日本時間 2026-11-25 12:00

const TARGET: QuestionTarget = { kind: "article", contentId: 7 };

function conversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    conversationId: 1,
    target: TARGET,
    targetTitle: "記事の見出し",
    startedAt: "2026-11-24T05:00:00.000+09:00",
    lastSpokenAt: "2026-11-24T05:30:00.000+09:00",
    ...overrides,
  };
}

function message(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    messageId: 10,
    conversationId: 1,
    speaker: "owner",
    bodyMd: "最初の質問",
    sentAt: "2026-11-24T05:30:00.000+09:00",
    replyState: null,
    replyToMessageId: null,
    notice: null,
    ...overrides,
  };
}

function aiMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return message({
    messageId: 11,
    speaker: "ai",
    bodyMd: "AI の応答",
    replyState: "done",
    replyToMessageId: 10,
    ...overrides,
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// 続きを手で流せる SSE の応答。
interface SseHandle {
  response: Response;
  send: (text: string) => void;
  close: () => void;
}

function sseResponse(): SseHandle {
  const encoder = new TextEncoder();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  return {
    response: new Response(body, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    }),
    send: (text) => controller.enqueue(encoder.encode(text)),
    close: () => controller.close(),
  };
}

type Route = (
  init: RequestInit | undefined,
  url: string,
) => Response | Promise<Response>;

let fetchMock: ReturnType<typeof vi.fn>;

// `METHOD path` ごとに応答を決める。決めていない呼び出しは 500。
function stubFetch(routes: Record<string, Route>): void {
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const key = `${init?.method ?? "GET"} ${url}`;
    const route = routes[key];
    return route ? route(init, url) : jsonResponse({}, 500);
  });
  vi.stubGlobal("fetch", fetchMock);
}

function calls(key: string): RequestInit[] {
  return fetchMock.mock.calls
    .filter(
      ([input, init]) =>
        `${(init as RequestInit | undefined)?.method ?? "GET"} ${String(input)}` ===
        key,
    )
    .map(([, init]) => (init ?? {}) as RequestInit);
}

// 永く返らない応答（SSE の続きが来ない状態）。
function never(): Promise<Response> {
  return new Promise(() => {});
}

const LIST_KEY = "GET /api/app/conversations?targetContentId=7";
const DETAIL_KEY = "GET /api/app/conversations/1";
const QUESTION_KEY = "POST /api/app/conversations/1/questions";

function openSheet(target: QuestionTarget | null = TARGET) {
  return render(<ChatSheet open onClose={() => {}} target={target} />);
}

function sendButton(): HTMLButtonElement {
  return screen.getByRole("button", { name: "送る" });
}

function typeQuestion(text: string): void {
  fireEvent.change(screen.getByRole("textbox", { name: "質問" }), {
    target: { value: text },
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("TC75 二重送信の防止と、応答の状態ごとの操作（BD-09 5章 誤操作の防止、SCR-006-A04）", () => {
  it("「送る」を続けて2回押すと、1回目の後に押せなくなり、API の呼び出しは1回。作成中は「送る」が押せない", async () => {
    let answer: (response: Response) => void = () => {};
    stubFetch({
      [LIST_KEY]: () =>
        jsonResponse({ items: [conversation()], nextCursor: null }),
      [DETAIL_KEY]: () =>
        jsonResponse({
          conversation: conversation(),
          messages: [message(), aiMessage()],
        }),
      // API の応答を遅らせる。
      [QUESTION_KEY]: () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        }),
      "GET /api/app/messages/21/stream": never,
    });
    openSheet();
    await screen.findByText("AI の応答");
    typeQuestion("次の質問");
    expect(sendButton().disabled).toBe(false);

    fireEvent.click(sendButton());
    fireEvent.click(sendButton());
    expect(sendButton().disabled).toBe(true);
    expect(calls(QUESTION_KEY)).toHaveLength(1);
    expect(JSON.parse(String(calls(QUESTION_KEY)[0].body))).toEqual({
      text: "次の質問",
    });

    // 受け付けたと返ると、作成中の AI の発言が出る。作成中のあいだは「送る」が押せない。
    await act(async () => {
      answer(
        jsonResponse(
          {
            question: message({ messageId: 20, bodyMd: "次の質問" }),
            reply: aiMessage({
              messageId: 21,
              bodyMd: "",
              replyState: "writing",
              replyToMessageId: 20,
            }),
          },
          202,
        ),
      );
    });
    await screen.findByText("応答を作成中");
    expect(
      (screen.getByRole("textbox", { name: "質問" }) as HTMLTextAreaElement)
        .value,
    ).toBe("");
    typeQuestion("さらに次の質問");
    expect(sendButton().disabled).toBe(true);
    fireEvent.click(sendButton());
    expect(calls(QUESTION_KEY)).toHaveLength(1);
  });

  it("開いた会話に作成中の応答があれば、質問を書いても「送る」が押せない", async () => {
    stubFetch({
      [LIST_KEY]: () =>
        jsonResponse({ items: [conversation()], nextCursor: null }),
      [DETAIL_KEY]: () =>
        jsonResponse({
          conversation: conversation(),
          messages: [
            message(),
            aiMessage({ bodyMd: "途中まで", replyState: "writing" }),
          ],
        }),
      "GET /api/app/messages/11/stream": never,
    });
    openSheet();
    await screen.findByText("応答を作成中");
    typeQuestion("次の質問");
    expect(sendButton().disabled).toBe(true);
    fireEvent.click(sendButton());
    expect(calls(QUESTION_KEY)).toHaveLength(0);
  });

  it("質問が空のときは「送る」が押せない", async () => {
    stubFetch({
      [LIST_KEY]: () =>
        jsonResponse({ items: [conversation()], nextCursor: null }),
      [DETAIL_KEY]: () =>
        jsonResponse({ conversation: conversation(), messages: [] }),
    });
    openSheet();
    await waitFor(() => expect(screen.queryByText("読み込み中")).toBeNull());
    expect(sendButton().disabled).toBe(true);
  });

  it("応答の状態ごとに「止める」「送り直す」「やめる」が出る", async () => {
    stubFetch({
      [LIST_KEY]: () =>
        jsonResponse({ items: [conversation()], nextCursor: null }),
      [DETAIL_KEY]: () =>
        jsonResponse({
          conversation: conversation(),
          messages: [
            message({ messageId: 1 }),
            aiMessage({ messageId: 2, replyState: "done", bodyMd: "完了" }),
            message({ messageId: 3, bodyMd: "質問2" }),
            aiMessage({
              messageId: 4,
              replyState: "failed",
              bodyMd: "失敗",
              notice: "MSG-012",
            }),
            message({ messageId: 5, bodyMd: "質問3" }),
            aiMessage({
              messageId: 6,
              replyState: "failed",
              bodyMd: "使えない",
              notice: "MSG-013",
            }),
            message({ messageId: 7, bodyMd: "質問4" }),
            aiMessage({
              messageId: 8,
              replyState: "cancelled",
              bodyMd: "中止",
              notice: "MSG-014",
            }),
            message({ messageId: 9, bodyMd: "質問5" }),
            aiMessage({
              messageId: 12,
              replyState: "writing",
              bodyMd: "作成中",
            }),
          ],
        }),
      "GET /api/app/messages/12/stream": never,
    });
    openSheet();
    await screen.findByText("作成中");
    const replies = screen.getAllByTestId("ai-message");
    const buttonsOf = (element: HTMLElement) =>
      within(element)
        .queryAllByRole("button")
        .map((button) => button.textContent);

    // 完了: 操作なし
    expect(buttonsOf(replies[0])).toEqual([]);
    // 失敗: 送り直す、やめる と MSG-012 か MSG-013
    expect(buttonsOf(replies[1])).toEqual(["送り直す", "やめる"]);
    expect(replies[1].textContent).toContain(CHAT_MESSAGES["MSG-012"]);
    expect(buttonsOf(replies[2])).toEqual(["送り直す", "やめる"]);
    expect(replies[2].textContent).toContain(CHAT_MESSAGES["MSG-013"]);
    // 中止: 送り直す と MSG-014
    expect(buttonsOf(replies[3])).toEqual(["送り直す"]);
    expect(replies[3].textContent).toContain(CHAT_MESSAGES["MSG-014"]);
    // 作成中: 止める と処理中の印
    expect(buttonsOf(replies[4])).toEqual(["止める"]);
    expect(replies[4].textContent).toContain("応答を作成中");
  });

  it.each([
    ["送り直す", "retry", "failed"],
    ["やめる", "dismiss", "failed"],
    ["止める", "stop", "writing"],
  ] as const)(
    "「%s」は押してから結果が出るまで押せなくなり、API の呼び出しは1回",
    async (label, action, replyState) => {
      let reply: (response: Response) => void = () => {};
      const actionKey = `POST /api/app/messages/11/${action}`;
      stubFetch({
        [LIST_KEY]: () =>
          jsonResponse({ items: [conversation()], nextCursor: null }),
        [DETAIL_KEY]: () =>
          jsonResponse({
            conversation: conversation(),
            messages: [message(), aiMessage({ replyState })],
          }),
        [actionKey]: () =>
          new Promise<Response>((resolve) => {
            reply = resolve;
          }),
        "GET /api/app/messages/11/stream": never,
      });
      openSheet();
      const button = await screen.findByRole("button", { name: label });
      fireEvent.click(button);
      fireEvent.click(button);
      expect((button as HTMLButtonElement).disabled).toBe(true);
      expect(calls(actionKey)).toHaveLength(1);
      await act(async () => {
        reply(
          jsonResponse(
            aiMessage({
              replyState: action === "retry" ? "writing" : "cancelled",
              bodyMd: action === "retry" ? "" : "AI の応答",
              notice: action === "retry" ? null : "MSG-014",
            }),
          ),
        );
      });
      if (action === "retry") {
        await screen.findByRole("button", { name: "止める" });
      } else {
        await screen.findByText(CHAT_MESSAGES["MSG-014"]);
        expect(screen.queryByRole("button", { name: "止める" })).toBeNull();
        expect(screen.queryByRole("button", { name: "やめる" })).toBeNull();
      }
    },
  );
});

describe("M06 AI チャットの面（BD-03 SCR-006）", () => {
  it("A01 前の会話が無ければ今の対象で新しい会話を作り、対象が無ければ MSG-011 を出す", async () => {
    stubFetch({
      [LIST_KEY]: () => jsonResponse({ items: [], nextCursor: null }),
      "POST /api/app/conversations": () =>
        jsonResponse(
          {
            conversation: conversation({
              conversationId: 5,
              target: null,
              targetTitle: null,
            }),
            notice: "MSG-011",
          },
          201,
        ),
    });
    openSheet();
    await screen.findByText(CHAT_MESSAGES["MSG-011"]);
    const created = calls("POST /api/app/conversations");
    expect(created).toHaveLength(1);
    expect(JSON.parse(String(created[0].body))).toEqual({ target: TARGET });
  });

  it("対象の無い会話は targetContentId を付けずに読み、対象を付けずに作る", async () => {
    stubFetch({
      "GET /api/app/conversations": () =>
        jsonResponse({ items: [], nextCursor: null }),
      "POST /api/app/conversations": () =>
        jsonResponse(
          {
            conversation: conversation({ target: null, targetTitle: null }),
            notice: null,
          },
          201,
        ),
    });
    openSheet(null);
    await waitFor(() =>
      expect(calls("POST /api/app/conversations")).toHaveLength(1),
    );
    expect(
      JSON.parse(String(calls("POST /api/app/conversations")[0].body)),
    ).toEqual({});
    expect(screen.queryByText(CHAT_MESSAGES["MSG-011"])).toBeNull();
  });

  it("O01 対象の印と、O02 前の会話（会話ごとに getConversation で取った最初の質問の書き出しと、最後に話した日時）を出す", async () => {
    stubFetch({
      [LIST_KEY]: () =>
        jsonResponse({
          items: [
            conversation(),
            conversation({
              conversationId: 2,
              target: {
                kind: "phrase",
                contentId: 7,
                phrase: "am",
                sentence: "I am here.",
                position: { part: "reading" },
              },
              lastSpokenAt: "2025-12-31T23:59:00.000+09:00",
            }),
          ],
          nextCursor: null,
        }),
      [DETAIL_KEY]: () =>
        jsonResponse({
          conversation: conversation(),
          messages: [message(), aiMessage()],
        }),
      "GET /api/app/conversations/2": () =>
        jsonResponse({
          conversation: conversation({ conversationId: 2 }),
          messages: [
            message({
              messageId: 30,
              conversationId: 2,
              bodyMd:
                "この語句の\n意味は何ですか。三十文字を超える長い質問の文はここで切って書き出しにします",
            }),
          ],
        }),
    });
    openSheet();
    await screen.findByText("AI の応答");
    expect(screen.getByText("記事")).toBeTruthy();
    expect(screen.getByText("記事の見出し")).toBeTruthy();
    const select = screen.getByRole("combobox", {
      name: "前の会話",
    }) as HTMLSelectElement;
    await waitFor(() =>
      expect(select.options[1].textContent).toContain("この語句の 意味は"),
    );
    expect(select.value).toBe("1");
    expect(select.options[0].textContent).toBe(
      "最初の質問（11月24日（火） 05:30）",
    );
    expect(select.options[1].textContent).toBe(
      "この語句の 意味は何ですか。三十文字を超える長い質問の文はこ…（2025年12月31日 23:59）",
    );
    expect(calls(DETAIL_KEY)).toHaveLength(1);
    expect(calls("GET /api/app/conversations/2")).toHaveLength(1);
  });

  it("O02 前の会話は nextCursor をたどって最後のページまで読み、31件目からも選べる", async () => {
    const firstPage = Array.from({ length: 30 }, (_, i) =>
      conversation({ conversationId: i + 1 }),
    );
    const routes: Record<string, Route> = {
      [LIST_KEY]: () => jsonResponse({ items: firstPage, nextCursor: "page2" }),
      [`${LIST_KEY}&cursor=page2`]: () =>
        jsonResponse({
          items: [conversation({ conversationId: 31 })],
          nextCursor: null,
        }),
    };
    for (let id = 1; id <= 31; id += 1) {
      routes[`GET /api/app/conversations/${id}`] = () =>
        jsonResponse({
          conversation: conversation({ conversationId: id }),
          messages: [
            message({
              messageId: id * 100,
              conversationId: id,
              bodyMd: `質問${id}`,
            }),
          ],
        });
    }
    stubFetch(routes);
    openSheet();
    const select = (await screen.findByRole("combobox", {
      name: "前の会話",
    })) as HTMLSelectElement;
    await waitFor(() => expect(select.options).toHaveLength(31));
    await waitFor(() =>
      expect(select.options[30].textContent).toContain("質問31"),
    );
    expect(calls(`${LIST_KEY}&cursor=page2`)).toHaveLength(1);
    fireEvent.change(select, { target: { value: "31" } });
    await waitFor(() => expect(select.value).toBe("31"));
    expect(
      screen.getByText("質問31", { selector: "*:not(option)" }),
    ).toBeTruthy();
  });

  it("続きにつなげない（500）とき、getConversation がまだ作成中を返しても、完了するまで読み直す", async () => {
    let reads = 0;
    stubFetch({
      [LIST_KEY]: () =>
        jsonResponse({ items: [conversation()], nextCursor: null }),
      [DETAIL_KEY]: () => {
        reads += 1;
        const reply =
          reads <= 2
            ? aiMessage({ bodyMd: "途中", replyState: "writing" })
            : aiMessage({ bodyMd: "完了した本文", replyState: "done" });
        return jsonResponse({
          conversation: conversation(),
          messages: [message(), reply],
        });
      },
      "GET /api/app/messages/11/stream": () => jsonResponse({}, 500),
    });
    openSheet();
    await screen.findByText("途中");
    typeQuestion("次の質問");
    expect(sendButton().disabled).toBe(true);
    expect(
      await screen.findByText("完了した本文", undefined, { timeout: 5_000 }),
    ).toBeTruthy();
    expect(sendButton().disabled).toBe(false);
    expect(reads).toBe(3);
    expect(calls("GET /api/app/messages/11/stream")).toHaveLength(1);
  }, 10_000);

  it("A02 前の会話を選ぶと、その会話の発言と対象を出す", async () => {
    const phraseConversation = conversation({
      conversationId: 2,
      target: {
        kind: "phrase",
        contentId: 7,
        phrase: "am",
        sentence: "I am here.",
        position: { part: "reading" },
      },
    });
    stubFetch({
      [LIST_KEY]: () =>
        jsonResponse({
          items: [conversation(), phraseConversation],
          nextCursor: null,
        }),
      [DETAIL_KEY]: () =>
        jsonResponse({ conversation: conversation(), messages: [message()] }),
      "GET /api/app/conversations/2": () =>
        jsonResponse({
          conversation: phraseConversation,
          messages: [
            message({ messageId: 30, conversationId: 2, bodyMd: "語句の質問" }),
          ],
        }),
    });
    openSheet();
    await screen.findAllByText("最初の質問");
    fireEvent.change(screen.getByRole("combobox", { name: "前の会話" }), {
      target: { value: "2" },
    });
    await waitFor(() =>
      expect(screen.getAllByTestId("owner-message")[0].textContent).toContain(
        "語句の質問",
      ),
    );
    expect(screen.getByText("語句と文")).toBeTruthy();
    expect(screen.getByText("am")).toBeTruthy();
  });

  it("A02 会話2、会話3と続けて選び、会話2の結果が後から返っても、最後に選んだ会話3を出したままにする", async () => {
    let answerSecond: (response: Response) => void = () => {};
    let secondCalls = 0;
    const detail2 = () =>
      jsonResponse({
        conversation: conversation({ conversationId: 2 }),
        messages: [
          message({ messageId: 30, conversationId: 2, bodyMd: "会話2の質問" }),
        ],
      });
    stubFetch({
      [LIST_KEY]: () =>
        jsonResponse({
          items: [
            conversation(),
            conversation({ conversationId: 2 }),
            conversation({ conversationId: 3 }),
          ],
          nextCursor: null,
        }),
      [DETAIL_KEY]: () =>
        jsonResponse({ conversation: conversation(), messages: [message()] }),
      // 1回目は書き出しを取る呼び出し。2回目（選んだとき）の応答を遅らせる。
      "GET /api/app/conversations/2": () => {
        secondCalls += 1;
        if (secondCalls === 1) return detail2();
        return new Promise<Response>((resolve) => {
          answerSecond = resolve;
        });
      },
      "GET /api/app/conversations/3": () =>
        jsonResponse({
          conversation: conversation({ conversationId: 3 }),
          messages: [
            message({
              messageId: 40,
              conversationId: 3,
              bodyMd: "会話3の質問",
            }),
          ],
        }),
    });
    openSheet();
    const select = screen.getByRole("combobox", {
      name: "前の会話",
    }) as HTMLSelectElement;
    await waitFor(() =>
      expect(select.options[2]?.textContent).toContain("会話3の質問"),
    );
    fireEvent.change(select, { target: { value: "2" } });
    fireEvent.change(select, { target: { value: "3" } });
    await waitFor(() => expect(select.value).toBe("3"));
    await act(async () => {
      answerSecond(detail2());
    });
    expect(select.value).toBe("3");
    expect(screen.getAllByTestId("owner-message")[0].textContent).toContain(
      "会話3の質問",
    );
  });

  it("A03 「新しい会話」は結果が出るまで押せなくし、空の会話を出す", async () => {
    let created: (response: Response) => void = () => {};
    stubFetch({
      [LIST_KEY]: () =>
        jsonResponse({ items: [conversation()], nextCursor: null }),
      [DETAIL_KEY]: () =>
        jsonResponse({
          conversation: conversation(),
          messages: [message(), aiMessage()],
        }),
      "POST /api/app/conversations": () =>
        new Promise<Response>((resolve) => {
          created = resolve;
        }),
    });
    openSheet();
    await screen.findByText("AI の応答");
    const button = screen.getByRole("button", { name: "新しい会話" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(calls("POST /api/app/conversations")).toHaveLength(1);
    await act(async () => {
      created(
        jsonResponse(
          { conversation: conversation({ conversationId: 9 }), notice: null },
          201,
        ),
      );
    });
    await waitFor(() => expect(screen.queryByText("AI の応答")).toBeNull());
    const select = screen.getByRole("combobox", {
      name: "前の会話",
    }) as HTMLSelectElement;
    expect(select.value).toBe("9");
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });

  it("A04 空の会話に最初の質問を受け付けたら、O02 の選択肢を質問の書き出しと最後に話した日時に変える", async () => {
    stubFetch({
      [LIST_KEY]: () =>
        jsonResponse({ items: [conversation()], nextCursor: null }),
      [DETAIL_KEY]: () =>
        jsonResponse({ conversation: conversation(), messages: [] }),
      [QUESTION_KEY]: () =>
        jsonResponse(
          {
            question: message({
              messageId: 20,
              bodyMd: "はじめての質問",
              sentAt: "2026-11-25T12:00:00.000+09:00",
            }),
            reply: aiMessage({
              messageId: 21,
              bodyMd: "",
              replyState: "writing",
              replyToMessageId: 20,
              sentAt: "2026-11-25T12:00:00.000+09:00",
            }),
          },
          202,
        ),
      "GET /api/app/messages/21/stream": never,
    });
    openSheet();
    const select = screen.getByRole("combobox", {
      name: "前の会話",
    }) as HTMLSelectElement;
    await waitFor(() =>
      expect(select.options[0]?.textContent).toBe(
        "新しい会話（11月24日（火） 05:30）",
      ),
    );
    typeQuestion("はじめての質問");
    fireEvent.click(sendButton());
    await screen.findByText("応答を作成中");
    expect(select.options[0].textContent).toBe(
      "はじめての質問（11月25日（水） 12:00）",
    );
  });

  it("A04 送れなかったら MSG-019 を出し、質問の文を欄に残す", async () => {
    stubFetch({
      [LIST_KEY]: () =>
        jsonResponse({ items: [conversation()], nextCursor: null }),
      [DETAIL_KEY]: () =>
        jsonResponse({ conversation: conversation(), messages: [] }),
      [QUESTION_KEY]: () => jsonResponse({}, 500),
    });
    openSheet();
    await waitFor(() => expect(screen.queryByText("読み込み中")).toBeNull());
    typeQuestion("残す質問");
    fireEvent.click(sendButton());
    expect((await screen.findByRole("alert")).textContent).toBe(
      CHAT_MESSAGES["MSG-019"],
    );
    expect(
      (screen.getByRole("textbox", { name: "質問" }) as HTMLTextAreaElement)
        .value,
    ).toBe("残す質問");
    expect(sendButton().disabled).toBe(false);
  });

  it("A04 同じ会話に作成中の応答があった（409）ら、質問の文を残して作成中の応答を出す", async () => {
    stubFetch({
      [LIST_KEY]: () =>
        jsonResponse({ items: [conversation()], nextCursor: null }),
      [DETAIL_KEY]: () =>
        jsonResponse({ conversation: conversation(), messages: [message()] }),
      [QUESTION_KEY]: () =>
        jsonResponse(
          {
            error: {
              code: "reply_in_progress",
              message: "作成中",
              messageId: "MSG-019",
            },
            reply: aiMessage({ bodyMd: "", replyState: "writing" }),
          },
          409,
        ),
      "GET /api/app/messages/11/stream": never,
    });
    openSheet();
    await screen.findAllByText("最初の質問");
    typeQuestion("別の端末からの質問");
    fireEvent.click(sendButton());
    await screen.findByText("応答を作成中");
    expect(
      (screen.getByRole("textbox", { name: "質問" }) as HTMLTextAreaElement)
        .value,
    ).toBe("別の端末からの質問");
  });

  it("I01 質問は 4,000 文字を超えて入れられない", async () => {
    stubFetch({
      [LIST_KEY]: () =>
        jsonResponse({ items: [conversation()], nextCursor: null }),
      [DETAIL_KEY]: () =>
        jsonResponse({ conversation: conversation(), messages: [] }),
    });
    openSheet();
    typeQuestion("あ".repeat(3999) + "𠮷𠮷");
    const value = (
      screen.getByRole("textbox", { name: "質問" }) as HTMLTextAreaElement
    ).value;
    expect([...value]).toHaveLength(4000);
  });

  it("作成中の応答を streamReply で少しずつ受け、終わったら状態を出す", async () => {
    const stream = sseResponse();
    stubFetch({
      [LIST_KEY]: () =>
        jsonResponse({ items: [conversation()], nextCursor: null }),
      [DETAIL_KEY]: () =>
        jsonResponse({
          conversation: conversation(),
          messages: [
            message(),
            aiMessage({ bodyMd: "途中", replyState: "writing" }),
          ],
        }),
      "GET /api/app/messages/11/stream": () => stream.response,
    });
    openSheet();
    await screen.findByText("途中");
    await act(async () => {
      stream.send("retry: 3000\n\n");
      stream.send('event: delta\nid: 5.2\ndata: {"text":"途中"}\n\n');
      stream.send('event: delta\nid: 5.5\ndata: {"text":"まで来た"}\n\n');
    });
    await screen.findByText("途中まで来た");
    expect(screen.getByRole("button", { name: "止める" })).toBeTruthy();
    await act(async () => {
      stream.send(
        'event: state\ndata: {"replyState":"done","messageId":11,"notice":null}\n\n',
      );
      stream.close();
    });
    await waitFor(() => expect(screen.queryByText("応答を作成中")).toBeNull());
    expect(screen.queryByRole("button", { name: "止める" })).toBeNull();
    expect(screen.getByText("途中まで来た")).toBeTruthy();
  });

  it("読み込めなければ MSG-019 を出す", async () => {
    stubFetch({ [LIST_KEY]: () => jsonResponse({}, 500) });
    openSheet();
    expect(await screen.findByText(CHAT_MESSAGES["MSG-019"])).toBeTruthy();
    expect(screen.queryByText("読み込み中")).toBeNull();
  });

  it("文言は M23 の MSG の一覧と同じ", () => {
    for (const [id, text] of Object.entries(CHAT_MESSAGES)) {
      expect(MESSAGES[id as keyof typeof MESSAGES].text).toBe(text);
    }
  });
});

describe("M09 応答の続きを受ける（ADR-013、DD-04 3.5）", () => {
  it("切れたら、最後に受けた出来事の番号を Last-Event-ID に付けてつなぎ直し、reset で本文を空にする", async () => {
    const first = sseResponse();
    const second = sseResponse();
    const responses = [first, second];
    stubFetch({
      "GET /api/app/messages/11/stream": () => {
        const next = responses.shift();
        return next ? next.response : jsonResponse({}, 500);
      },
    });
    const events: string[] = [];
    const controller = new AbortController();
    const done = streamReply(
      11,
      {
        onReset: () => events.push("reset"),
        onDelta: (text) => events.push(`delta:${text}`),
        onState: (event) => events.push(`state:${event.replyState}`),
        onFailed: () => events.push("failed"),
        onUnauthorized: () => events.push("unauthorized"),
      },
      controller.signal,
    );
    first.send("retry: 10\n\n");
    first.send('event: delta\nid: 5.3\ndata: {"text":"abc"}\n\n');
    first.close();
    await waitFor(() =>
      expect(calls("GET /api/app/messages/11/stream")).toHaveLength(2),
    );
    second.send("event: reset\ndata: {}\n\n");
    second.send('event: delta\nid: 6.1\ndata: {"text":"x"}\n\n');
    second.send(
      'event: state\ndata: {"replyState":"failed","messageId":11,"notice":"MSG-012"}\n\n',
    );
    await done;
    const headers = calls("GET /api/app/messages/11/stream").map((init) =>
      new Headers(init.headers).get("Last-Event-ID"),
    );
    expect(headers).toEqual([null, "5.3"]);
    // 初めは位置 0 から受けるので、最初の続きの前に表示を空にする。
    expect(events).toEqual([
      "reset",
      "delta:abc",
      "reset",
      "delta:x",
      "state:failed",
    ]);
  });

  it("つなげない（404 など）ときは onFailed を呼んで終わる", async () => {
    stubFetch({
      "GET /api/app/messages/11/stream": () => jsonResponse({}, 404),
    });
    const onFailed = vi.fn();
    await streamReply(
      11,
      {
        onReset: () => {},
        onDelta: () => {},
        onState: () => {},
        onFailed,
        onUnauthorized: () => {},
      },
      new AbortController().signal,
    );
    expect(onFailed).toHaveBeenCalledTimes(1);
  });
});
