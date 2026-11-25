import type { AiQueue } from "../../../server/ai-jobs";
import type { Logger } from "../../../server/shared/logger";
import { createRequestId } from "../../../server/shared/secret";
import { toErrorResponse } from "./errors";

// 状態を返す API `getHealth`（GET `/api/health`。DD-01 M11、DD-04、BD-01 6章 監視、BD-11 OP04）。
// 鍵を求めない（DD-04 3.1、BD-10 2章。CR-011）。返すのは待ちの数、処理中の数、
// 一番古い待ちの日時だけで、内容と鍵は返さない（`openapi.yaml` の `Health`）。
// DB が使えないなどの失敗は 500 `internal`（DD-04 3.4、DD-06 E08、E16）。

export interface HealthContext {
  logger: Logger;
  queue: Pick<AiQueue, "counts">;
}

export function getHealth(context: HealthContext): () => Response {
  return () => {
    try {
      const { queuedCount, runningCount, oldestQueuedAt } =
        context.queue.counts();
      return Response.json({
        status: "ok",
        queuedCount,
        runningCount,
        oldestQueuedAt,
      });
    } catch (error) {
      return toErrorResponse(error, {
        logger: context.logger,
        requestId: createRequestId(),
      });
    }
  };
}
