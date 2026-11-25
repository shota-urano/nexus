import {
  completeRun,
  enqueueSummarize,
  type PickedRun,
} from "../../server/ai-jobs";
import type { Database } from "../../server/db/connection";
import {
  inReadTransaction,
  inWriteTransaction,
} from "../../server/db/transaction";
import { hasActiveSummarizeRun } from "../../server/repositories/ai-run";
import {
  type ReplyMessageRow,
  findAnswerConversation,
  listMessagesAfterNewestFirst,
  updateConversationSummary,
} from "../../server/repositories/conversation";
import type { Clock } from "../../server/shared/clock";
import { NexusError } from "../../server/shared/errors";
import type { Logger } from "../../server/shared/logger";
import type { AiProvider } from "../ai-provider";
import { ANSWER_HISTORY_MIN_MESSAGES, chars, historyText } from "./answer";
import type { ExecuteContext } from "./context";
import { readAiCall } from "./outcome";
import { type Material, buildAiInput } from "./prompt";

// 会話の要約（FN-015。DD-02 FN-015 会話の要約。Q-076、Q-085 の答え）の M25 の受け持ち。
// 手順 1: 質問の応答が完了したら、要約を待ちに入れるかを決める。
// 手順 2〜3: 前の要約と古い発言を渡して M26 で呼び（ツール無し）、成功なら会話の要約を置き換える。
// 手順 4: 失敗は自動で送り直さない（3章 P06 の失敗の扱い）。次の質問の応答の完了で手順 1 をもう一度行う。

export interface SummarizeDeps {
  db: Database;
  provider: AiProvider;
  clock: Clock;
  logger: Logger;
}

// 要約を待ちに入れる本文の合計の文字数（Q-085 の答え）。これを超えたら要約する。
export const SUMMARY_THRESHOLD_CHARS = 20_000;
// 要約せずに残す直近の発言の数（Q-085 の答え）。
export const SUMMARY_KEEP_RECENT_MESSAGES = ANSWER_HISTORY_MIN_MESSAGES;

// summarize の決まりの文（DD-02 3章 P07 手順 2）。
export const SUMMARIZE_RULES = [
  "あなたは本人と AI の会話を要約します。",
  "材料は、前の要約（kind が summary）と、まだ要約に含めていない発言（kind が history）です。前の要約は無いこともあります。",
  "前の要約と発言を、後の質問で使えるように日本語でまとめてください。",
  "答えは要約の文だけにしてください。",
];

// 要約に含めていない発言（新しい順）から、直近の 6 発言を除いたものを古い順で返す。
function olderMessages(
  newestFirst: readonly ReplyMessageRow[],
): ReplyMessageRow[] {
  return newestFirst.slice(SUMMARY_KEEP_RECENT_MESSAGES).reverse();
}

// 手順 1: 要約を待ちに入れるかを決める。待ちに入れたら実行ID を、入れなければ null を返す。
// 1つの書き込みのトランザクションで、数えて、同じ会話の summarize の待ちか処理中を確かめて、作る（DD-05 3章）。
export function enqueueSummarizeIfNeeded(
  db: Database,
  conversationId: number,
  at: Date,
): number | null {
  return inWriteTransaction(db, () => {
    const conversation = findAnswerConversation(db, conversationId);
    if (conversation === null) return null;
    const older = olderMessages(
      listMessagesAfterNewestFirst(
        db,
        conversationId,
        conversation.summaryLastMessageId,
      ),
    );
    const total = older.reduce(
      (sum, message) => sum + chars(message.bodyMd),
      0,
    );
    if (total <= SUMMARY_THRESHOLD_CHARS) return null;
    if (hasActiveSummarizeRun(db, conversationId)) return null;
    return enqueueSummarize(db, conversationId, at);
  });
}

export interface SummarizeInput {
  input: string;
  // 渡した最後の発言。
  lastMessageId: number;
}

// 手順 2: 前の要約（あれば）と、要約に含めていない発言のうち直近の 6 発言を除いたものを渡す（3章 P07）。
export function buildSummarizeInput(
  db: Database,
  conversationId: number,
): SummarizeInput {
  const { materials, lastMessageId } = inReadTransaction(db, () => {
    const conversation = findAnswerConversation(db, conversationId);
    if (conversation === null) {
      throw new NexusError("INTERNAL", "要約する会話が無い");
    }
    const older = olderMessages(
      listMessagesAfterNewestFirst(
        db,
        conversationId,
        conversation.summaryLastMessageId,
      ),
    );
    const last = older.at(-1);
    if (last === undefined) {
      throw new NexusError("INTERNAL", "要約する発言が無い");
    }
    const list: Material[] = [];
    if (conversation.summaryMd !== null) {
      list.push({ kind: "summary", body: conversation.summaryMd });
    }
    list.push({ kind: "history", body: historyText(older) });
    return { materials: list, lastMessageId: last.messageId };
  });
  return { input: buildAiInput(SUMMARIZE_RULES, materials), lastMessageId };
}

// 完了にできなかった（実行が running でなくなった）ときに、トランザクションを戻すための印。
class RunNotRunning extends Error {}

export async function runSummarize(
  deps: SummarizeDeps,
  run: PickedRun,
  context: ExecuteContext = {},
): Promise<void> {
  const { db, provider, clock, logger } = deps;
  const conversationId = run.summaryConversationId;
  if (conversationId === null) {
    throw new NexusError("INTERNAL", "要約する会話が無い");
  }
  const { input, lastMessageId } = buildSummarizeInput(db, conversationId);

  // ツール無し（引数と設定は M26。DD-09 2.5）。
  const call = provider.call({
    purpose: "summarize",
    input,
    signal: context.signal,
    runId: run.aiRunId,
  });
  // 失敗は DD-06 の分類（E09〜E12）で投げ、3章 P06 の失敗の扱いに渡す。応答の文の続きは書き足さない。
  const summary = await readAiCall(call, { signal: context.signal });

  // 手順 3: 1つのトランザクションで、会話の要約を置き換え、実行を完了にする。
  try {
    inWriteTransaction(db, () => {
      updateConversationSummary(db, conversationId, summary, lastMessageId);
      if (!completeRun(db, run.aiRunId, clock.now())) throw new RunNotRunning();
    });
  } catch (error) {
    if (!(error instanceof RunNotRunning)) throw error;
    // 先に別の状態へ進んだ（DD-05 3章 ENT-009）。要約は元のまま。
    logger.log({
      level: "warn",
      target: "FN-015",
      aiRunId: run.aiRunId,
      detail: "実行が処理中でなくなったので、会話の要約を置き換えなかった",
    });
  }
}
