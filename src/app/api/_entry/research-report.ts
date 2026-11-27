import type { SenderKeys } from "../../../server/auth/sender-key";
import { type Ingest, failureReason } from "../../../server/ingest";
import {
  RESEARCH_KIND,
  RESEARCH_REPORT_MAX_BYTES,
  RESEARCH_SOURCE,
} from "../../../server/kinds/research/ingest";
import { NexusError, logLevelOf } from "../../../server/shared/errors";
import type { Logger } from "../../../server/shared/logger";
import { errorResponse } from "./errors";
import { readJsonBody, senderApi } from "./sender-api";

// 週報の受け取り `postResearchReport`（POST `/api/research/reports`。DD-01 M11、DD-02 FN-025、DD-04、
// IF-005。CR-020）。
//   1. 本文が 256 KiB を超えたら 413 と MSG-034（P02 の入口が鍵より先に確かめる）。
//   2. 3章 P02 で brain-research の鍵を確かめる（IF-005）。通らなければ 401 と MSG-032。
//   3. 本文を JSON として読む。読めなければ 400 と MSG-033（項目「本文」）。
//   4〜6. M13 で受け取る（形は M33 が M10 の `ResearchReportPayload` で確かめる）。形の外れは 400 と
//      MSG-033、方法の数の超えは 400 と MSG-034。手順 6 の失敗は 500 と MSG-046（DD-06 E08、E16）。
//   7. 200 で `source`、`topicId`、`week`、`receivedAt`、`replaced` を返し、ログに MSG-031 を出す。
// 断ったときは、受け取りの断った記録を別のトランザクションで作る（sender は brain-research）。

const SENDER = "brain-research";
const TARGET = "FN-025";

export interface ResearchReportContext {
  logger: Logger;
  senderKeys: Pick<SenderKeys, "verify">;
  ingest: Ingest;
}

export function postResearchReport(
  context: ResearchReportContext,
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
        outcome = ingest.receive(SENDER, RESEARCH_KIND, json.value, json.text);
      } catch (error) {
        const code = error instanceof NexusError ? error.code : "INTERNAL";
        logger.log({
          level: logLevelOf(code),
          code,
          msg: "MSG-046",
          target: TARGET,
          requestId,
          error,
        });
        return errorResponse(500, "internal", {
          id: "MSG-046",
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

      const report = json.value as { topicId: string; week: number };
      logger.log({
        level: "info",
        msg: "MSG-031",
        target: TARGET,
        requestId,
        deliveryId: outcome.deliveryId,
      });
      return Response.json({
        source: RESEARCH_SOURCE,
        topicId: report.topicId,
        week: report.week,
        receivedAt: outcome.receivedAt,
        replaced: outcome.replaced,
      });
    },
    {
      usedInterface: "IF-005",
      target: TARGET,
      maxBodyBytes: RESEARCH_REPORT_MAX_BYTES,
      onRefused: (message) => ingest.recordRejected(SENDER, null, message),
      internalMessage: (error) => ({
        id: "MSG-046",
        values: { 理由: failureReason(error) },
      }),
    },
  );
}
