import type { Chat, ReplyProgress } from "../../../server/chat";
import { NexusError, logLevelOf } from "../../../server/shared/errors";
import type { Logger } from "../../../server/shared/logger";
import { type DeviceApiContext, deviceApi } from "./device-api";
import { errorResponse } from "./errors";

// 応答の続きを流す端末の API（DD-01 M11。DD-02 FN-015 続きを流す、DD-04 3.5、X-02 ADR-013）。
//   `streamReply`  GET  `/api/app/messages/{messageId}/stream`  text/event-stream
// 1. 3章 P01 で端末の鍵を確かめる（`deviceApi`）。M18 で AI の発言を読む。無いか本人の発言なら 404 と MSG-019
//    （発言ID の形が違うときも、発言が無いとして 404）。送り始める前の失敗（DB が使えないなど）は 500。
// 2. 最初に `retry: 3000` を送る。出来事の番号は `<実行ID>.<位置>`（実行ID はその AI の発言の一番新しい
//    `ai_run`、位置は本文の UTF-16 の単位の長さ）。`Last-Event-ID` があれば、その実行ID と位置を、送った実行と
//    送った位置とする。無ければ、今の実行と位置 0 とする。
// 3. 200 ミリ秒ごとに M18 で本文と応答の状態と一番新しい実行ID を読む。実行ID が送った実行と違えば
//    `reset` を送り、送った実行を新しい実行ID に、送った位置を 0 にする（RV16-01）。続けて、送った位置より
//    本文が長ければ、続きを1つの `delta` で送り、送った位置を進める。
// 4. 応答の状態が writing でなくなったら、残りの続きを送ってから `state` を送り、閉じる。
// 5. 15 秒ごとに空のコメント行を送る。端末が切ったら読むのをやめる。
// 送り始めた後の失敗では、出来事を送らずに接続を閉じる（画面が 3 秒後につなぎ直す。DD-06 E08、RV16-10）。

const ID_PATTERN = /^[1-9][0-9]*$/;
const LAST_EVENT_ID_PATTERN = /^([0-9]+)\.([0-9]+)$/;
const TARGET = "FN-015";

// 画面がつなぎ直すまでの時間（DD-04 3.2）。
export const STREAM_RETRY_MS = 3_000;
// DB を読む間隔（DD-02 FN-015 続きを流すの手順 3）。
export const STREAM_POLL_INTERVAL_MS = 200;
// 空のコメント行を送る間隔（DD-04 3.5）。
export const STREAM_HEARTBEAT_INTERVAL_MS = 15_000;

export interface ReplyStreamRouteContext {
  params: Promise<{ messageId: string }>;
}

export interface ReplyStreamApiContext {
  deviceApi: DeviceApiContext;
  chat: Chat;
  // テストで間隔を縮めるときだけ渡す。
  pollIntervalMs?: number;
  heartbeatIntervalMs?: number;
}

function readId(text: string): number | null {
  if (!ID_PATTERN.test(text)) return null;
  const value = Number(text);
  return Number.isSafeInteger(value) ? value : null;
}

// `Last-Event-ID` を実行ID と位置に分ける。形が違えば null（無いときと同じに扱う）。
function readLastEventId(
  text: string | null,
): { runId: number; position: number } | null {
  if (text === null) return null;
  const match = LAST_EVENT_ID_PATTERN.exec(text.trim());
  if (match === null) return null;
  const runId = Number(match[1]);
  const position = Number(match[2]);
  if (!Number.isSafeInteger(runId) || !Number.isSafeInteger(position)) {
    return null;
  }
  return { runId, position };
}

function eventText(
  name: string,
  data: unknown,
  id: string | null = null,
): string {
  const lines = [`event: ${name}`];
  if (id !== null) lines.push(`id: ${id}`);
  lines.push(`data: ${JSON.stringify(data)}`);
  return `${lines.join("\n")}\n\n`;
}

export function streamReply(
  context: ReplyStreamApiContext,
): (
  request: Request,
  routeContext: ReplyStreamRouteContext,
) => Promise<Response> {
  const { logger } = context.deviceApi;
  const pollIntervalMs = context.pollIntervalMs ?? STREAM_POLL_INTERVAL_MS;
  const heartbeatIntervalMs =
    context.heartbeatIntervalMs ?? STREAM_HEARTBEAT_INTERVAL_MS;

  return deviceApi<ReplyStreamRouteContext>(
    context.deviceApi,
    async (request, { requestId }, routeContext) => {
      const { messageId: text } = await routeContext.params;
      const messageId = readId(text);
      if (messageId === null) {
        logger.log({
          level: logLevelOf("NOT_FOUND"),
          code: "NOT_FOUND",
          msg: "MSG-019",
          target: TARGET,
          requestId,
        });
        return errorResponse(404, "not_found", "MSG-019");
      }
      // 手順 1: 送り始める前に1回読む。無ければ NOT_FOUND、DB が使えなければ DB_UNAVAILABLE を投げ、
      // 入口が 404 か 500 にする。
      const first = context.chat.readReply(messageId);
      const resumed = readLastEventId(request.headers.get("last-event-id"));
      const body = createReplyStream({
        chat: context.chat,
        logger,
        requestId,
        messageId,
        first,
        sentRunId: resumed?.runId ?? first.runId,
        sentPosition: resumed?.position ?? 0,
        pollIntervalMs,
        heartbeatIntervalMs,
        signal: request.signal,
      });
      return new Response(body, {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          "X-Accel-Buffering": "no",
        },
      });
    },
    { target: TARGET },
  );
}

function createReplyStream(options: {
  chat: Chat;
  logger: Logger;
  requestId: string;
  messageId: number;
  first: ReplyProgress;
  sentRunId: number;
  sentPosition: number;
  pollIntervalMs: number;
  heartbeatIntervalMs: number;
  signal: AbortSignal;
}): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let sentRunId = options.sentRunId;
  let sentPosition = options.sentPosition;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let closed = false;

  const stop = () => {
    closed = true;
    if (pollTimer !== null) clearTimeout(pollTimer);
    if (heartbeatTimer !== null) clearInterval(heartbeatTimer);
    pollTimer = null;
    heartbeatTimer = null;
    options.signal.removeEventListener("abort", stop);
  };

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (text: string) => {
        if (closed) return;
        controller.enqueue(encoder.encode(text));
      };
      const close = () => {
        if (closed) return;
        stop();
        controller.close();
      };

      // 手順 3、4: 読んだ本文と状態を出来事にする。閉じたら false。
      const emit = (progress: ReplyProgress): boolean => {
        if (progress.runId !== sentRunId) {
          send(eventText("reset", {}));
          sentRunId = progress.runId;
          sentPosition = 0;
        }
        const length = progress.bodyMd.length;
        if (length > sentPosition) {
          send(
            eventText(
              "delta",
              { text: progress.bodyMd.slice(sentPosition) },
              `${sentRunId}.${length}`,
            ),
          );
          sentPosition = length;
        }
        if (progress.replyState !== "writing") {
          send(
            eventText("state", {
              replyState: progress.replyState,
              messageId: progress.messageId,
              notice: progress.notice,
            }),
          );
          close();
          return false;
        }
        return true;
      };

      const poll = () => {
        pollTimer = null;
        if (closed) return;
        let progress: ReplyProgress;
        try {
          progress = options.chat.readReply(options.messageId);
        } catch (error) {
          // 送り始めた後の失敗。出来事を送らずに閉じる（DD-04 3.5、DD-06 E08）。
          const code = error instanceof NexusError ? error.code : "INTERNAL";
          options.logger.log({
            level: logLevelOf(code),
            code,
            msg: "MSG-019",
            target: TARGET,
            requestId: options.requestId,
            detail: "応答の続きを読めないので接続を閉じた",
            error,
          });
          close();
          return;
        }
        if (emit(progress)) {
          pollTimer = setTimeout(poll, options.pollIntervalMs);
        }
      };

      options.signal.addEventListener("abort", stop);
      if (options.signal.aborted) {
        close();
        return;
      }
      // 手順 2: 最初の出来事の前に `retry` を送る。
      send(`retry: ${STREAM_RETRY_MS}\n\n`);
      if (!emit(options.first)) return;
      // 手順 5: 空のコメント行。
      heartbeatTimer = setInterval(
        () => send(":\n\n"),
        options.heartbeatIntervalMs,
      );
      pollTimer = setTimeout(poll, options.pollIntervalMs);
    },
    cancel() {
      // 端末が切った。
      stop();
    },
  });
}
