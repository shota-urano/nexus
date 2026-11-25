import { z } from "zod";

// 共有の型層 M10（DD-01 1.1、ADR-019）。英語の教材の完了 `putEnglishAnswer` の求めの形
// （`docs/api/openapi.yaml` の `Grade` と、求めの本文。DD-04）。

// 答えの上限（BD-07 4.1。DD-02 2章 C03）。文字は Unicode の符号位置で数える。
export const ENGLISH_ANSWER_MAX_LENGTH = 500;
// 1回の完了で送る ○△× の件数の上限（問題の数の上限と同じ。BD-06 IF-002 3.2）。
export const ENGLISH_GRADES_MAX = 60;

export const gradeSchema = z
  .object({
    no: z.number().int().min(1),
    // ○（o）、△（d）、×（x）。
    grade: z.enum(["o", "d", "x"]),
    answer: z
      .string()
      .refine((value) => [...value].length <= ENGLISH_ANSWER_MAX_LENGTH)
      .optional(),
  })
  .strict();

export const putEnglishAnswerBodySchema = z
  .object({
    grades: z.array(gradeSchema).min(1).max(ENGLISH_GRADES_MAX),
  })
  .strict();

export type Grade = z.infer<typeof gradeSchema>;
export type PutEnglishAnswerBody = z.infer<typeof putEnglishAnswerBodySchema>;
