import { ENGLISH_LANE } from "../../../server/kinds/english/ingest";
import type { EnglishForSender } from "../../../server/kinds/english/provide";
import type { Clock } from "../../../server/shared/clock";
import { daysBetween, formatDate } from "../../../server/shared/datetime";
import { logLevelOf } from "../../../server/shared/errors";
import type { Logger } from "../../../server/shared/logger";
import { errorResponse } from "./errors";
import { type SenderApiContext, senderApi } from "./sender-api";

// sharpen が読む `getEnglishSetForSender`（GET `/api/learning/sets/{date}?lane=en`）と
// `getEnglishResult`（GET `/api/learning/sets/{date}/result?lane=en`）。
// DD-01 M11、DD-02 FN-013、DD-04、IF-003。
//   1. 3章 P02 で sharpen の鍵を確かめる（使う連携 IF-003）。通らなければ 401 と MSG-032。
//      `lane` が `en` でなければ 400 と MSG-033。`date` が `today` なら日本時間の今日にする。
//   2. セット: 無ければ 404 と MSG-036。あれば原文に `date` と `receivedAt` を足して返す。
//   3. 答え: あれば返す。無ければ、セットがあれば 404 と MSG-035、セットも無ければ 404 と MSG-036。
//   4. 読むだけなので `delivery` に行を作らない。

const TARGET = "FN-013";
const DATE_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

export interface EnglishProvideContext extends SenderApiContext {
  logger: Logger;
  englishForSender: EnglishForSender;
  clock: Clock;
}

export interface DateRouteContext {
  params: Promise<{ date: string }>;
}

type Resolved = { ok: true; date: string } | { ok: false; response: Response };

// `lane` と `date` を確かめ、`date` を日付にする。
async function resolveRequest(
  context: EnglishProvideContext,
  request: Request,
  routeContext: DateRouteContext,
  requestId: string,
): Promise<Resolved> {
  const lane = new URL(request.url).searchParams.get("lane");
  const { date: rawDate } = await routeContext.params;
  const invalidItem =
    lane !== ENGLISH_LANE
      ? "lane"
      : rawDate !== "today" &&
          !(DATE_PATTERN.test(rawDate) && daysBetween(rawDate, rawDate) === 0)
        ? "date"
        : null;
  if (invalidItem !== null) {
    context.logger.log({
      level: logLevelOf("INPUT_INVALID"),
      code: "INPUT_INVALID",
      msg: "MSG-033",
      target: TARGET,
      requestId,
    });
    return {
      ok: false,
      response: errorResponse(400, "bad_request", {
        id: "MSG-033",
        values: { 項目: invalidItem },
      }),
    };
  }
  const date = rawDate === "today" ? formatDate(context.clock.now()) : rawDate;
  return { ok: true, date };
}

function notFound(
  context: EnglishProvideContext,
  requestId: string,
  id: "MSG-035" | "MSG-036",
  date: string,
): Response {
  context.logger.log({
    level: logLevelOf("NOT_FOUND"),
    code: "NOT_FOUND",
    msg: id,
    target: TARGET,
    requestId,
  });
  return errorResponse(404, "not_found", { id, values: { 日付: date } });
}

export function getEnglishSetForSender(
  context: EnglishProvideContext,
): (request: Request, routeContext: DateRouteContext) => Promise<Response> {
  return senderApi<DateRouteContext>(
    context,
    async (request, { requestId }, routeContext) => {
      const resolved = await resolveRequest(
        context,
        request,
        routeContext,
        requestId,
      );
      if (!resolved.ok) return resolved.response;
      const set = context.englishForSender.readSet(resolved.date);
      if (set === null) {
        return notFound(context, requestId, "MSG-036", resolved.date);
      }
      return Response.json(set);
    },
    { usedInterface: "IF-003", target: TARGET },
  );
}

export function getEnglishResult(
  context: EnglishProvideContext,
): (request: Request, routeContext: DateRouteContext) => Promise<Response> {
  return senderApi<DateRouteContext>(
    context,
    async (request, { requestId }, routeContext) => {
      const resolved = await resolveRequest(
        context,
        request,
        routeContext,
        requestId,
      );
      if (!resolved.ok) return resolved.response;
      const outcome = context.englishForSender.readResult(resolved.date);
      if (!outcome.ok) {
        const id = outcome.reason === "no_answer" ? "MSG-035" : "MSG-036";
        return notFound(context, requestId, id, resolved.date);
      }
      return Response.json(outcome.result);
    },
    { usedInterface: "IF-003", target: TARGET },
  );
}
