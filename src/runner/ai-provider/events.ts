import type { AiEvent } from "./types";

// stream-json の1行を出来事にする（DD-04 4.2）。
// 読み捨てる出来事（`system` の `init`、`user`、上に無い `stream_event` など）は null を返す。
export function parseEventLine(line: string): AiEvent | null {
  if (line.trim() === "") return null;
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return { type: "bad_line" };
  }
  if (!isObject(value)) return { type: "bad_line" };

  switch (value.type) {
    case "stream_event":
      return parseStreamEvent(value.event);
    case "assistant":
      return typeof value.error === "string" && value.error !== ""
        ? { type: "assistant_error", error: value.error }
        : null;
    case "result": {
      const subtype = typeof value.subtype === "string" ? value.subtype : "";
      return {
        type: "result",
        ok: subtype === "success" && value.is_error !== true,
        subtype,
        result: typeof value.result === "string" ? value.result : null,
        errors: Array.isArray(value.errors)
          ? value.errors.filter((e): e is string => typeof e === "string")
          : [],
      };
    }
    case "system":
      return value.subtype === "api_retry" ? { type: "api_retry" } : null;
    default:
      return null;
  }
}

function parseStreamEvent(event: unknown): AiEvent | null {
  if (!isObject(event)) return null;
  if (event.type === "content_block_delta") {
    const delta = event.delta;
    if (
      isObject(delta) &&
      delta.type === "text_delta" &&
      typeof delta.text === "string"
    ) {
      return { type: "text", text: delta.text };
    }
    return null;
  }
  if (event.type === "content_block_start") {
    const block = event.content_block;
    if (
      isObject(block) &&
      block.type === "tool_use" &&
      typeof block.name === "string"
    ) {
      return { type: "tool_use", name: block.name };
    }
    return null;
  }
  return null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
