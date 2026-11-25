import type { z } from "zod";
import {
  type ChatMessage,
  type ConversationCreated,
  type ConversationDetail,
  type ConversationPage,
  conversationCreatedSchema,
  conversationDetailSchema,
  conversationPageSchema,
  messageSchema,
  type QuestionTarget,
  questionAcceptedSchema,
  replyDeltaSchema,
  replyInProgressSchema,
  type ReplyStateEvent,
  replyStateEventSchema,
} from "../contracts/chat";
import { deviceFetch } from "./device-api";

// 通信層 M09（DD-01 1.1）。会話の端末の API を呼び、応答を M10 の形で確かめる
// （DD-04 `listConversations`、`createConversation`、`getConversation`、`postQuestion`、
// `retryReply`、`stopReply`、`dismissReply`）。応答の続き（`streamReply`）は SSE で受け、
// 切れたら受け取った位置（`Last-Event-ID`）からつなぎ直す（ADR-013、DD-04 3.2・3.5）。
// 結果は次のどれかで返す。
// - ok: 応答の形が正しい
// - unauthorized: 401（MSG-020）。全面の知らせは M01 の枠が出す（deviceFetch が届け先に渡す）
// - failed: それ以外の失敗（つながらない、想定の外の状態の番号、形が違う）。画面は MSG-019 を出す
// 呼んだ画面が止めた（AbortSignal）ときは、AbortError をそのまま投げる。

export type ApiResult<T> =
  | { status: "ok"; value: T }
  | { status: "unauthorized" }
  | { status: "failed" };

async function requestJson<T>(
  path: string,
  init: RequestInit,
  schema: z.ZodType<T>,
  okStatus: number,
): Promise<ApiResult<T>> {
  const { signal } = init;
  let response: Response;
  try {
    response = await deviceFetch(path, init);
  } catch (error) {
    if (signal?.aborted) throw error;
    return { status: "failed" };
  }
  if (response.status === 401) return { status: "unauthorized" };
  if (response.status !== okStatus) return { status: "failed" };
  return readBody(response, schema, signal);
}

async function readBody<T>(
  response: Response,
  schema: z.ZodType<T>,
  signal: AbortSignal | null | undefined,
): Promise<ApiResult<T>> {
  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    if (signal?.aborted) throw error;
    return { status: "failed" };
  }
  const parsed = schema.safeParse(body);
  return parsed.success
    ? { status: "ok", value: parsed.data }
    : { status: "failed" };
}

function postInit(body: unknown, signal?: AbortSignal): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  };
}

// `listConversations`（FN-014）。対象の内容の会話を、最後に話した日時の新しい順に読む。
// `targetContentId` が null なら対象の無い会話。
export function fetchConversations(
  targetContentId: number | null,
  signal?: AbortSignal,
): Promise<ApiResult<ConversationPage>> {
  const path =
    targetContentId === null
      ? "/api/app/conversations"
      : `/api/app/conversations?targetContentId=${targetContentId}`;
  return requestJson(path, { signal }, conversationPageSchema, 200);
}

// `createConversation`（FN-014）。対象が無ければ対象の無い会話を作る。
export function createConversation(
  target: QuestionTarget | null,
  signal?: AbortSignal,
): Promise<ApiResult<ConversationCreated>> {
  return requestJson(
    "/api/app/conversations",
    postInit(target === null ? {} : { target }, signal),
    conversationCreatedSchema,
    201,
  );
}

// `getConversation`（FN-014）。会話と、送った順の発言を読む。
export function fetchConversation(
  conversationId: number,
  signal?: AbortSignal,
): Promise<ApiResult<ConversationDetail>> {
  return requestJson(
    `/api/app/conversations/${conversationId}`,
    { signal },
    conversationDetailSchema,
    200,
  );
}

export type PostQuestionResult =
  | { status: "accepted"; question: ChatMessage; reply: ChatMessage }
  // 409 `reply_in_progress`。質問は残されず、作成中の AI の発言が返る（DD-04 3.2）。
  | { status: "reply_in_progress"; reply: ChatMessage }
  | { status: "unauthorized" }
  | { status: "failed" };

// `postQuestion`（FN-015）。
export async function postQuestion(
  conversationId: number,
  text: string,
  signal?: AbortSignal,
): Promise<PostQuestionResult> {
  let response: Response;
  try {
    response = await deviceFetch(
      `/api/app/conversations/${conversationId}/questions`,
      postInit({ text }, signal),
    );
  } catch (error) {
    if (signal?.aborted) throw error;
    return { status: "failed" };
  }
  if (response.status === 401) return { status: "unauthorized" };
  if (response.status === 202) {
    const result = await readBody(response, questionAcceptedSchema, signal);
    return result.status === "ok"
      ? { status: "accepted", ...result.value }
      : result;
  }
  if (response.status === 409) {
    const result = await readBody(response, replyInProgressSchema, signal);
    return result.status === "ok"
      ? { status: "reply_in_progress", reply: result.value.reply }
      : result;
  }
  return { status: "failed" };
}

export type ReplyAction = "retry" | "stop" | "dismiss";

// `retryReply`、`stopReply`、`dismissReply`（FN-016）。今の AI の発言が返る。
export function postReplyAction(
  messageId: number,
  action: ReplyAction,
  signal?: AbortSignal,
): Promise<ApiResult<ChatMessage>> {
  return requestJson(
    `/api/app/messages/${messageId}/${action}`,
    postInit(undefined, signal),
    messageSchema,
    200,
  );
}

// ---- 応答の続き（`streamReply`） ----

// つなぎ直すまでの時間の既定（DD-04 3.2。Web サーバが `retry:` で送った値があればそれを使う）。
export const DEFAULT_STREAM_RETRY_MS = 3_000;

export interface ReplyStreamHandlers {
  /** 表示している本文を空にする（reset の出来事か、位置 0 から受け直すとき） */
  onReset: () => void;
  /** 本文の続き */
  onDelta: (text: string) => void;
  /** 応答の状態が完了、失敗、中止になった。続きは閉じている */
  onState: (event: ReplyStateEvent) => void;
  /** つなげない（404、500 など）。続きは閉じている。画面は `getConversation` で読み直す */
  onFailed: () => void;
  /** 401（MSG-020）。続きは閉じている */
  onUnauthorized: () => void;
}

interface SseEvent {
  event: string;
  data: string;
  id: string | null;
}

// SSE の文を出来事に分ける。終わりの空行がまだ来ていない残りを返す。
function splitEvents(
  buffer: string,
  onEvent: (event: SseEvent) => void,
  onRetry: (ms: number) => void,
): string {
  const normalized = buffer.replace(/\r\n?/g, "\n");
  const blocks = normalized.split("\n\n");
  const rest = blocks.pop() ?? "";
  for (const block of blocks) {
    let event = "message";
    let id: string | null = null;
    const data: string[] = [];
    for (const line of block.split("\n")) {
      if (line === "" || line.startsWith(":")) continue;
      const colon = line.indexOf(":");
      const field = colon === -1 ? line : line.slice(0, colon);
      let value = colon === -1 ? "" : line.slice(colon + 1);
      if (value.startsWith(" ")) value = value.slice(1);
      if (field === "event") event = value;
      else if (field === "data") data.push(value);
      else if (field === "id") id = value;
      else if (field === "retry" && /^[0-9]+$/.test(value)) {
        onRetry(Number(value));
      }
    }
    if (data.length > 0) onEvent({ event, data: data.join("\n"), id });
  }
  return rest;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done);
  });
}

// AI の発言の応答の続きを受ける。`signal` で止めるまで、または応答の状態が作成中でなくなるまで続ける。
// - 初めは `Last-Event-ID` を付けずにつなぐ。Web サーバは位置 0 から本文を送るので、最初の続きの前に
//   `onReset` を呼び、表示を受け直した本文で置き換える。
// - 送り始めた後に切れたら（出来事を送らずに閉じた、つながらない）、`retry` の時間の後に、最後に受けた
//   出来事の番号を `Last-Event-ID` に付けてつなぎ直す（DD-04 3.2、3.5。DD-06 E08）。
export async function streamReply(
  messageId: number,
  handlers: ReplyStreamHandlers,
  signal: AbortSignal,
): Promise<void> {
  let lastEventId: string | null = null;
  let retryMs = DEFAULT_STREAM_RETRY_MS;

  while (!signal.aborted) {
    const fresh = lastEventId === null;
    let response: Response;
    try {
      response = await deviceFetch(`/api/app/messages/${messageId}/stream`, {
        headers:
          lastEventId === null
            ? { Accept: "text/event-stream" }
            : { Accept: "text/event-stream", "Last-Event-ID": lastEventId },
        signal,
      });
    } catch {
      if (signal.aborted) return;
      await wait(retryMs, signal);
      continue;
    }
    if (response.status === 401) {
      handlers.onUnauthorized();
      return;
    }
    if (response.status !== 200 || response.body === null) {
      handlers.onFailed();
      return;
    }

    let resetDone = !fresh;
    let finished = false;
    const onEvent = (event: SseEvent) => {
      if (finished) return;
      if (event.event === "reset") {
        handlers.onReset();
        resetDone = true;
      } else if (event.event === "delta") {
        const parsed = replyDeltaSchema.safeParse(parseJson(event.data));
        if (!parsed.success) return;
        if (!resetDone) {
          handlers.onReset();
          resetDone = true;
        }
        handlers.onDelta(parsed.data.text);
        if (event.id !== null) lastEventId = event.id;
      } else if (event.event === "state") {
        const parsed = replyStateEventSchema.safeParse(parseJson(event.data));
        if (!parsed.success) return;
        if (parsed.data.replyState === "writing") return;
        finished = true;
        handlers.onState(parsed.data);
      }
    };

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        buffer = splitEvents(buffer, onEvent, (ms) => {
          retryMs = ms;
        });
        if (finished) break;
      }
    } catch {
      // 送り始めた後の失敗。下でつなぎ直す。
    } finally {
      reader.cancel().catch(() => undefined);
    }
    if (finished || signal.aborted) return;
    await wait(retryMs, signal);
  }
}
