import { NexusError } from "../../server/shared/errors";
import { redact } from "../../server/shared/logger";
import type { AiCall, AiEvent } from "../ai-provider";

// AI の呼び出しの出来事と終わりの状態を読み、成功なら `result` の文を返し、
// 失敗なら DD-06 の分類（E09〜E12）の NexusError を投げる（DD-04 4.2 の表）。

// AI を動かす仕組みが使えないことを表す `assistant` の `error`（DD-04 4.2、DD-06 E12）。
export const UNAVAILABLE_ASSISTANT_ERRORS: readonly string[] = [
  "authentication_failed",
  "oauth_org_not_allowed",
  "account_on_hold",
  "billing_error",
  "rate_limit",
];

// `failure_reason` に入れる CLI の文の長さの上限（短い理由にする。DD-02 3章 P06 手順 5）。
const REASON_DETAIL_MAX_CHARS = 200;

// 止める合図の理由に使う、時間の上限の失敗（DD-06 E09）。
export function timeoutError(): NexusError {
  return new NexusError("AI_TIMEOUT", "時間の上限を超えたので止めた");
}

// CLI の文を短くし、鍵の形を伏せる（NFR-019）。
function shortDetail(texts: readonly string[]): string {
  const joined = redact(texts.join(" / ").replace(/\s+/g, " ").trim());
  const chars = [...joined];
  return chars.length > REASON_DETAIL_MAX_CHARS
    ? `${chars.slice(0, REASON_DETAIL_MAX_CHARS).join("")}…`
    : joined;
}

export interface ReadCallOptions {
  // M24 の止める合図。合図で止めたときは、その理由（NexusError）を失敗にする。
  signal?: AbortSignal;
  // 出来事ごとに呼ぶ（文の続きやツールの数えを使う目的のため）。
  onEvent?: (event: AiEvent) => void;
}

export async function readAiCall(
  call: AiCall,
  options: ReadCallOptions = {},
): Promise<string> {
  let result: Extract<AiEvent, { type: "result" }> | null = null;
  let badLine = false;
  const assistantErrors: string[] = [];
  for await (const event of call.events) {
    options.onEvent?.(event);
    if (event.type === "result") result = event;
    else if (event.type === "bad_line") badLine = true;
    else if (event.type === "assistant_error")
      assistantErrors.push(event.error);
  }
  const exit = await call.exit;

  // AI Runner が止めたときは、AI Runner の側で決めた理由にし、CLI の終了コードを見ない。
  if (exit.kind === "stopped") {
    const reason: unknown = options.signal?.reason;
    if (reason instanceof NexusError) throw reason;
    throw new NexusError("AI_INTERRUPTED", "AI Runner が CLI を止めた");
  }
  if (exit.kind === "launch_failed") {
    throw new NexusError("AI_UNAVAILABLE", "CLI を起動できない");
  }
  const unavailable = assistantErrors.find((error) =>
    UNAVAILABLE_ASSISTANT_ERRORS.includes(error),
  );
  if (unavailable !== undefined) {
    throw new NexusError(
      "AI_UNAVAILABLE",
      `AI を動かす仕組みが使えない（${shortDetail([unavailable])}）`,
    );
  }
  if (assistantErrors.length > 0) {
    throw new NexusError(
      "AI_INTERRUPTED",
      `AI が途中で止まった（${shortDetail(assistantErrors)}）`,
    );
  }
  if (exit.exitCode !== 0) {
    throw new NexusError(
      "AI_INTERRUPTED",
      exit.exitCode === null
        ? "CLI がシグナルで終わった"
        : `CLI が終了コード ${exit.exitCode} で終わった`,
    );
  }
  if (badLine) {
    throw new NexusError(
      "AI_BAD_OUTPUT",
      "JSON として読めない出来事の行がある",
    );
  }
  if (result === null) {
    throw new NexusError(
      "AI_BAD_OUTPUT",
      "終了コードが 0 なのに終わりの出来事が無い",
    );
  }
  if (!result.ok) {
    const detail = shortDetail(result.errors);
    throw new NexusError(
      "AI_INTERRUPTED",
      `終わりの出来事が失敗（${result.subtype || "subtype なし"}${detail === "" ? "" : `: ${detail}`}）`,
    );
  }
  if (result.result === null) {
    throw new NexusError("AI_BAD_OUTPUT", "終わりの出来事に result の文が無い");
  }
  return result.result;
}
