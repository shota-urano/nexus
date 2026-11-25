import { failRun, type PickedRun } from "../../server/ai-jobs";
import type { Database } from "../../server/db/connection";
import { inWriteTransaction } from "../../server/db/transaction";
import type { Clock } from "../../server/shared/clock";
import { NexusError } from "../../server/shared/errors";
import type { Logger } from "../../server/shared/logger";
import type { AiProvider } from "../ai-provider";
import { runRelate } from "./relate";

// AI の目的ごとの処理（DD-01 M25）。M24 が拾った実行を受け、目的ごとの処理に渡す。

export interface PurposesDeps {
  db: Database;
  provider: AiProvider;
  clock: Clock;
  logger: Logger;
}

export interface Purposes {
  // 実行する（実行 → 完了か失敗）。失敗は実行の記録に残して返る。
  execute(run: PickedRun): Promise<void>;
}

export function createPurposes(deps: PurposesDeps): Purposes {
  const { db, clock, logger } = deps;
  return {
    async execute(run) {
      try {
        if (run.purpose !== "relate") {
          // 質問の応答と会話の要約は 10-chat の実装単位で作る。
          throw new NexusError("INTERNAL", "この目的の処理はまだ無い");
        }
        await runRelate(deps, run);
      } catch (error) {
        fail(run, error);
      }
    },
  };

  // 失敗の扱い（DD-02 3章 P06 手順 5 の最初の項）。`state` を running のときだけ failed にし、
  // `failure_reason` に失敗の分類と短い理由を入れる。分類の無い例外は E16（INTERNAL）。
  function fail(run: PickedRun, error: unknown): void {
    const nexus =
      error instanceof NexusError
        ? error
        : new NexusError("INTERNAL", "予期しない失敗", { cause: error });
    const reason = `${nexus.code}: ${nexus.message}`;
    const changed = inWriteTransaction(db, () =>
      failRun(db, run.aiRunId, reason, clock.now()),
    );
    logger.log({
      level: nexus.level,
      code: nexus.code,
      target: run.purpose === "relate" ? "FN-002" : undefined,
      aiRunId: run.aiRunId,
      detail: changed
        ? "AI の実行を失敗にした"
        : "AI の実行が処理中でなかったので、失敗にしなかった",
      error,
    });
  }
}
