import { cancelQueuedRun, enqueueAnswer, requestStop } from "../ai-jobs";
import type { Database } from "../db/connection";
import { toDbError } from "../db/errors";
import { inWriteTransaction } from "../db/transaction";
import {
  type ConversationRow,
  type MessageRow,
  type ReplyMessageRow,
  contentExists,
  dismissFailedReply,
  findConversation,
  findMessageRow,
  findWritingReply,
  insertConversation,
  insertOwnerMessage,
  insertWritingReply,
  listConversationRows,
  listMessageRows,
  markReplyCancelled,
  restartReply,
  updateLastSpokenAt,
} from "../repositories/conversation";
import { findLatestAnswerRun } from "../repositories/ai-run";
import type { Clock } from "../shared/clock";
import { formatDateTime } from "../shared/datetime";
import { NexusError } from "../shared/errors";
import { type Page, type PageQuery, toPage } from "../shared/paging";

// 会話（DD-01 M18）のうち、会話の選択（DD-02 FN-014）。
//   listConversations  対象の内容ごとの前の会話（無ければ対象の無い会話）を、最後に話した日時の新しい順に
//                      3章 P03 で返す。
//   createConversation 対象の形を確かめ（2章 C07）、内容が無ければ対象を捨てて MSG-011 を添え、会話を作る。
//   getConversation    会話と発言を `message_id` の順に返し、AI の発言ごとに知らせを決める。
//   postQuestion       質問を受ける（DD-02 FN-015 受け付けの手順 2〜3）。同じ会話に作成中の応答があれば何も書かず、
//                      その発言を返す。無ければ1つのトランザクションで、本人の発言、作成中の AI の発言、
//                      最後に話した日時を書き、M20 で質問の応答を待ちに入れる。
//   readReply          応答の続きを流すために、AI の発言の本文、応答の状態、一番新しい実行ID、知らせを読む
//                      （DD-02 FN-015 続きを流すの手順 1、3、4。SSE の中継で M11 が 200 ミリ秒ごとに呼ぶ）。
//   retryReply         失敗か中止の応答を送り直す（DD-02 FN-016 手順 2）。
//   stopReply          作成中の応答を止める（DD-02 FN-016 手順 3）。
//   dismissReply       失敗した応答をやめる（DD-02 FN-016 手順 4）。
//                      3つとも1つのトランザクションで、遷移の前の状態を条件にした更新で行う（DD-05 2章・3章）。
//                      事前条件に合わなければ何もせずに、今の AI の発言を返す（DD-04 3.2、DD-06 E06）。
// 会話の作成は1文（DD-05 2章）。

// `openapi.yaml` の `QuestionTarget`（質問の対象。BD-07 4.1）。形は入口層が M10 で確かめてから渡す。
export interface QuestionTarget {
  kind: "page" | "article" | "phrase" | "node";
  contentId: number;
  phrase?: string;
  sentence?: string;
  position?: {
    part?: "reading" | "lesson" | "problem";
    paragraphIndex?: number;
    sentenceIndex?: number;
    problemNo?: number;
  };
}

// `openapi.yaml` の `Conversation`。
export interface Conversation {
  conversationId: number;
  target: QuestionTarget | null;
  targetTitle: string | null;
  startedAt: string;
  lastSpokenAt: string;
}

export type MessageNotice = "MSG-012" | "MSG-013" | "MSG-014";

// `openapi.yaml` の `Message`。
export interface ChatMessage {
  messageId: number;
  conversationId: number;
  speaker: "owner" | "ai";
  bodyMd: string;
  sentAt: string;
  replyState: "writing" | "done" | "failed" | "cancelled" | null;
  replyToMessageId: number | null;
  notice: MessageNotice | null;
}

// `openapi.yaml` の `ConversationCreated`。
export interface ConversationCreated {
  conversation: Conversation;
  notice: "MSG-011" | null;
}

// `openapi.yaml` の `ConversationDetail`。
export interface ConversationDetail {
  conversation: Conversation;
  messages: ChatMessage[];
}

// 質問を受けた結果（DD-02 FN-015 受け付けの手順 3）。
export type QuestionPosted =
  | { kind: "accepted"; question: ChatMessage; reply: ChatMessage }
  // 同じ会話に作成中の応答がある（409 `reply_in_progress`）。
  | { kind: "reply_in_progress"; reply: ChatMessage };

// 応答の続きを流すために読んだ AI の発言（DD-02 FN-015 続きを流す）。
export interface ReplyProgress {
  messageId: number;
  bodyMd: string;
  replyState: "writing" | "done" | "failed" | "cancelled";
  // その発言の一番新しい `ai_run` の ID。無ければ 0（実行の無い発言は作らないが、読めるようにしておく）。
  runId: number;
  // `state` の出来事で出す MSG（FN-014 の手順 4 と同じ決め方）。
  notice: MessageNotice | null;
}

export interface Chat {
  // 対象の内容（null なら対象の無い会話）の会話の一覧（FN-014 手順 2）。
  listConversations(
    targetContentId: number | null,
    query: PageQuery,
  ): Page<Conversation>;
  // 新しい会話を作る（FN-014 手順 3）。`phrase` に語句、文、位置が無ければ INPUT_INVALID を投げる。
  createConversation(target: QuestionTarget | null): ConversationCreated;
  // 会話と発言（FN-014 手順 4）。会話が無ければ NOT_FOUND を投げる。
  getConversation(conversationId: number): ConversationDetail;
  // 質問を受ける（FN-015 受け付けの手順 2〜3）。会話が無ければ NOT_FOUND を投げる。
  // 文の長さ（2章 C05）は入口層が確かめてから渡す。
  postQuestion(conversationId: number, text: string): QuestionPosted;
  // 応答の続きを読む（FN-015 続きを流す）。発言が無いか本人の発言なら NOT_FOUND を投げる。
  readReply(messageId: number): ReplyProgress;
  // 送り直す、止める、やめる（FN-016）。発言が無いか本人の発言なら NOT_FOUND を投げる。今の AI の発言を返す。
  retryReply(messageId: number): ChatMessage;
  stopReply(messageId: number): ChatMessage;
  dismissReply(messageId: number): ChatMessage;
}

// AI を動かす仕組みが使えない失敗（DD-06 E12）の `failure_reason` の先頭（DD-02 3章 P06 手順 5）。
const UNAVAILABLE_REASON_PREFIX = "AI_UNAVAILABLE:";

function toConversation(row: ConversationRow): Conversation {
  return {
    conversationId: row.conversationId,
    target:
      row.questionTargetJson === null
        ? null
        : (JSON.parse(row.questionTargetJson) as QuestionTarget),
    targetTitle: row.targetTitle,
    startedAt: row.startedAt,
    lastSpokenAt: row.lastSpokenAt,
  };
}

// AI の発言の知らせ（FN-014 手順 4）。失敗なら、一番新しい `ai_run` の分類が E12 なら MSG-013、
// ほかと `ai_run` が無いときは MSG-012。中止なら MSG-014。
export function noticeOf(row: MessageRow): MessageNotice | null {
  if (row.speaker !== "ai") return null;
  if (row.replyState === "cancelled") return "MSG-014";
  if (row.replyState !== "failed") return null;
  if (
    row.hasAiRun &&
    row.latestFailureReason !== null &&
    row.latestFailureReason.startsWith(UNAVAILABLE_REASON_PREFIX)
  ) {
    return "MSG-013";
  }
  return "MSG-012";
}

// 受け付けで返す発言（作成中か本人の発言なので、知らせは無い）。
function toPlainMessage(row: ReplyMessageRow): ChatMessage {
  return {
    messageId: row.messageId,
    conversationId: row.conversationId,
    speaker: row.speaker,
    bodyMd: row.bodyMd,
    sentAt: row.sentAt,
    replyState: row.replyState,
    replyToMessageId: row.replyToMessageId,
    notice: null,
  };
}

function toChatMessage(row: MessageRow): ChatMessage {
  return {
    messageId: row.messageId,
    conversationId: row.conversationId,
    speaker: row.speaker,
    bodyMd: row.bodyMd,
    sentAt: row.sentAt,
    replyState: row.replyState,
    replyToMessageId: row.replyToMessageId,
    notice: noticeOf(row),
  };
}

// `phrase` なら語句、文、位置がある（DD-02 2章 C07）。
function isTargetComplete(target: QuestionTarget): boolean {
  if (target.kind !== "phrase") return true;
  return (
    target.phrase !== undefined &&
    target.sentence !== undefined &&
    target.position !== undefined
  );
}

export function createChat(deps: { db: Database; clock: Clock }): Chat {
  const { db, clock } = deps;

  // FN-016 の手順 1 と、手順 2〜4 の1つを1つのトランザクションで行い、今の AI の発言を返す。
  // `change` は事前条件に合うときだけ状態を変える（合わなければ何もしない）。
  const changeReply = (
    messageId: number,
    change: (now: Date) => void,
  ): ChatMessage => {
    try {
      return inWriteTransaction(db, () => {
        const before = findMessageRow(db, messageId);
        if (before === null || before.speaker !== "ai") {
          throw new NexusError("NOT_FOUND", "AI の発言が無い");
        }
        change(clock.now());
        const after = findMessageRow(db, messageId);
        if (after === null) throw new NexusError("INTERNAL", "AI の発言が無い");
        return toChatMessage(after);
      });
    } catch (error) {
      throw toDbError(error);
    }
  };

  return {
    listConversations(targetContentId, { after, limit }) {
      try {
        // P03 手順 2〜3: `limit + 1` 件を読み、続きがあるかを決める。
        const rows = listConversationRows(
          db,
          targetContentId,
          after,
          limit + 1,
        );
        return toPage(
          rows,
          limit,
          (row) => ({ value: row.lastSpokenAt, id: row.conversationId }),
          toConversation,
        );
      } catch (error) {
        throw toDbError(error);
      }
    },
    createConversation(target) {
      if (target !== null && !isTargetComplete(target)) {
        throw new NexusError(
          "INPUT_INVALID",
          "phrase の対象に語句、文、位置が無い",
        );
      }
      try {
        let kept = target;
        let notice: ConversationCreated["notice"] = null;
        if (kept !== null && !contentExists(db, kept.contentId)) {
          // 内容が無ければ、対象を捨てて対象の無い会話にする（RD-06 UC-012）。
          kept = null;
          notice = "MSG-011";
        }
        const row = insertConversation(
          db,
          kept?.contentId ?? null,
          kept === null ? null : JSON.stringify(kept),
          formatDateTime(clock.now()),
        );
        return { conversation: toConversation(row), notice };
      } catch (error) {
        throw toDbError(error);
      }
    },
    getConversation(conversationId) {
      try {
        const row = findConversation(db, conversationId);
        if (row === null) {
          throw new NexusError("NOT_FOUND", "会話が無い");
        }
        const messages = listMessageRows(db, conversationId).map(toChatMessage);
        return { conversation: toConversation(row), messages };
      } catch (error) {
        throw toDbError(error);
      }
    },
    postQuestion(conversationId, text) {
      try {
        if (findConversation(db, conversationId) === null) {
          throw new NexusError("NOT_FOUND", "会話が無い");
        }
        const now = clock.now();
        const at = formatDateTime(now);
        // 書き込みの権利を先に取ってから作成中の応答を読むので、2台から同時に送っても1つだけが通る（DD-05 3章）。
        return inWriteTransaction(db, (): QuestionPosted => {
          const writing = findWritingReply(db, conversationId);
          if (writing !== null) {
            return {
              kind: "reply_in_progress",
              reply: toPlainMessage(writing),
            };
          }
          const questionId = insertOwnerMessage(db, conversationId, text, at);
          const replyId = insertWritingReply(
            db,
            conversationId,
            questionId,
            at,
          );
          updateLastSpokenAt(db, conversationId, at);
          enqueueAnswer(db, replyId, now);
          return {
            kind: "accepted",
            question: {
              messageId: questionId,
              conversationId,
              speaker: "owner",
              bodyMd: text,
              sentAt: at,
              replyState: null,
              replyToMessageId: null,
              notice: null,
            },
            reply: {
              messageId: replyId,
              conversationId,
              speaker: "ai",
              bodyMd: "",
              sentAt: at,
              replyState: "writing",
              replyToMessageId: questionId,
              notice: null,
            },
          };
        });
      } catch (error) {
        throw toDbError(error);
      }
    },
    readReply(messageId) {
      try {
        const row = findMessageRow(db, messageId);
        if (row === null || row.speaker !== "ai" || row.replyState === null) {
          throw new NexusError("NOT_FOUND", "AI の発言が無い");
        }
        return {
          messageId: row.messageId,
          bodyMd: row.bodyMd,
          replyState: row.replyState,
          runId: row.latestAiRunId ?? 0,
          notice: noticeOf(row),
        };
      } catch (error) {
        throw toDbError(error);
      }
    },
    retryReply(messageId) {
      // 手順 2: failed か cancelled のときだけ、本文を空に、writing にし、`attempt` 1 を待ちに入れる。
      // 2台から続けて押したら、先の1回だけが通る（条件付きの更新。DD-05 3章 ENT-008）。
      return changeReply(messageId, (now) => {
        if (restartReply(db, messageId) === 1)
          enqueueAnswer(db, messageId, now);
      });
    },
    stopReply(messageId) {
      // 手順 3: writing のときだけ、一番新しい実行を見る。待ちなら実行と発言を cancelled に、
      // 処理中なら `stop_requested` を 1 にする（M24 が止め、実行と発言を cancelled にする）。
      return changeReply(messageId, (now) => {
        if (findMessageRow(db, messageId)?.replyState !== "writing") return;
        const run = findLatestAnswerRun(db, messageId);
        if (run === null) return;
        if (run.state === "queued") {
          if (cancelQueuedRun(db, run.aiRunId, now)) {
            markReplyCancelled(db, messageId);
          }
        } else if (run.state === "running") {
          requestStop(db, run.aiRunId);
        }
      });
    },
    dismissReply(messageId) {
      // 手順 4: failed のときだけ cancelled にする。`ai_run` は変えない（ホームの失敗の知らせは残す。Q-078 の答え）。
      return changeReply(messageId, () => {
        dismissFailedReply(db, messageId);
      });
    },
  };
}
