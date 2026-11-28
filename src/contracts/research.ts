import { z } from "zod";
import { contentStateSchema } from "./news";

// 共有の型層 M10（DD-01 1.1、ADR-019）。IF-005 の週報の本文の形 `ResearchReportPayload`
// （`docs/api/openapi.yaml` の `ResearchReportPayload`、`ApproachPayload`、`ResearchStatus`、
// `ApproachMark`。DD-04 `postResearchReport`。CR-020）。業務層の M33（受け取り）と、送信のコマンド
// M34 が同じ定義で確かめる（DD-01 M10）。上限の値は BD-06 IF-005 3.2 と Q-096 の答えで、ここの
// 1か所に置く（DD-01 3章 zod）。

const KIB = 1024;

// 全体の大きさ（UTF-8 のバイト数。BD-06 IF-005 3.2、Q-088 の答え）。
export const RESEARCH_REPORT_MAX_BYTES = 256 * KIB;
// 方法の件数の上限は持たない（CR-024 で外した。Q-099 の答え）。全体の大きさだけで止める。
// 欄ごとの上限（Q-096 の答え）。文字の数は文字で、大きさは UTF-8 のバイト数で数える。
export const RESEARCH_TOPIC_ID_MAX_CHARS = 64;
export const RESEARCH_TITLE_MAX_CHARS = 200;
export const RESEARCH_ANSWER_MAX_BYTES = 4 * KIB;
export const RESEARCH_HOW_TO_MAX_BYTES = 8 * KIB;
export const RESEARCH_COUNTER_MAX_BYTES = 2 * KIB;
export const RESEARCH_UNKNOWNS_MAX_BYTES = 8 * KIB;
export const RESEARCH_CHANGES_MAX_BYTES = 8 * KIB;
export const RESEARCH_SOURCE_URLS_MAX = 50;
export const RESEARCH_URL_MAX_CHARS = 2048;
export const RESEARCH_SOURCE = "brain-research";
// 段の欄の上限（BD-06 IF-005 3.2。Q-098、Q-100 の答え。CR-024）。
export const RESEARCH_STEPS_MAX = 30;
export const RESEARCH_STEP_CHANGES_MAX_BYTES = 4 * KIB;

// 課題の状態と方法の印（BD-07 4.2）。
export const RESEARCH_STATUSES = ["active", "ended"] as const;
export const APPROACH_MARKS = ["added", "more_sources", "disputed"] as const;
// 段の状態（BD-07 4.2。CR-024）。`current`（今ここ）は1つの週報に1つまで。
export const RESEARCH_STEP_STATUSES = [
  "done",
  "doing",
  "current",
  "todo",
] as const;
export type ResearchStatus = (typeof RESEARCH_STATUSES)[number];
export type ApproachMark = (typeof APPROACH_MARKS)[number];
export type ResearchStepStatus = (typeof RESEARCH_STEP_STATUSES)[number];

const DATE_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

const charCount = (text: string) => [...text].length;
const byteCount = (text: string) => new TextEncoder().encode(text).length;

// 実在する日付（`YYYY-MM-DD`。日本時間の日付として読む）。
export const isRealDate = (text: string): boolean => {
  if (!DATE_PATTERN.test(text)) return false;
  const [y, m, d] = text.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  );
};

// 1行（改行と復帰を含まない）で、1文字以上 max 文字まで。
const singleLine = (max: number) =>
  z
    .string()
    .min(1)
    .refine((text) => charCount(text) <= max)
    .refine((text) => !/[\n\r]/.test(text));

const textWithin = (maxBytes: number) =>
  z.string().refine((text) => byteCount(text) <= maxBytes);

const unique = (values: readonly unknown[]) =>
  new Set(values).size === values.length;

// 段と方法の番号（1以上の整数。CR-024）。
const number = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);

const url = z
  .string()
  .max(RESEARCH_URL_MAX_CHARS)
  .regex(/^https?:\/\//);

export const approachPayloadSchema = z
  .object({
    title: singleLine(RESEARCH_TITLE_MAX_CHARS),
    howToMd: textWithin(RESEARCH_HOW_TO_MAX_BYTES).refine(
      (text) => text.length > 0,
    ),
    // 出典の URL は重ならない（DD-02 FN-025 手順 5）。
    sourceUrls: z.array(url).max(RESEARCH_SOURCE_URLS_MAX).refine(unique),
    // 印は重ならない（DD-02 FN-025 手順 5）。
    marks: z.array(z.enum(APPROACH_MARKS)).max(3).refine(unique),
    counterMd: textWithin(RESEARCH_COUNTER_MAX_BYTES).nullable().optional(),
    // 課題の中の方法の通し番号と、ぶら下がる段の番号（任意。CR-024）。
    no: number.nullable().optional(),
    step: number.nullable().optional(),
  })
  .strict();

// 段1件（BD-06 IF-005 3.2。CR-024）。
export const stepPayloadSchema = z
  .object({
    no: number,
    title: singleLine(RESEARCH_TITLE_MAX_CHARS),
    status: z.enum(RESEARCH_STEP_STATUSES),
  })
  .strict();

// 全体の形（方法は数だけを後で確かめ、1件ごとの形は `approachPayloadSchema` で確かめる）。
const reportShapeSchema = z
  .object({
    source: z.literal(RESEARCH_SOURCE),
    topicId: z
      .string()
      .regex(new RegExp(`^[a-z0-9-]{1,${RESEARCH_TOPIC_ID_MAX_CHARS}}$`)),
    topicTitle: singleLine(RESEARCH_TITLE_MAX_CHARS),
    week: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    sentOn: z.string().refine(isRealDate),
    status: z.enum(RESEARCH_STATUSES),
    answerMd: textWithin(RESEARCH_ANSWER_MAX_BYTES).refine(
      (text) => text.length > 0,
    ),
    approaches: z.array(z.unknown()),
    unknownsMd: textWithin(RESEARCH_UNKNOWNS_MAX_BYTES),
    changesMd: textWithin(RESEARCH_CHANGES_MAX_BYTES).refine(
      (text) => text.length > 0,
    ),
    // 段の欄（任意。無ければ省くか null。CR-024）。段は数だけを先に確かめ、1件ごとの形は
    // `stepPayloadSchema` で確かめる。
    steps: z.array(z.unknown()).max(RESEARCH_STEPS_MAX).nullable().optional(),
    stepChangesMd: textWithin(RESEARCH_STEP_CHANGES_MAX_BYTES)
      .nullable()
      .optional(),
  })
  .strict();

export type ApproachPayload = z.infer<typeof approachPayloadSchema>;
export type StepPayload = z.infer<typeof stepPayloadSchema>;
export type ResearchReportPayload = Omit<
  z.infer<typeof reportShapeSchema>,
  "approaches" | "steps"
> & { approaches: ApproachPayload[]; steps?: StepPayload[] | null };

// 形の確かめの結果。外れたときは MSG-033 と外れた項目の名前。
// 方法の項目は `approaches[何番目].項目`、段の項目は `steps[何番目].項目`（1から数える。
// DD-02 FN-025 手順 4、5、BD-09 MSG-049）。
// MSG-034 は全体の大きさの超えで、呼ぶ側が本文のバイト数で確かめる（方法の件数の上限は CR-024 で外した）。
export type ResearchReportCheck =
  | { ok: true; value: ResearchReportPayload }
  | { ok: false; msg: "MSG-033"; field: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// 外れた項目の名前。知らない項目はその名前、ほかは外れた場所の一番外側の項目の名前にする。
function failedField(error: z.ZodError): string {
  const issue = error.issues[0];
  if (issue === undefined) return "本文";
  if (issue.code === "unrecognized_keys" && issue.path.length === 0) {
    return issue.keys[0] ?? "本文";
  }
  const head = issue.path[0];
  return typeof head === "string" ? head : "本文";
}

// IF-005 の本文の形を確かめる（DD-02 2章 C10 の「全体の形と各欄の上限 → 方法ごとの形 →
// 段の欄のつながり」）。最初の外れで止める。全体の大きさ（256 KiB）は呼ぶ側が本文のバイト数で確かめる。
export function checkResearchReportPayload(
  payload: unknown,
): ResearchReportCheck {
  if (!isRecord(payload)) return { ok: false, msg: "MSG-033", field: "本文" };
  const shape = reportShapeSchema.safeParse(payload);
  if (!shape.success) {
    return { ok: false, msg: "MSG-033", field: failedField(shape.error) };
  }
  const steps: StepPayload[] = [];
  for (const [index, raw] of (shape.data.steps ?? []).entries()) {
    const at = `steps[${index + 1}]`;
    if (!isRecord(raw)) return { ok: false, msg: "MSG-033", field: at };
    const step = stepPayloadSchema.safeParse(raw);
    if (!step.success) {
      return {
        ok: false,
        msg: "MSG-033",
        field: `${at}.${failedField(step.error)}`,
      };
    }
    steps.push(step.data);
  }
  const approaches = shape.data.approaches;
  const checked: ApproachPayload[] = [];
  for (const [index, raw] of approaches.entries()) {
    const at = `approaches[${index + 1}]`;
    if (!isRecord(raw)) return { ok: false, msg: "MSG-033", field: at };
    const approach = approachPayloadSchema.safeParse(raw);
    if (!approach.success) {
      return {
        ok: false,
        msg: "MSG-033",
        field: `${at}.${failedField(approach.error)}`,
      };
    }
    checked.push(approach.data);
  }
  const linked = checkRoadmapLinks(
    shape.data.steps == null ? null : steps,
    checked,
  );
  if (linked !== null) return { ok: false, msg: "MSG-033", field: linked };
  const { steps: rawSteps, ...rest } = shape.data;
  const value: ResearchReportPayload = { ...rest, approaches: checked };
  if (rawSteps === null) value.steps = null;
  else if (rawSteps !== undefined) value.steps = steps;
  return { ok: true, value };
}

// 段の欄のつながり（DD-02 FN-025 手順 5。CR-024）。外れた項目の名前を返し、外れが無ければ null。
// 段の番号と方法の番号は重ならない（後に出た方を外れにする）。今ここは1つまで。方法の段は段の一覧にある
// （段の一覧が無いのに段を書いた方法も外れ）。
function checkRoadmapLinks(
  steps: StepPayload[] | null,
  approaches: ApproachPayload[],
): string | null {
  const stepNos = new Set<number>();
  for (const [index, step] of (steps ?? []).entries()) {
    if (stepNos.has(step.no)) return `steps[${index + 1}].no`;
    stepNos.add(step.no);
  }
  const current = (steps ?? []).filter((s) => s.status === "current");
  if (current.length > 1) return "steps";
  const approachNos = new Set<number>();
  for (const [index, approach] of approaches.entries()) {
    const at = `approaches[${index + 1}]`;
    if (approach.no != null) {
      if (approachNos.has(approach.no)) return `${at}.no`;
      approachNos.add(approach.no);
    }
    if (approach.step != null && !stepNos.has(approach.step)) {
      return `${at}.step`;
    }
  }
  return null;
}

// 課題の一覧の応答の形（`docs/api/openapi.yaml` の `ResearchTopicList`、`ResearchTopicSummary`。
// DD-04 `listResearchTopics`、DD-02 FN-026）。画面層の M32 が応答を確かめるのに使う。
export const researchTopicSummarySchema = z.object({
  topicId: z.string(),
  title: z.string(),
  status: z.enum(RESEARCH_STATUSES),
  lastWeek: z.number().int().min(1),
  lastReceivedAt: z.string(),
  latestContentId: z.number().int().min(1),
  hasUnread: z.boolean(),
});

export const researchTopicListSchema = z.object({
  topics: z.array(researchTopicSummarySchema),
});

export type ResearchTopicSummaryView = z.infer<
  typeof researchTopicSummarySchema
>;
export type ResearchTopicListView = z.infer<typeof researchTopicListSchema>;

// 週報の応答の形（`docs/api/openapi.yaml` の `ResearchReportDetail`、`Approach`。DD-04
// `getResearchReport`、DD-02 FN-027）。画面層の M32 が応答を確かめるのに使う。
// 出典の URL は、http と https のものだけを画面でリンクにする（BD-03 SCR-011-A08）。
export const approachSchema = z.object({
  title: z.string(),
  howToMd: z.string(),
  sourceUrls: z.array(z.string()),
  sourceCount: z.number().int().min(0),
  marks: z.array(z.enum(APPROACH_MARKS)),
  counterMd: z.string().nullable(),
});

export const researchWeekSchema = z.object({
  contentId: z.number().int().min(1),
  week: z.number().int().min(1),
  sentOn: z.string(),
  isRead: z.boolean(),
});

export const researchReportDetailSchema = z.object({
  contentId: z.number().int().min(1),
  topicId: z.string(),
  topicTitle: z.string(),
  week: z.number().int().min(1),
  sentOn: z.string(),
  status: z.enum(RESEARCH_STATUSES),
  answerMd: z.string(),
  approaches: z.array(approachSchema),
  unknownsMd: z.string(),
  changesMd: z.string(),
  receivedAt: z.string(),
  state: contentStateSchema,
  weeks: z.array(researchWeekSchema),
});

export type ApproachView = z.infer<typeof approachSchema>;
export type ResearchWeekView = z.infer<typeof researchWeekSchema>;
export type ResearchReportDetailView = z.infer<
  typeof researchReportDetailSchema
>;
