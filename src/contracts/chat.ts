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
