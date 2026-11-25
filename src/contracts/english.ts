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

// 教材の一覧と教材の応答の形（`openapi.yaml` の `EnglishSetSummary`、`EnglishSetPage`、
// `Problem`、`Reading`、`EnglishSetDetail`、`EnglishAnswer`。DD-04 `listEnglishSets`、
// `getEnglishSet`）。画面（M04、M08）と通信層（M09）が使う。

const DATE_TIME_PATTERN =
  /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}\+09:00$/;
const DATE_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const dateTime = z.string().regex(DATE_TIME_PATTERN);
const contentId = z.number().int().min(1);

export const englishSetSummarySchema = z.object({
  contentId,
  learningTheme: z.string(),
  targetDate: z.string().regex(DATE_PATTERN),
  receivedAt: dateTime,
  isNew: z.boolean(),
  isRead: z.boolean(),
  isSaved: z.boolean(),
  isCompleted: z.boolean(),
});

export const englishSetPageSchema = z.object({
  items: z.array(englishSetSummarySchema),
  nextCursor: z.string().nullable(),
});

// 答えの形（BD-02 FN-011）。
export const ANSWER_TYPES = ["choice", "number", "text"] as const;
export type AnswerType = (typeof ANSWER_TYPES)[number];

// 問題。残した JSON をそのまま返すので、値の無い項目は null か省かれる（DD-02 FN-009 手順 3）。
export const problemSchema = z.object({
  no: z.number().int().min(1),
  // quiz（画面で答える）、code（手元で解く）。受け取りで quiz を補っている（DD-02 FN-007）。
  kind: z.enum(["quiz", "code"]),
  questionMd: z.string().min(1),
  answerMd: z.string().min(1),
  answerType: z.enum(ANSWER_TYPES).nullable().optional(),
  expected: z.string().min(1).nullable().optional(),
  choices: z.array(z.string()).nullable().optional(),
  workdir: z.string().nullable().optional(),
});

export const readingNoteSchema = z.object({
  text: z.string(),
  // 注の種類。sharpen の値をそのまま持つ（today、word、phrase、grammar など）。
  kind: z.string(),
  ja: z.string(),
});

export const readingSentenceSchema = z.object({
  en: z.string(),
  ja: z.string(),
  notes: z.array(readingNoteSchema),
});

export const readingSchema = z.object({
  date: z.string(),
  format: z.string(),
  title: z.string(),
  scene: z.string(),
  summary: z.string(),
  paragraphs: z.array(z.object({ sentences: z.array(readingSentenceSchema) })),
});

export const englishAnswerSchema = z.object({
  contentId,
  grades: z.array(gradeSchema),
  completedAt: dateTime,
});

export const englishContentStateSchema = z.object({
  contentId,
  isNew: z.boolean(),
  isRead: z.boolean(),
  isSaved: z.boolean(),
  savedAt: dateTime.nullable().optional(),
});

export const englishSetDetailSchema = z.object({
  contentId,
  learningTheme: z.string(),
  targetDate: z.string().regex(DATE_PATTERN),
  lessonMd: z.string(),
  problems: z.array(problemSchema),
  closingMd: z.string().nullable(),
  reading: readingSchema.nullable(),
  state: englishContentStateSchema,
  lastAnswer: englishAnswerSchema.nullable(),
});

export type EnglishSetSummary = z.infer<typeof englishSetSummarySchema>;
export type EnglishSetPage = z.infer<typeof englishSetPageSchema>;
export type Problem = z.infer<typeof problemSchema>;
export type ReadingNote = z.infer<typeof readingNoteSchema>;
export type ReadingSentence = z.infer<typeof readingSentenceSchema>;
export type Reading = z.infer<typeof readingSchema>;
export type EnglishAnswer = z.infer<typeof englishAnswerSchema>;
export type EnglishSetDetail = z.infer<typeof englishSetDetailSchema>;
