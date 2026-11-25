import { completeRun, type PickedRun } from "../../server/ai-jobs";
import type { Database } from "../../server/db/connection";
import { inWriteTransaction } from "../../server/db/transaction";
import {
  type RelateArticle,
  type RelateSelection,
  type ReturnedRelation,
  checkRelations,
  saveRelations,
  selectRelateArticles,
} from "../../server/kinds/news/relate";
import type { Clock } from "../../server/shared/clock";
import { formatDateTime } from "../../server/shared/datetime";
import { NexusError } from "../../server/shared/errors";
import type { Logger } from "../../server/shared/logger";
import type { AiProvider } from "../ai-provider";
import { buildAiInput } from "./prompt";

// 記事の関係の判定（FN-002。DD-02 FN-002 手順 1〜7）の M25 の受け持ち。
// 渡す記事を M15 で選び、渡す内容を組み立てて M26 で呼び（ツール無し）、
// 返った JSON を読み、M15 で確かめて、1つのトランザクションで残して実行を完了にする。

export interface RelateDeps {
  db: Database;
  provider: AiProvider;
  clock: Clock;
  logger: Logger;
}

// relate の決まりの文（DD-02 3章 P07 手順 2）。
export const RELATE_RULES = [
  "あなたはニュースの記事どうしの関係を判定します。",
  "材料は、今回の記事（kind が current-articles）と、照らす記事（kind が other-articles）です。記事は1行に1つの JSON で、id が内容ID です。",
  "関係のある記事の組だけを選んでください。組の片方は必ず今回の記事にし、もう片方は今回のほかの記事か照らす記事にしてください。",
  "関係の種類（type）は follow_up（続報）、background（背景）、same_actor（共通の主体）、related_topic（関連する話題）から選んでください。",
  "根拠（reason）には、関係があると判断した理由を日本語で短く書いてください。因果を事実として書かないでください。",
  '答えは {"relations": [{"from": 内容ID, "to": 内容ID, "type": "関係の種類", "reason": "根拠"}]} の形の JSON だけで返してください。JSON のほかに文を付けないでください。',
  '関係のある組が無ければ {"relations": []} を返してください。',
];

function articleLines(articles: readonly RelateArticle[]): string {
  return articles
    .map((article) =>
      JSON.stringify({
        id: article.contentId,
        title: article.title,
        theme: article.theme,
        guide: article.guide,
      }),
    )
    .join("\n");
}

// 渡す内容（DD-02 3章 P07。読む材料は FN-002 の手順 3）。
export function buildRelateInput(selection: RelateSelection): string {
  return buildAiInput(RELATE_RULES, [
    { kind: "current-articles", body: articleLines(selection.current) },
    { kind: "other-articles", body: articleLines(selection.others) },
  ]);
}

// `result` の文を JSON として読む（DD-02 FN-002 手順 5）。形が違えば E10（AI_BAD_OUTPUT）。
export function parseRelateResult(text: string): ReturnedRelation[] {
  const bad = () =>
    new NexusError("AI_BAD_OUTPUT", "記事の関係の一覧の形が正しくない");
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw bad();
  }
  if (!isObject(value) || !Array.isArray(value.relations)) throw bad();
  return value.relations.map((item: unknown) => {
    if (
      !isObject(item) ||
      !Number.isSafeInteger(item.from) ||
      !Number.isSafeInteger(item.to) ||
      typeof item.type !== "string" ||
      typeof item.reason !== "string" ||
      item.reason.trim() === ""
    ) {
      throw bad();
    }
    return {
      from: item.from as number,
      to: item.to as number,
      type: item.type,
      reason: item.reason,
    };
  });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// 完了にできなかった（実行が running でなくなった）ときに、トランザクションを戻すための印。
class RunNotRunning extends Error {}

export async function runRelate(
  deps: RelateDeps,
  run: PickedRun,
): Promise<void> {
  const { db, provider, clock, logger } = deps;
  if (run.relateDeliveryId === null) {
    throw new NexusError("INTERNAL", "判定する受け取りの記録が無い");
  }
  const selection = selectRelateArticles(db, run.relateDeliveryId, logger, {
    aiRunId: run.aiRunId,
  });
  const input = buildRelateInput(selection);

  const call = provider.call({
    purpose: "relate",
    input,
    runId: run.aiRunId,
  });
  let resultText: string | null = null;
  let resultOk = false;
  for await (const event of call.events) {
    if (event.type === "result") {
      resultOk = event.ok;
      resultText = event.result;
    }
  }
  const exit = await call.exit;
  if (
    exit.kind !== "exited" ||
    exit.exitCode !== 0 ||
    !resultOk ||
    resultText === null
  ) {
    // 失敗の分け方（DD-04 4.2、DD-06 E09〜E12）は、失敗の扱いの実装単位で細かくする。
    throw new NexusError(
      "AI_INTERRUPTED",
      "CLI が完了の終わりの出来事を出さずに終わった",
    );
  }

  const relations = checkRelations(selection, parseRelateResult(resultText));
  try {
    inWriteTransaction(db, () => {
      const now = clock.now();
      saveRelations(db, selection, relations, formatDateTime(now));
      if (!completeRun(db, run.aiRunId, now)) throw new RunNotRunning();
    });
  } catch (error) {
    if (!(error instanceof RunNotRunning)) throw error;
    // 先に別の状態へ進んだ（DD-05 3章 ENT-009）。結果は残さず、何もしない。
    logger.log({
      level: "warn",
      target: "FN-002",
      aiRunId: run.aiRunId,
      detail: "実行が処理中でなくなったので、判定の結果を残さなかった",
    });
  }
}
