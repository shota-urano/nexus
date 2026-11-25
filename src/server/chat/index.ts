import type { Database } from "../db/connection";
import { toDbError } from "../db/errors";
import {
  type ConversationRow,
  type MessageRow,
  contentExists,
  findConversation,
  insertConversation,
  listConversationRows,
  listMessageRows,
} from "../repositories/conversation";
import type { Clock } from "../shared/clock";
import { formatDateTime } from "../shared/datetime";
import { NexusError } from "../shared/errors";
import { type Page, type PageQuery, toPage } from "../shared/paging";

// 会話（DD-01 M18）のうち、会話の選択（DD-02 FN-014）。
//   listConversations  対象の内容ごとの前の会話（無ければ対象の無い会話）を、最後に話した日時の新しい順に
//                      3章 P03 で返す。
//   createConversation 対象の形を確かめ（2章 C07）、内容が無ければ対象を捨てて MSG-011 を添え、会話を作る。
//   getConversation    会話と発言を `message_id` の順に返し、AI の発言ごとに知らせを決める。
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
  };
}
