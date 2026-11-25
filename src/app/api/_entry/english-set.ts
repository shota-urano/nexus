import type { SenderKeys } from "../../../server/auth/sender-key";
import { type Ingest, failureReason } from "../../../server/ingest";
import {
  ENGLISH_KIND,
  ENGLISH_SET_MAX_BYTES,
} from "../../../server/kinds/english/ingest";
import { NexusError, logLevelOf } from "../../../server/shared/errors";
import type { Logger } from "../../../server/shared/logger";
import { errorResponse } from "./errors";
import { readJsonBody, senderApi } from "./sender-api";

// 英語のセットの受け取り `postEnglishSet`（POST `/api/learning/sets`。DD-01 M11、DD-02 FN-007、DD-04、IF-002）。
//   1. 本文が 256 KiB を超えたら 413 と MSG-034（P02 の入口が鍵より先に確かめる）。
//      3章 P02 で sharpen の鍵を確かめる（IF-002）。通らなければ 401 と MSG-032。
//      本文を JSON として読む。読めなければ 400 と MSG-033（項目「本文」）。
//   2〜4. M13 で受け取る（形は M16）。形の外れは 400 と MSG-033。手順 4 の失敗は 500 と MSG-045
//      （DD-06 E08、E16 の配信元への応答）。
//   5. 200 で `date`（日付にしたもの）と `receivedAt` を返し、ログに MSG-031 を出す。
// 断ったときは、受け取りの断った記録を別のトランザクションで作る（sender は sharpen。手順 6）。

const SENDER = "sharpen";
const TARGET = "FN-007";

export interface EnglishSetContext {
  logger: Logger;
  senderKeys: Pick<SenderKeys, "verify">;
  ingest: Ingest;
}

export function postEnglishSet(
  context: EnglishSetContext,
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
        outcome = ingest.receive(SENDER, ENGLISH_KIND, json.value, json.text);
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
        logger.log({
          level: logLevelOf("INPUT_INVALID"),
          code: "INPUT_INVALID",
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
        date: outcome.targetDate,
        receivedAt: outcome.receivedAt,
      });
    },
    {
      usedInterface: "IF-002",
      target: TARGET,
      maxBodyBytes: ENGLISH_SET_MAX_BYTES,
      onRefused: (message) => ingest.recordRejected(SENDER, null, message),
      internalMessage: (error) => ({
        id: "MSG-045",
        values: { 理由: failureReason(error) },
      }),
    },
  );
}
