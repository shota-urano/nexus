import { completeRun, type PickedRun } from "../../server/ai-jobs";
import type { Database } from "../../server/db/connection";
import {
  inReadTransaction,
  inWriteTransaction,
} from "../../server/db/transaction";
import { type ChatTarget, kindChat } from "../../server/kinds";
import {
  addToolCounts,
  type ToolCounts,
} from "../../server/repositories/ai-run";
import {
  type ReplyMessageRow,
  appendReplyBody,
  findAnswerConversation,
  findMessage,
  listMessagesBetweenNewestFirst,
  markReplyDone,
  setAiInputCopy,
} from "../../server/repositories/conversation";
import type { Clock } from "../../server/shared/clock";
import { NexusError } from "../../server/shared/errors";
import type { Logger } from "../../server/shared/logger";
import type { AiEvent, AiProvider } from "../ai-provider";
import type { ExecuteContext } from "./context";
import { readAiCall } from "./outcome";
import { type Material, buildAiInput } from "./prompt";

// 質問の応答（FN-015。DD-02 FN-015 応答の手順 2〜5）の M25 の受け持ち。
// 3章 P07 で渡す内容を組み立てて写しを AI の発言に残し、M26 で呼び（WebSearch、WebFetch、Read、Glob、Grep）、
// 文の続きを手元にためて 100 ミリ秒ごとに本文へ書き足し、ツールを使った回数を数え、
// 成功の終わりの出来事で、1つのトランザクションで残りを書き足して AI の発言と実行を完了にする。

export interface AnswerDeps {
  db: Database;
  provider: AiProvider;
  clock: Clock;
  logger: Logger;
  // 書き足しの間隔。既定は 100 ミリ秒（DD-02 FN-015 応答の手順 4）。
  flushIntervalMs?: number;
}

// 書き足しの間隔（DD-02 FN-015 応答の手順 4）。
export const ANSWER_FLUSH_INTERVAL_MS = 100;
// 要約に含めていない発言を足す本文の合計の文字数（Q-085 の答え。DD-02 3章 P07 手順 3）。
export const ANSWER_HISTORY_CHARS = 20_000;
// 必ず入れる直近の発言の数（Q-085 の答え）。
export const ANSWER_HISTORY_MIN_MESSAGES = 6;

// answer の決まりの文（DD-02 3章 P07 手順 2）。
export const ANSWER_RULES = [
  "あなたは本人の質問に答えます。",
  "材料は、対象の内容（kind が target）、会話の要約（kind が summary）、前の発言（kind が history）、今の質問（kind が question）です。無い材料もあります。",
  "まず材料で答えてください。材料で分からないときだけ、ウェブの検索（WebSearch）、ページの読み取り（WebFetch）、~/projects/brain-harness の読み取り（Read、Glob、Grep）のどれを使うかを決めて使ってください。",
  "日本語で答えてください。",
];

// ツールの名前ごとに足す回数の列（DD-04 4.2 ツールを使った出来事。ENT-009）。
const TOOL_COLUMNS: Readonly<Record<string, keyof ToolCounts>> = {
  WebSearch: "webSearch",
  WebFetch: "webFetch",
  Read: "folderRead",
  Glob: "folderRead",
  Grep: "folderRead",
};

// 文字数は、UTF-16 の単位でなく文字（コードポイント）で数える。
function chars(text: string): number {
  return [...text].length;
}

// 要約に含めていない発言（今の質問より前のもの）から、渡す発言を選ぶ（Q-085 の答え）。
// 新しい方から足し、本文の合計が 20,000 文字を超えるまで足す。直近の 6 発言は必ず入れる。
// 返す順は古い順。
export function selectHistory(
  newestFirst: readonly ReplyMessageRow[],
): ReplyMessageRow[] {
  const selected: ReplyMessageRow[] = [];
  let total = 0;
  for (const [index, message] of newestFirst.entries()) {
    if (index >= ANSWER_HISTORY_MIN_MESSAGES && total > ANSWER_HISTORY_CHARS) {
      break;
    }
    selected.push(message);
    total += chars(message.bodyMd);
  }
  return selected.reverse();
}

function historyText(messages: readonly ReplyMessageRow[]): string {
  return messages
    .map(
      (message) =>
        `[${message.speaker === "owner" ? "本人" : "AI"}]\n${message.bodyMd}`,
    )
    .join("\n\n");
}

// 渡す内容（DD-02 3章 P07）。対象の内容、会話の要約、要約に含めていない発言、今の質問の順。
// 9 MB を超えたら E13（AI_INPUT_TOO_LARGE）を投げる。
export function buildAnswerInput(db: Database, replyMessageId: number): string {
  const materials = inReadTransaction(db, (): Material[] => {
    const reply = findMessage(db, replyMessageId);
    if (
      reply === null ||
      reply.speaker !== "ai" ||
      reply.replyToMessageId === null
    ) {
      throw new NexusError("INTERNAL", "応答する AI の発言が無い");
    }
    const question = findMessage(db, reply.replyToMessageId);
    const conversation = findAnswerConversation(db, reply.conversationId);
    if (question === null || conversation === null) {
      throw new NexusError("INTERNAL", "質問か会話が無い");
    }
    const list: Material[] = [];
    if (
      conversation.targetContentId !== null &&
      conversation.targetKind !== null &&
      conversation.questionTargetJson !== null
    ) {
      const target = JSON.parse(conversation.questionTargetJson) as ChatTarget;
      const body = kindChat(conversation.targetKind).buildAnswerMaterial(
        db,
        conversation.targetContentId,
        target,
      );
      if (body === null) {
        throw new NexusError("INTERNAL", "対象の内容の中身が無い");
      }
      list.push({ kind: "target", body });
    }
    if (conversation.summaryMd !== null) {
      list.push({ kind: "summary", body: conversation.summaryMd });
    }
    const history = selectHistory(
      listMessagesBetweenNewestFirst(
        db,
        conversation.conversationId,
        conversation.summaryLastMessageId,
        question.messageId,
      ),
    );
    if (history.length > 0) {
      list.push({ kind: "history", body: historyText(history) });
    }
    list.push({ kind: "question", body: question.bodyMd });
    return list;
  });
  return buildAiInput(ANSWER_RULES, materials);
}

// 完了にできなかった（実行が running でなくなった）ときに、トランザクションを戻すための印。
class RunNotRunning extends Error {}

export async function runAnswer(
  deps: AnswerDeps,
  run: PickedRun,
  context: ExecuteContext = {},
): Promise<void> {
  const { db, provider, clock, logger } = deps;
  const replyMessageId = run.replyMessageId;
  if (replyMessageId === null) {
    throw new NexusError("INTERNAL", "応答する AI の発言が無い");
  }
  // 手順 2: 組み立て、写しを AI の発言に残す（送り直しで置き換える）。
  const input = buildAnswerInput(db, replyMessageId);
  inWriteTransaction(db, () => setAiInputCopy(db, replyMessageId, input));

  // 手順 4: 続きとツールの回数を手元にため、100 ミリ秒ごとにまとめて書く。
  let pendingText = "";
  let pendingTools: ToolCounts = { webSearch: 0, webFetch: 0, folderRead: 0 };
  const hasPending = () =>
    pendingText !== "" ||
    pendingTools.webSearch + pendingTools.webFetch + pendingTools.folderRead >
      0;
  // ためた分を書く。呼んだ側のトランザクションの中でも外でも使えるよう、文だけを並べる。
  const writePending = () => {
    if (pendingText !== "") appendReplyBody(db, replyMessageId, pendingText);
    addToolCounts(db, run.aiRunId, pendingTools);
  };
  const clearPending = () => {
    pendingText = "";
    pendingTools = { webSearch: 0, webFetch: 0, folderRead: 0 };
  };
  const flush = () => {
    if (!hasPending()) return;
    try {
      inWriteTransaction(db, writePending);
      clearPending();
    } catch (error) {
      // その回の続きは残らない。次の回にまとめて書く（DD-05 3章 FN-015 の書き足し）。
      logger.log({
        level: "warn",
        target: "FN-015",
        aiRunId: run.aiRunId,
        detail: "応答の続きを書き足せなかったので、次の回にまとめて書く",
        error,
      });
    }
  };
  const onEvent = (event: AiEvent) => {
    if (event.type === "text") {
      pendingText += event.text;
    } else if (event.type === "tool_use") {
      const column = TOOL_COLUMNS[event.name];
      if (column !== undefined) pendingTools[column] += 1;
    }
  };

  const timer = setInterval(
    flush,
    deps.flushIntervalMs ?? ANSWER_FLUSH_INTERVAL_MS,
  );
  try {
    // 手順 3: 使えるツールは WebSearch、WebFetch、Read、Glob、Grep（引数と設定は M26。DD-09 2.5）。
    const call = provider.call({
      purpose: "answer",
      input,
      signal: context.signal,
      runId: run.aiRunId,
    });
    // 失敗は DD-06 の分類（E09〜E12）で投げ、3章 P06 の失敗の扱いに渡す。
    await readAiCall(call, { signal: context.signal, onEvent });
  } catch (error) {
    // 失敗しても、それまでのツールの回数と続きは残す（失敗の扱いは 3章 P06）。
    flush();
    throw error;
  } finally {
    clearInterval(timer);
  }

  // 手順 5: 1つのトランザクションで、ためていた続きを書き足し、AI の発言と実行を完了にする。
  try {
    inWriteTransaction(db, () => {
      writePending();
      markReplyDone(db, replyMessageId);
      if (!completeRun(db, run.aiRunId, clock.now())) throw new RunNotRunning();
    });
    clearPending();
  } catch (error) {
    if (!(error instanceof RunNotRunning)) throw error;
    // 先に別の状態へ進んだ（DD-05 3章 ENT-009）。何もしない。
    logger.log({
      level: "warn",
      target: "FN-015",
      aiRunId: run.aiRunId,
      detail: "実行が処理中でなくなったので、応答を完了にしなかった",
    });
  }
}
