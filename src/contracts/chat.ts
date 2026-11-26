import { z } from "zod";

// 共有の型層 M10（DD-01 1.1、ADR-019）。会話の API の求めの形
// （`docs/api/openapi.yaml` の `QuestionTarget` と `createConversation` の本文。DD-04）。
// `kind` が `phrase` のときに語句、文、位置があることは、業務層 M18 が確かめる
// （DD-02 2章 C07、FN-014 手順 3）。

export const questionTargetSchema = z
  .object({
    kind: z.enum(["page", "article", "phrase", "node"]),
    // `openapi.yaml` の `Id`（1 以上の整数）。
    contentId: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    phrase: z.string().max(200).optional(),
    sentence: z.string().max(2000).optional(),
    position: z
      .object({
        part: z.enum(["reading", "lesson", "problem"]).optional(),
        paragraphIndex: z.number().int().min(0).optional(),
        sentenceIndex: z.number().int().min(0).optional(),
        problemNo: z.number().int().min(1).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const createConversationBodySchema = z
  .object({
    target: questionTargetSchema.optional(),
  })
  .strict();

export type QuestionTarget = z.infer<typeof questionTargetSchema>;
export type CreateConversationBody = z.infer<
  typeof createConversationBodySchema
>;

// 質問の文の長さ（DD-02 2章 C05。Q-079 の答え）。文字（コードポイント）で数える。
export const QUESTION_MAX_CHARS = 4000;

function countChars(text: string): number {
  return [...text].length;
}

// `postQuestion` の本文（`openapi.yaml`）。`text` は 1〜4,000 文字。
export const postQuestionBodySchema = z
  .object({
    text: z
      .string()
      .refine(
        (text) =>
          countChars(text) >= 1 && countChars(text) <= QUESTION_MAX_CHARS,
      ),
  })
  .strict();

export type PostQuestionBody = z.infer<typeof postQuestionBodySchema>;

// 会話の API の応答の形（`openapi.yaml` の `Conversation`、`ConversationPage`、`ConversationCreated`、
// `Message`、`ConversationDetail`、`ReplyInProgress`。DD-04）。画面の通信層 M09 が確かめる。

const DATE_TIME_PATTERN =
  /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}\+09:00$/;
const dateTime = z.string().regex(DATE_TIME_PATTERN);
const id = z.number().int().min(1);

export const conversationSchema = z.object({
  conversationId: id,
  target: questionTargetSchema.nullable(),
  targetTitle: z.string().nullable().optional(),
  firstQuestionText: z.string().nullable().optional(),
  startedAt: dateTime,
  lastSpokenAt: dateTime,
});

export const conversationPageSchema = z.object({
  items: z.array(conversationSchema),
  nextCursor: z.string().nullable(),
});

export const conversationCreatedSchema = z.object({
  conversation: conversationSchema,
  notice: z.literal("MSG-011").nullable(),
});

export const replyStateSchema = z.enum([
  "writing",
  "done",
  "failed",
  "cancelled",
]);

export const messageNoticeSchema = z.enum(["MSG-012", "MSG-013", "MSG-014"]);

export const messageSchema = z.object({
  messageId: id,
  conversationId: id,
  speaker: z.enum(["owner", "ai"]),
  bodyMd: z.string(),
  sentAt: dateTime,
  replyState: replyStateSchema.nullable(),
  replyToMessageId: id.nullable(),
  notice: messageNoticeSchema.nullable().optional(),
});

export const conversationDetailSchema = z.object({
  conversation: conversationSchema,
  messages: z.array(messageSchema),
});

// `postQuestion` の 202。
export const questionAcceptedSchema = z.object({
  question: messageSchema,
  reply: messageSchema,
});

// `postQuestion` の 409（`ReplyInProgress`）。
export const replyInProgressSchema = z.object({
  reply: messageSchema,
});

// `streamReply` の出来事の `data`（DD-04 3.5）。
export const replyDeltaSchema = z.object({ text: z.string() });
export const replyStateEventSchema = z.object({
  replyState: replyStateSchema,
  messageId: id,
  notice: messageNoticeSchema.nullable(),
});

export type Conversation = z.infer<typeof conversationSchema>;
export type ConversationPage = z.infer<typeof conversationPageSchema>;
export type ConversationCreated = z.infer<typeof conversationCreatedSchema>;
export type ReplyState = z.infer<typeof replyStateSchema>;
export type MessageNotice = z.infer<typeof messageNoticeSchema>;
export type ChatMessage = z.infer<typeof messageSchema>;
export type ConversationDetail = z.infer<typeof conversationDetailSchema>;
export type ReplyStateEvent = z.infer<typeof replyStateEventSchema>;
