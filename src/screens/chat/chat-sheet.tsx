"use client";

import {
  type ChangeEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  createConversation,
  DEFAULT_STREAM_RETRY_MS,
  fetchConversation,
  fetchConversations,
  postQuestion,
  postReplyAction,
  type ReplyAction,
  streamReply,
} from "../../client/chat";
import {
  type ChatMessage,
  type Conversation,
  type ConversationDetail,
  QUESTION_MAX_CHARS,
  type QuestionTarget,
} from "../../contracts/chat";
import { BottomSheet } from "../../ui/bottom-sheet";
import { EmptyState } from "../../ui/empty-state";
import { formatListDate } from "../../ui/list-date";
import { QuestionTargetBadge } from "../../ui/question-target-badge";
import { ReceivedText } from "../../ui/received-text";
import { CHAT_MESSAGES } from "./messages";

// SCR-006 AI チャット（DD-01 M06。BD-03 SCR-006、BD-02 FN-014〜FN-016、BD-09 5章）。
// M02〜M04 から対象（内容ID と選んだ箇所。無ければ null）を受けて、下から出る面で開く。
// - A01 開いたら、対象の内容の前の会話を読み（`listConversations`）、一番新しい会話の発言を出す。
//   無ければ今の対象で新しい会話を作る（`createConversation`。対象が無ければ MSG-011）。
// - O02 前の会話の選択肢には、最初の質問の書き出しと最後に話した日時を出す。書き出しは、会話ごとに
//   `getConversation` を呼び、最初の本人の発言から取る（本人の答え。API は変えない）。
// - O01 対象の印は、出している会話の対象から出す（前の会話を選んだら、その会話の対象で続ける。DD-02 FN-014）。
// - A04 「送る」は、押してから質問を受け付けたと返るまでと、同じ会話の応答が作成中のあいだ押せなくする
//   （BD-09 5章 誤操作の防止、BD-02 FN-015）。失敗したら質問の文を欄に残す。
// - 作成中の応答は `streamReply` で少しずつ受ける。開き直したときも、作成中なら続きから受ける（ADR-013）。
// - 応答の状態ごとに「止める」（作成中）、「送り直す」（失敗か中止）、「やめる」（失敗）を出し、
//   押してから結果が出るまで押せなくする。
// - 401（MSG-020）のときは何も出さない。全面の知らせは M01 の枠が出す。

const SHEET_TITLE = "AI チャット";
// 前の会話の選択肢に出す、最初の質問の書き出しの長さ（文字）。
const SNIPPET_CHARS = 30;

type Phase = "loading" | "ready" | "failed" | "unauthorized";

interface ConversationOption {
  conversation: Conversation;
  /** 最初の質問の書き出し。読めていないか質問が無ければ null */
  snippet: string | null;
}

export function ChatSheet({
  open,
  onClose,
  target,
}: {
  open: boolean;
  onClose: () => void;
  /** 質問の対象。ホームから開くときは null（対象の無い会話） */
  target: QuestionTarget | null;
}) {
  return (
    <BottomSheet open={open} title={SHEET_TITLE} onClose={onClose}>
      <ChatPanel target={target} />
    </BottomSheet>
  );
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

// 間を空ける。止めたら AbortError で終わる。
function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });
}

function countChars(text: string): number {
  return [...text].length;
}

// 最初の本人の発言から書き出しを取る。
function snippetOf(messages: readonly ChatMessage[]): string | null {
  const first = messages.find((message) => message.speaker === "owner");
  if (first === undefined) return null;
  const line = first.bodyMd.replace(/\s+/g, " ").trim();
  const chars = [...line];
  return chars.length > SNIPPET_CHARS
    ? `${chars.slice(0, SNIPPET_CHARS).join("")}…`
    : line;
}

// 今の日本時間の年。日付の書式（今年かどうか）を決める。
function thisYearInJapan(now: Date): number {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).getUTCFullYear();
}

// 日本時間の日時（`YYYY-MM-DDTHH:MM:SS.sss+09:00`）を「11月23日（月） 05:30」にする（BD-09 5章 表示書式）。
function formatDateTime(dateTime: string, thisYear: number): string {
  return `${formatListDate(dateTime.slice(0, 10), thisYear)} ${dateTime.slice(11, 16)}`;
}

function targetLabelOf(conversation: Conversation): string {
  const { target } = conversation;
  if (target === null) return "";
  if (target.kind === "phrase") return target.phrase ?? "";
  return conversation.targetTitle ?? "";
}

function noticeTextOf(message: ChatMessage): string | null {
  if (message.notice) return CHAT_MESSAGES[message.notice];
  if (message.replyState === "failed") return CHAT_MESSAGES["MSG-012"];
  if (message.replyState === "cancelled") return CHAT_MESSAGES["MSG-014"];
  return null;
}

function ChatPanel({ target }: { target: QuestionTarget | null }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [options, setOptions] = useState<ConversationOption[]>([]);
  const [current, setCurrent] = useState<ConversationDetail | null>(null);
  const [openNotice, setOpenNotice] = useState<"MSG-011" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const [creating, setCreating] = useState(false);
  const creatingRef = useRef(false);
  const [pending, setPending] = useState<ReadonlySet<number>>(new Set());
  const pendingRef = useRef(new Set<number>());
  const unmountRef = useRef(new AbortController());
  // 会話を選ぶか作るたびに増やす。古い求めの結果で、後から選んだ会話を置き換えないため（SCR-006-A02）。
  const selectionRef = useRef(0);
  const thisYear = thisYearInJapan(new Date());

  useEffect(() => {
    const controller = new AbortController();
    unmountRef.current = controller;
    return () => controller.abort();
  }, []);

  // 出している会話の発言を1つ変える。
  const updateMessage = useCallback(
    (messageId: number, change: (message: ChatMessage) => ChatMessage) => {
      setCurrent((detail) =>
        detail === null
          ? detail
          : {
              ...detail,
              messages: detail.messages.map((message) =>
                message.messageId === messageId ? change(message) : message,
              ),
            },
      );
    },
    [],
  );

  // A01: 対象と前の会話を読む。呼ぶ画面が描くたびに対象の値を作り直しても読み直さないよう、
  // 対象は中身（JSON の文）で比べる。
  const targetKey = JSON.stringify(target);
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    const target = JSON.parse(targetKey) as QuestionTarget | null;
    const run = async () => {
      const selection = selectionRef.current;
      const list = await fetchConversations(target?.contentId ?? null, signal);
      if (list.status !== "ok") {
        setPhase(list.status);
        return;
      }
      const items = list.value.items;
      if (items.length === 0) {
        const created = await createConversation(target, signal);
        if (created.status !== "ok") {
          setPhase(created.status);
          return;
        }
        const { conversation, notice } = created.value;
        setOptions([{ conversation, snippet: null }]);
        setCurrent({ conversation, messages: [] });
        setOpenNotice(notice);
        setPhase("ready");
        return;
      }
      // 選択肢の書き出しを取るため、会話ごとに発言を読む。
      const readSnippets = (page: readonly Conversation[]) =>
        page.map((conversation) =>
          fetchConversation(conversation.conversationId, signal).then(
            (result) => {
              if (result.status === "ok") {
                const snippet = snippetOf(result.value.messages);
                setOptions((previous) =>
                  previous.map((option) =>
                    option.conversation.conversationId ===
                    conversation.conversationId
                      ? { ...option, snippet }
                      : option,
                  ),
                );
              }
              return result;
            },
          ),
        );
      setOptions(
        items.map((conversation) => ({ conversation, snippet: null })),
      );
      // 一番新しい会話の発言はそのまま出す。
      const details = readSnippets(items);
      const newest = await details[0];
      if (newest.status !== "ok") {
        setPhase(newest.status);
        return;
      }
      // 読むあいだに会話を選んだか作ったなら、そちらを出したままにする。
      if (selectionRef.current === selection) setCurrent(newest.value);
      setPhase("ready");
      // 続きのページの会話も選べるよう、最後のページまで読む（DD-04 ページング）。
      let cursor = list.value.nextCursor;
      while (cursor !== null) {
        const next = await fetchConversations(
          target?.contentId ?? null,
          signal,
          cursor,
        );
        if (next.status !== "ok") {
          if (next.status === "failed") setError(CHAT_MESSAGES["MSG-019"]);
          break;
        }
        const added = next.value.items;
        setOptions((previous) => {
          const known = new Set(
            previous.map((option) => option.conversation.conversationId),
          );
          return [
            ...previous,
            ...added
              .filter((conversation) => !known.has(conversation.conversationId))
              .map((conversation) => ({ conversation, snippet: null })),
          ];
        });
        details.push(...readSnippets(added));
        cursor = next.value.nextCursor;
      }
      await Promise.all(details);
    };
    run().catch((caught: unknown) => {
      if (isAbortError(caught) || signal.aborted) return;
      setPhase("failed");
    });
    return () => controller.abort();
  }, [targetKey]);

  // 続きを受けられないときに、作成中の応答が終わるまで `getConversation` で読み直す（DD-04 3.5）。
  const pollConversation = useCallback(
    async (id: number, messageId: number, signal: AbortSignal) => {
      // 読み直しで出した MSG-019 だけを、読めたときに消す。
      let shownError = false;
      try {
        while (!signal.aborted) {
          const result = await fetchConversation(id, signal);
          if (signal.aborted) return;
          if (result.status === "unauthorized") return;
          if (result.status === "ok") {
            if (shownError) setError(null);
            shownError = false;
            setCurrent(result.value);
            const stillWriting = result.value.messages.some(
              (message) =>
                message.messageId === messageId &&
                message.replyState === "writing",
            );
            if (!stillWriting) return;
          } else {
            setError(CHAT_MESSAGES["MSG-019"]);
            shownError = true;
          }
          await wait(DEFAULT_STREAM_RETRY_MS, signal);
        }
      } catch {
        // 止めた（AbortSignal）ときは何もしない。
      }
    },
    [],
  );

  // 作成中の応答の続きを受ける。
  const conversationId = current?.conversation.conversationId ?? null;
  const writingId =
    current?.messages.find(
      (message) => message.speaker === "ai" && message.replyState === "writing",
    )?.messageId ?? null;

  useEffect(() => {
    if (conversationId === null || writingId === null) return;
    const controller = new AbortController();
    const { signal } = controller;
    streamReply(
      writingId,
      {
        onReset: () => updateMessage(writingId, (m) => ({ ...m, bodyMd: "" })),
        onDelta: (delta) =>
          updateMessage(writingId, (m) => ({ ...m, bodyMd: m.bodyMd + delta })),
        onState: (event) =>
          updateMessage(writingId, (m) => ({
            ...m,
            replyState: event.replyState,
            notice: event.notice,
          })),
        onFailed: () => {
          // つなげないときは `getConversation` で読む（DD-04 3.5）。応答がまだ作成中なら、
          // 完了、失敗、中止になるまで、間を空けて読み直す。
          void pollConversation(conversationId, writingId, signal);
        },
        onUnauthorized: () => undefined,
      },
      signal,
    ).catch(() => undefined);
    return () => controller.abort();
  }, [conversationId, writingId, updateMessage, pollConversation]);

  // A02: 前の会話を選ぶ。
  async function selectConversation(id: number) {
    setError(null);
    setOpenNotice(null);
    const selection = ++selectionRef.current;
    try {
      const result = await fetchConversation(id, unmountRef.current.signal);
      // 後から別の会話を選んだか作ったなら、この結果は出さない。
      if (selection !== selectionRef.current) return;
      if (result.status === "ok") setCurrent(result.value);
      else if (result.status === "failed") setError(CHAT_MESSAGES["MSG-019"]);
    } catch (caught) {
      if (selection !== selectionRef.current) return;
      if (!isAbortError(caught)) setError(CHAT_MESSAGES["MSG-019"]);
    }
  }

  // A03: 今の対象で新しい会話を作る。
  async function startConversation() {
    if (creatingRef.current) return;
    creatingRef.current = true;
    setCreating(true);
    setError(null);
    const selection = ++selectionRef.current;
    try {
      const result = await createConversation(
        target,
        unmountRef.current.signal,
      );
      if (result.status === "ok") {
        const { conversation, notice } = result.value;
        setOptions((previous) => [
          { conversation, snippet: null },
          ...previous,
        ]);
        // 作るあいだに別の会話を選んだなら、選んだ会話を出したままにする。
        if (selection === selectionRef.current) {
          setCurrent({ conversation, messages: [] });
          setOpenNotice(notice);
        }
        setPhase("ready");
      } else if (result.status === "failed") {
        setError(CHAT_MESSAGES["MSG-019"]);
      }
    } catch (caught) {
      if (!isAbortError(caught)) setError(CHAT_MESSAGES["MSG-019"]);
    } finally {
      creatingRef.current = false;
      setCreating(false);
    }
  }

  // A04: 質問を送る。
  async function send() {
    if (current === null || sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    setError(null);
    const id = current.conversation.conversationId;
    try {
      const result = await postQuestion(id, text, unmountRef.current.signal);
      if (result.status === "accepted") {
        const { question } = result;
        setCurrent((detail) =>
          detail === null || detail.conversation.conversationId !== id
            ? detail
            : {
                ...detail,
                conversation: {
                  ...detail.conversation,
                  lastSpokenAt: question.sentAt,
                },
                messages: [...detail.messages, question, result.reply],
              },
        );
        // 選択肢（O02）の、最初の質問の書き出しと最後に話した日時を変える。
        setOptions((previous) =>
          previous.map((option) =>
            option.conversation.conversationId === id
              ? {
                  conversation: {
                    ...option.conversation,
                    lastSpokenAt: question.sentAt,
                  },
                  snippet: option.snippet ?? snippetOf([question]),
                }
              : option,
          ),
        );
        setText("");
      } else if (result.status === "reply_in_progress") {
        // 質問の文は欄に残し、作成中の応答を見せる（DD-04 3.4）。
        const { reply } = result;
        setCurrent((detail) => {
          if (detail === null || detail.conversation.conversationId !== id) {
            return detail;
          }
          const known = detail.messages.some(
            (message) => message.messageId === reply.messageId,
          );
          return {
            ...detail,
            messages: known
              ? detail.messages.map((message) =>
                  message.messageId === reply.messageId
                    ? { ...message, replyState: reply.replyState }
                    : message,
                )
              : [...detail.messages, reply],
          };
        });
      } else if (result.status === "failed") {
        setError(CHAT_MESSAGES["MSG-019"]);
      }
    } catch (caught) {
      if (!isAbortError(caught)) setError(CHAT_MESSAGES["MSG-019"]);
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }

  // A05〜A07: 送り直す、止める、やめる。
  async function act(message: ChatMessage, action: ReplyAction) {
    const { messageId } = message;
    if (pendingRef.current.has(messageId)) return;
    pendingRef.current.add(messageId);
    setPending(new Set(pendingRef.current));
    setError(null);
    try {
      const result = await postReplyAction(
        messageId,
        action,
        unmountRef.current.signal,
      );
      if (result.status === "ok") {
        const next = result.value;
        updateMessage(messageId, (local) =>
          // 作成中のまま（止める求めを受けた）なら、本文は続きで受けるので、受けた本文を残す。
          local.replyState === "writing" && next.replyState === "writing"
            ? { ...local, notice: next.notice ?? null }
            : next,
        );
      } else if (result.status === "failed") {
        setError(CHAT_MESSAGES["MSG-019"]);
      }
    } catch (caught) {
      if (!isAbortError(caught)) setError(CHAT_MESSAGES["MSG-019"]);
    } finally {
      pendingRef.current.delete(messageId);
      setPending(new Set(pendingRef.current));
    }
  }

  function changeText(event: ChangeEvent<HTMLTextAreaElement>) {
    const value = event.target.value;
    // 上限を超えたら入れられない（BD-03 SCR-006-I01。文字で数える）。
    setText(
      countChars(value) > QUESTION_MAX_CHARS
        ? [...value].slice(0, QUESTION_MAX_CHARS).join("")
        : value,
    );
  }

  if (phase === "unauthorized") return null;

  const conversation = current?.conversation ?? null;
  const canSend =
    current !== null && text !== "" && !sending && writingId === null;

  return (
    <div className="flex h-full flex-col">
      <div className="border-b">
        {conversation !== null && conversation.target !== null && (
          <QuestionTargetBadge
            kind={conversation.target.kind}
            label={targetLabelOf(conversation)}
          />
        )}
        <div className="flex items-center gap-2 px-4 pb-2">
          <select
            aria-label="前の会話"
            value={conversation?.conversationId ?? ""}
            disabled={options.length === 0}
            onChange={(event) =>
              void selectConversation(Number(event.target.value))
            }
            className="min-h-11 min-w-0 flex-1 truncate rounded border px-2 text-sm"
          >
            {options.map((option) => (
              <option
                key={option.conversation.conversationId}
                value={option.conversation.conversationId}
              >
                {`${option.snippet ?? "新しい会話"}（${formatDateTime(
                  option.conversation.lastSpokenAt,
                  thisYear,
                )}）`}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void startConversation()}
            disabled={creating || phase === "loading"}
            className="inline-flex min-h-11 shrink-0 items-center justify-center rounded border px-3 text-sm disabled:opacity-50"
          >
            新しい会話
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-2">
        {phase === "loading" && (
          <p role="status" className="py-6 text-center text-sm">
            読み込み中
          </p>
        )}
        {phase === "failed" && (
          <EmptyState message={CHAT_MESSAGES["MSG-019"]} />
        )}
        {phase === "ready" && openNotice !== null && (
          <p role="status" className="py-2 text-sm">
            {CHAT_MESSAGES[openNotice]}
          </p>
        )}
        {phase === "ready" && current !== null && (
          <ol className="flex flex-col gap-3">
            {current.messages.map((message) => (
              <MessageItem
                key={message.messageId}
                message={message}
                thisYear={thisYear}
                pending={pending.has(message.messageId)}
                onAction={(action) => void act(message, action)}
              />
            ))}
          </ol>
        )}
      </div>

      <form
        className="border-t px-4 py-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (canSend) void send();
        }}
      >
        {error !== null && (
          <p role="alert" className="pb-2 text-sm">
            {error}
          </p>
        )}
        <div className="flex items-end gap-2">
          <textarea
            aria-label="質問"
            value={text}
            onChange={changeText}
            rows={2}
            className="min-h-11 min-w-0 flex-1 resize-none rounded border px-2 py-1 text-sm"
          />
          <button
            type="submit"
            disabled={!canSend}
            className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded border px-3 text-sm disabled:opacity-50"
          >
            送る
          </button>
        </div>
      </form>
    </div>
  );
}

function MessageItem({
  message,
  thisYear,
  pending,
  onAction,
}: {
  message: ChatMessage;
  thisYear: number;
  pending: boolean;
  onAction: (action: ReplyAction) => void;
}) {
  const isAi = message.speaker === "ai";
  const notice = isAi ? noticeTextOf(message) : null;
  return (
    <li
      data-testid={isAi ? "ai-message" : "owner-message"}
      className={`rounded-lg border px-3 py-2 text-sm ${isAi ? "" : "self-end"}`}
    >
      <p className="pb-1 text-xs opacity-70">
        {isAi ? "AI" : "本人"}　{formatDateTime(message.sentAt, thisYear)}
      </p>
      <ReceivedText markdown={message.bodyMd} />
      {isAi && message.replyState === "writing" && (
        <p role="status" aria-busy="true" className="pt-1 text-xs">
          応答を作成中
        </p>
      )}
      {notice !== null && (
        <p
          role={message.replyState === "failed" ? "alert" : "status"}
          className="pt-1 text-xs"
        >
          {notice}
        </p>
      )}
      {isAi && (
        <div className="flex gap-2 pt-1">
          {message.replyState === "writing" && (
            <ActionButton
              label="止める"
              disabled={pending}
              onClick={() => onAction("stop")}
            />
          )}
          {(message.replyState === "failed" ||
            message.replyState === "cancelled") && (
            <ActionButton
              label="送り直す"
              disabled={pending}
              onClick={() => onAction("retry")}
            />
          )}
          {message.replyState === "failed" && (
            <ActionButton
              label="やめる"
              disabled={pending}
              onClick={() => onAction("dismiss")}
            />
          )}
        </div>
      )}
    </li>
  );
}

function ActionButton({
  label,
  disabled,
  onClick,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="inline-flex min-h-11 min-w-11 items-center justify-center rounded border px-3 text-sm disabled:opacity-50"
    >
      {label}
    </button>
  );
}
