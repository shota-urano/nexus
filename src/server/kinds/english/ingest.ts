import { z } from "zod";
import type { Database } from "../../db/connection";
import {
  type EnglishSetValues,
  findEnglishContentIdByDate,
  insertEnglishSetRow,
  updateEnglishSetRow,
} from "../../repositories/english";
import { daysBetween } from "../../shared/datetime";

// 英語のセットの受け取りの形の確かめと、セットを残す処理（DD-01 M16。DD-02 FN-007 手順 2、4）。
// 形は `openapi.yaml` の `EnglishSetPayload`、`ProblemPayload`、`Reading` と、BD-06 IF-002 3.2、
// BD-02 FN-007 の確かめによる（ADR-019 で zod を使う）。1つでも外れたら、セットの全体を断る。
// M14 の種類の一覧を読み込まず、同じ形の操作を公開する（DD-01 M14。輪を作らないため）。

export const ENGLISH_KIND = "english";

// 上限の値（BD-06 IF-002 3.2）。ここの1か所に置く（DD-01 3章 zod）。
export const ENGLISH_SET_MAX_BYTES = 256 * 1024;
export const ENGLISH_SET_MAX_PROBLEMS = 60;
export const ENGLISH_CHOICES_MIN = 2;
export const ENGLISH_CHOICES_MAX = 6;
export const ENGLISH_LANE = "en";

const DATE_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

// 十進の数（前後の空白を除いて読む。DD-02 FN-011 の `number` の比べ方と同じ読み方）。
const DECIMAL_PATTERN = /^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)$/;

// 日付は `YYYY-MM-DD` の実在する日付か `today`。
const targetDate = z.union([
  z.literal("today"),
  z
    .string()
    .regex(DATE_PATTERN)
    .refine((date) => daysBetween(date, date) === 0),
]);

const nonEmpty = z.string().min(1);

const problemSchema = z
  .object({
    no: z.number().int().min(1),
    kind: z.enum(["quiz", "code"]).optional(),
    questionMd: nonEmpty,
    answerMd: nonEmpty,
    answerType: z.enum(["choice", "number", "text"]).nullable().optional(),
    expected: nonEmpty.nullable().optional(),
    choices: z.array(z.string()).nullable().optional(),
    workdir: z.string().nullable().optional(),
  })
  .superRefine((problem, ctx) => {
    const { answerType, expected, choices } = problem;
    const choicesGiven = choices !== undefined && choices !== null;
    // 答えの形があれば正解がある（BD-02 FN-007）。
    if (answerType != null && expected == null) {
      ctx.addIssue({ code: "custom", path: ["expected"], message: "" });
      return;
    }
    if (answerType === "choice") {
      // 選ぶ問題の選択肢は 2〜6件で、重ならず、正解を含む（BD-02 FN-007）。
      if (
        !choicesGiven ||
        choices.length < ENGLISH_CHOICES_MIN ||
        choices.length > ENGLISH_CHOICES_MAX ||
        new Set(choices).size !== choices.length ||
        !choices.includes(expected as string)
      ) {
        ctx.addIssue({ code: "custom", path: ["choices"], message: "" });
      }
      return;
    }
    // 選ぶ問題でなければ、選択肢は無いか null（BD-06 IF-002 3.2）。
    if (choicesGiven) {
      ctx.addIssue({ code: "custom", path: ["choices"], message: "" });
      return;
    }
    // 数の問題の正解は数として読める（BD-02 FN-007）。
    if (
      answerType === "number" &&
      !DECIMAL_PATTERN.test(String(expected).trim())
    ) {
      ctx.addIssue({ code: "custom", path: ["expected"], message: "" });
    }
  });

// 読む教材（`openapi.yaml` の `Reading`）。段落と文の形を確かめる（BD-02 FN-007）。
const readingSchema = z.object({
  date: z.string(),
  format: z.string(),
  title: z.string(),
  scene: z.string(),
  summary: z.string(),
  paragraphs: z.array(
    z.object({
      sentences: z.array(
        z.object({
          en: z.string(),
          ja: z.string(),
          notes: z.array(
            z.object({ text: z.string(), kind: z.string(), ja: z.string() }),
          ),
        }),
      ),
    }),
  ),
});

// 知らない項目は読み捨てる（DD-04 3.6）。
const setSchema = z
  .object({
    date: targetDate,
    lane: z.literal(ENGLISH_LANE),
    // 学習テーマは内容の見出しになるので、1行にする（DD-03 `content.title` の検査制約に合わせる）。
    theme: nonEmpty.refine((text) => !/[\n\r]/.test(text)),
    source: z.enum(["theme", "memo"]).optional(),
    lessonMd: nonEmpty,
    problems: z.array(problemSchema).min(1).max(ENGLISH_SET_MAX_PROBLEMS),
    closingMd: z.string().nullable().optional(),
    read: readingSchema.nullable().optional(),
  })
  .superRefine((set, ctx) => {
    // 問題番号が重ならない（BD-02 FN-007）。
    const seen = new Set<number>();
    set.problems.forEach((problem, index) => {
      if (seen.has(problem.no)) {
        ctx.addIssue({
          code: "custom",
          path: ["problems", index, "no"],
          message: "",
        });
      }
      seen.add(problem.no);
    });
  });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// 外れた項目の名前（MSG-033 に差し込む）。外れた場所の一番内側の項目の名前にする。
function failedField(error: z.ZodError): string {
  const path = error.issues[0]?.path ?? [];
  for (let i = path.length - 1; i >= 0; i -= 1) {
    const segment = path[i];
    if (typeof segment === "string") return segment;
  }
  return "本文";
}

// 形の正しいセットを、受け取りの共通の部分（M13）に渡す1件。
interface CheckedSet {
  payload: Record<string, unknown>;
  rawBody: string;
}

// 全体の形の確かめの結果（DD-02 FN-007 手順 2）。英語は全体を確かめ、セットを1件として返す。
// 断るときの `date` は、日付の項目だけを見て正しければその値（`today` のまま）、でなければ null。
export type EnglishBatchCheck =
  | { ok: true; date: string; items: CheckedSet[] }
  | { ok: false; msg: "MSG-033"; field: string; date: string | null };

export type EnglishItemCheck =
  | { ok: true; item: AcceptedEnglishSet }
  | { ok: false; label: string; field: string };

// 形の正しいセット。見出しと検索の本文と、種類ごとの中身を残す処理を持つ（DD-01 M14）。
export interface AcceptedEnglishSet {
  // 同じ日付で置き換える相手は日付だけで決まるので、空の文字。
  key: string;
  title: string;
  // 検索の本文（英語は教材の本文。DD-02 3章 P08）。
  searchBody: string;
  insertDetail(db: Database, contentId: number): void;
  updateDetail(db: Database, contentId: number): void;
}

// `rawBody` は届いた本文の文字（`raw_payload_json` にそのまま入れる。DD-02 FN-007 手順 4.3）。
export function checkEnglishSet(
  payload: unknown,
  rawBody?: string,
): EnglishBatchCheck {
  const knownDate = isRecord(payload)
    ? (() => {
        const parsed = targetDate.safeParse(payload.date);
        return parsed.success ? parsed.data : null;
      })()
    : null;
  if (!isRecord(payload)) {
    return { ok: false, msg: "MSG-033", field: "本文", date: knownDate };
  }
  // `lane` が `en` でないか無いときは、項目「lane」（DD-02 FN-007 手順 2）。
  if (payload.lane !== ENGLISH_LANE) {
    return { ok: false, msg: "MSG-033", field: "lane", date: knownDate };
  }
  const parsed = setSchema.safeParse(payload);
  if (!parsed.success) {
    return {
      ok: false,
      msg: "MSG-033",
      field: failedField(parsed.error),
      date: knownDate,
    };
  }
  return {
    ok: true,
    date: parsed.data.date,
    items: [{ payload, rawBody: rawBody ?? JSON.stringify(payload) }],
  };
}

// 手順 4.2、4.3 で残す値を、届いた本文から作る。問題は `kind` の無いものに `quiz` を補う
// （BD-06 IF-002 3.2。原文は補わない。RV16-04）。
function valuesOf(set: CheckedSet): EnglishSetValues {
  const { payload } = set;
  const problems = (payload.problems as Record<string, unknown>[]).map(
    (problem) => ({ ...problem, kind: problem.kind ?? "quiz" }),
  );
  const read = payload.read;
  const closing = payload.closingMd;
  return {
    learningTheme: payload.theme as string,
    lessonBodyMd: payload.lessonMd as string,
    closingMd: typeof closing === "string" ? closing : null,
    problemsJson: JSON.stringify(problems),
    readingJson:
      read === undefined || read === null ? null : JSON.stringify(read),
    rawPayloadJson: set.rawBody,
  };
}

export function checkEnglishItem(raw: unknown): EnglishItemCheck {
  const set = raw as CheckedSet;
  const values = valuesOf(set);
  return {
    ok: true,
    item: {
      key: "",
      title: values.learningTheme,
      searchBody: values.lessonBodyMd,
      insertDetail: (db, contentId) =>
        insertEnglishSetRow(db, contentId, values),
      updateDetail: (db, contentId) =>
        updateEnglishSetRow(db, contentId, values),
    },
  };
}

// 種類の一覧（M14）に登録する、英語のセットの受け取りの操作。
export const englishIngest = {
  kind: ENGLISH_KIND,
  // 1回の送信は1セットなので、同じ送信の中の重なりは起きない。
  keyField: "date",
  // 記事の関係の判定はニュースだけ（DD-02 FN-007）。
  relatesAfterIngest: false,
  checkBatch: checkEnglishSet,
  checkItem: checkEnglishItem,
  // 同じ日付の英語の内容ID（DD-02 FN-007 手順 4.2）。
  findContentId: (db: Database, date: string) =>
    findEnglishContentIdByDate(db, date),
};
