import {
  cancelRunningRun,
  failRun,
  requeueAnswer,
  requeueRelate,
  type PickedRun,
} from "../../server/ai-jobs";
import type { Database } from "../../server/db/connection";
import { inWriteTransaction } from "../../server/db/transaction";
import type { Clock } from "../../server/shared/clock";
import { type ErrorCode, NexusError } from "../../server/shared/errors";
import {
  findMessage,
  markReplyCancelled,
  markReplyFailed,
  resetWritingReplyBody,
} from "../../server/repositories/conversation";
import type { Logger } from "../../server/shared/logger";
import { formatMessage } from "../../server/shared/messages";
import { type AiProvider, createAiProvider } from "../ai-provider";
import type { Config } from "../../server/shared/config";
import type { ExecuteContext } from "./context";
import { RunStopRequested } from "./outcome";
import { runAnswer } from "./answer";
import { runRelate } from "./relate";
import { enqueueSummarizeIfNeeded, runSummarize } from "./summarize";

export type { ExecuteContext } from "./context";

// AI の目的ごとの処理（DD-01 M25）。M24 が拾った実行を受け、目的ごとの処理に渡す。

export interface PurposesDeps {
  db: Database;
  provider: AiProvider;
  clock: Clock;
  logger: Logger;
}

export interface Purposes {
  // 実行する（実行 → 完了か失敗）。失敗は実行の記録に残して返る。
  execute(run: PickedRun, context?: ExecuteContext): Promise<void>;
  // 失敗の扱い（DD-02 3章 P06 手順 5）を当てる。AI Runner の起動のときの手順 1 でも使う。
  fail(run: PickedRun, error: unknown): void;
}

// 1回だけ自動で送り直す失敗の分類（DD-06 E09、E10、E11。DD-06 4章）。
// E12、E13、E16 は送り直さない。
export const RETRYABLE_CODES: readonly ErrorCode[] = [
  "AI_TIMEOUT",
  "AI_BAD_OUTPUT",
  "AI_INTERRUPTED",
];

// 設定（DD-09 2.3）から AI の呼び方（M26）を決めて作る。AI Runner の入口（M24）はこちらを使う。
export function createPurposesFromConfig(
  config: Config,
  deps: Omit<PurposesDeps, "provider">,
): Purposes {
  return createPurposes({ ...deps, provider: createAiProvider(config) });
}

export function createPurposes(deps: PurposesDeps): Purposes {
  const { db, clock, logger } = deps;
  return {
    async execute(run, context = {}) {
      try {
        if (run.purpose === "relate") {
          await runRelate(deps, run, context);
        } else if (run.purpose === "answer") {
          if (await runAnswer(deps, run, context)) afterAnswer(run);
        } else {
          await runSummarize(deps, run, context);
        }
      } catch (error) {
        if (error instanceof RunStopRequested) cancel(run);
        else fail(run, error);
      }
    },
    fail,
  };

  // 止める求めで止めたとき（DD-02 3章 P06 手順 3、FN-016 手順 3）。1つのトランザクションで、
  // 実行を running のときだけ cancelled にし、answer なら AI の発言を writing のときだけ cancelled にする
  // （本文は残す）。先に完了か失敗に進んでいたら何もしない（DD-05 3章 ENT-008・ENT-009）。
  function cancel(run: PickedRun): void {
    const cancelled = inWriteTransaction(db, () => {
      if (!cancelRunningRun(db, run.aiRunId, clock.now())) return false;
      if (run.purpose === "answer" && run.replyMessageId !== null) {
        markReplyCancelled(db, run.replyMessageId);
      }
      return true;
    });
    logger.log({
      level: "info",
      aiRunId: run.aiRunId,
      detail: cancelled
        ? "止める求めで AI の実行を中止にした"
        : "AI の実行が処理中でなかったので、中止にしなかった",
    });
  }

  // 質問の応答が完了した後に、会話の要約を待ちに入れるかを決める（DD-02 FN-015 応答の手順 7、会話の要約の手順 1）。
  // 応答は完了しているので、ここで失敗しても応答の失敗にしない。入らなければ、次の質問の応答の後にもう一度判断する（DD-05 3章）。
  function afterAnswer(run: PickedRun): void {
    try {
      const conversationId = findAnswerConversationId(run);
      if (conversationId === null) return;
      enqueueSummarizeIfNeeded(db, conversationId, clock.now());
    } catch (error) {
      logger.log({
        level: "warn",
        target: "FN-015",
        aiRunId: run.aiRunId,
        detail: "会話の要約を待ちに入れるかを決められなかった",
        error,
      });
    }
  }

  function findAnswerConversationId(run: PickedRun): number | null {
    if (run.replyMessageId === null) return null;
    return findMessage(db, run.replyMessageId)?.conversationId ?? null;
  }

  // 失敗の扱い（DD-02 3章 P06 手順 5）。1つのトランザクションで次を行う（DD-05 3章）。
  // - `state` を running のときだけ failed にし、`failure_reason` に失敗の分類と短い理由を入れる。
  // - relate で `attempt` が 1 で、分類が E09、E10、E11 なら、同じ受け取りの記録で `attempt` 2 を待ちに入れる。
  // - answer で `attempt` が 1 で、分類が E09、E10、E11 なら、AI の発言の本文を空に戻して writing のままにし、
  //   同じ AI の発言で `attempt` 2 を待ちに入れる（発言が writing でなければ送り直さない）。
  // - それ以外の relate は、ログに MSG-037 を出す（記事は残したまま。RD-06 UC-001）。
  // - それ以外の answer は、AI の発言を failed にする（writing のときだけ）。
  // - summarize は送り直さず、何もしない（次の質問の応答の完了の後にもう一度判断する。DD-02 FN-015 会話の要約の手順 4）。
  // E12、E13、E16 は送り直さない（DD-06 4章）。分類の無い例外は E16（INTERNAL）。
  function fail(run: PickedRun, error: unknown): void {
    const nexus =
      error instanceof NexusError
        ? error
        : new NexusError("INTERNAL", "予期しない失敗", { cause: error });
    const reason = `${nexus.code}: ${nexus.message}`;
    const now = clock.now();
    const outcome = inWriteTransaction(db, () => {
      if (!failRun(db, run.aiRunId, reason, now)) return "not_running" as const;
      if (
        run.purpose === "relate" &&
        run.relateDeliveryId !== null &&
        run.attempt === 1 &&
        RETRYABLE_CODES.includes(nexus.code)
      ) {
        requeueRelate(db, run.relateDeliveryId, run.attempt + 1, now);
        return "retried" as const;
      }
      if (run.purpose === "answer" && run.replyMessageId !== null) {
        if (
          run.attempt === 1 &&
          RETRYABLE_CODES.includes(nexus.code) &&
          resetWritingReplyBody(db, run.replyMessageId) === 1
        ) {
          requeueAnswer(db, run.replyMessageId, run.attempt + 1, now);
          return "retried" as const;
        }
        markReplyFailed(db, run.replyMessageId);
      }
      return "failed" as const;
    });
    const relate = run.purpose === "relate";
    const finalRelate = relate && outcome === "failed";
    logger.log({
      level: finalRelate ? "error" : nexus.level,
      code: nexus.code,
      msg: finalRelate ? "MSG-037" : undefined,
      target: relate ? "FN-002" : undefined,
      aiRunId: run.aiRunId,
      deliveryId: run.relateDeliveryId ?? undefined,
      detail:
        outcome === "not_running"
          ? "AI の実行が処理中でなかったので、失敗にしなかった"
          : outcome === "retried"
            ? "AI の実行を失敗にし、1回だけ自動で送り直す"
            : finalRelate
              ? formatMessage("MSG-037", { 理由: reason })
              : "AI の実行を失敗にした",
      error,
    });
  }
}
