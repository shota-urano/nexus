import { failRun, requeueRelate, type PickedRun } from "../../server/ai-jobs";
import type { Database } from "../../server/db/connection";
import { inWriteTransaction } from "../../server/db/transaction";
import type { Clock } from "../../server/shared/clock";
import { type ErrorCode, NexusError } from "../../server/shared/errors";
import { markReplyFailed } from "../../server/repositories/conversation";
import type { Logger } from "../../server/shared/logger";
import { formatMessage } from "../../server/shared/messages";
import { type AiProvider, createAiProvider } from "../ai-provider";
import type { Config } from "../../server/shared/config";
import type { ExecuteContext } from "./context";
import { runAnswer } from "./answer";
import { runRelate } from "./relate";

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
          await runAnswer(deps, run, context);
        } else {
          // 会話の要約は 10-chat の実装単位で作る。
          throw new NexusError("INTERNAL", "この目的の処理はまだ無い");
        }
      } catch (error) {
        fail(run, error);
      }
    },
    fail,
  };

  // 失敗の扱い（DD-02 3章 P06 手順 5）。1つのトランザクションで次を行う（DD-05 3章）。
  // - `state` を running のときだけ failed にし、`failure_reason` に失敗の分類と短い理由を入れる。
  // - relate で `attempt` が 1 で、分類が E09、E10、E11 なら、同じ受け取りの記録で `attempt` 2 を待ちに入れる。
  // - それ以外の relate は、ログに MSG-037 を出す（記事は残したまま。RD-06 UC-001）。
  // - それ以外の answer は、AI の発言を failed にする（writing のときだけ）。
  // answer の送り直しは 10-chat の次の実装単位で作る。分類の無い例外は E16（INTERNAL）。
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
