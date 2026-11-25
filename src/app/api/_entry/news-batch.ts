import type { SenderKeys } from "../../../server/auth/sender-key";
import { type Ingest, failureReason } from "../../../server/ingest";
import {
  NEWS_BATCH_MAX_BYTES,
  NEWS_KIND,
  NEWS_SOURCE,
} from "../../../server/kinds/news/ingest";
import { NexusError, logLevelOf } from "../../../server/shared/errors";
import type { Logger } from "../../../server/shared/logger";
import { errorResponse } from "./errors";
import { readJsonBody, senderApi } from "./sender-api";

// ニュースの受け取り `postNewsBatch`（POST `/api/inbox/batches`。DD-01 M11、DD-02 FN-001、DD-04、IF-001）。
//   1. 本文が 1 MiB を超えたら 413 と MSG-034（P02 の入口が鍵より先に確かめる）。
//   2. 3章 P02 で brain-harness の鍵を確かめる（IF-001）。通らなければ 401 と MSG-032。
//   3. 本文を JSON として読む。読めなければ 400 と MSG-033（項目「本文」）。
//   4〜7. M13 で受け取る。全体の形は 400 と MSG-033 か MSG-034。手順 7 の失敗は 500 と MSG-045。
//   8. 200 で `source`、`date`、`receivedAt`、`itemCount`、`rejected` を返し、ログに MSG-031 を出す。
// 1〜3 と 4 の断りは、受け取りの断った記録を別のトランザクションで作る（sender は brain-harness）。

const SENDER = "brain-harness";
const TARGET = "FN-001";

export interface NewsBatchContext {
  logger: Logger;
  senderKeys: Pick<SenderKeys, "verify">;
  ingest: Ingest;
}

export function postNewsBatch(
  context: NewsBatchContext,
): (request: Request, routeContext?: unknown) => Promise<Response> {
  const { logger, ingest } = context;
  return senderApi(
    context,
    (_request, { requestId, body }) => {
      const json = readJsonBody(body ?? new Uint8Array(0));
      if (!json.ok) {
        const message = { id: "MSG-033", values: { 項目: "本文" } } as const;
        logger.log({
          level: logLevelOf("INPUT_INVALID"),
          code: "INPUT_INVALID",
          msg: "MSG-033",
          target: TARGET,
          requestId,
        });
        ingest.recordRejected(SENDER, null, message);
        return errorResponse(400, "bad_request", message);
      }

      let outcome: ReturnType<Ingest["receive"]>;
      try {
        outcome = ingest.receive(SENDER, NEWS_KIND, json.value);
      } catch (error) {
        const code = error instanceof NexusError ? error.code : "INTERNAL";
        logger.log({
          level: logLevelOf(code),
          code,
          msg: "MSG-045",
          target: TARGET,
          requestId,
          error,
        });
        return errorResponse(500, "internal", {
          id: "MSG-045",
          values: { 理由: failureReason(error) },
        });
      }

      if (!outcome.ok) {
        const code =
          outcome.message.id === "MSG-034"
            ? "INPUT_TOO_LARGE"
            : "INPUT_INVALID";
        logger.log({
          level: logLevelOf(code),
          code,
          msg: outcome.message.id,
          target: TARGET,
          requestId,
        });
        return errorResponse(400, "bad_request", outcome.message);
      }

      logger.log({
        level: "info",
        msg: "MSG-031",
        target: TARGET,
        requestId,
        deliveryId: outcome.deliveryId,
      });
      return Response.json({
        source: NEWS_SOURCE,
        date: outcome.targetDate,
        receivedAt: outcome.receivedAt,
        itemCount: outcome.itemCount,
        rejected: outcome.rejected,
      });
    },
    {
      usedInterface: "IF-001",
      target: TARGET,
      maxBodyBytes: NEWS_BATCH_MAX_BYTES,
      onRefused: (message) => ingest.recordRejected(SENDER, null, message),
      internalMessage: (error) => ({
        id: "MSG-045",
        values: { 理由: failureReason(error) },
      }),
    },
  );
}
