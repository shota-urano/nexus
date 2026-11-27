import {
  type ResearchTopicListView,
  researchTopicListSchema,
} from "../contracts/research";
import { deviceFetch } from "./device-api";

// 通信層 M09（DD-01 1.1）。課題の一覧（DD-04 `listResearchTopics`）を呼び、応答を M10 の形で確かめる。
// 結果は次の3つのどれかで返す。
// - ok: 応答の形が正しい
// - unauthorized: 401（MSG-020）。全面の知らせは M01 の枠が出す（deviceFetch が届け先に渡す）
// - failed: それ以外の失敗（つながらない、200 でない、形が違う）。画面は MSG-019 を出す
// 呼んだ画面が止めた（AbortSignal）ときは、AbortError をそのまま投げる。

export type ResearchTopicsResult =
  | { status: "ok"; value: ResearchTopicListView }
  | { status: "unauthorized" }
  | { status: "failed" };

// `listResearchTopics`（FN-026）。課題は同時に1〜3個なので、続きは無い（DD-04 3.3）。
export async function fetchResearchTopics(
  request: { signal?: AbortSignal } = {},
): Promise<ResearchTopicsResult> {
  const { signal } = request;
  let response: Response;
  try {
    response = await deviceFetch("/api/app/research/topics", { signal });
  } catch (error) {
    if (signal?.aborted) throw error;
    return { status: "failed" };
  }
  if (response.status === 401) return { status: "unauthorized" };
  if (!response.ok) return { status: "failed" };
  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    if (signal?.aborted) throw error;
    return { status: "failed" };
  }
  const parsed = researchTopicListSchema.safeParse(body);
  return parsed.success
    ? { status: "ok", value: parsed.data }
    : { status: "failed" };
}
