import { z } from "zod";
import {
  type EnglishAnswer,
  type EnglishSetDetail,
  type EnglishSetPage,
  type PutEnglishAnswerBody,
  englishAnswerSchema,
  englishSetDetailSchema,
  englishSetPageSchema,
} from "../contracts/english";
import { deviceFetch } from "./device-api";

// 通信層 M09（DD-01 1.1）。英語の教材の端末の API を呼び、応答を M10 の形で確かめる
// （DD-04 `listEnglishSets`、`getEnglishSet`、`markOpened`、`putEnglishAnswer`）。
// 読む API の結果は次の3つのどれかで返す。
// - ok: 応答の形が正しい
// - unauthorized: 401（MSG-020）。全面の知らせは M01 の枠が出す（deviceFetch が届け先に渡す）
// - failed: それ以外の失敗（つながらない、404、200 でない、形が違う）。画面は MSG-019 を出す
// 呼んだ画面が止めた（AbortSignal）ときは、AbortError をそのまま投げる。

export type FetchResult<T> =
  | { status: "ok"; value: T }
  | { status: "unauthorized" }
  | { status: "failed" };

interface Schema<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
}

async function getJson<T>(
  path: string,
  schema: Schema<T>,
  signal: AbortSignal | undefined,
): Promise<FetchResult<T>> {
  let response: Response;
  try {
    response = await deviceFetch(path, { signal });
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
  const parsed = schema.safeParse(body);
  return parsed.success
    ? { status: "ok", value: parsed.data }
    : { status: "failed" };
}

// `listEnglishSets`（FN-008）。教材を対象日の新しい順に読む。続きは前のページの `nextCursor` で読む。
export function fetchEnglishSets(
  request: { cursor?: string | null; signal?: AbortSignal } = {},
): Promise<FetchResult<EnglishSetPage>> {
  const params = new URLSearchParams();
  if (request.cursor) params.set("cursor", request.cursor);
  const query = params.toString();
  const path = "/api/app/english/sets";
  return getJson(
    query === "" ? path : `${path}?${query}`,
    englishSetPageSchema,
    request.signal,
  );
}

// `getEnglishSet`（FN-009）。教材と、前に完了した答えを読む。
export function fetchEnglishSet(
  contentId: number,
  signal?: AbortSignal,
): Promise<FetchResult<EnglishSetDetail>> {
  return getJson(
    `/api/app/english/sets/${contentId}`,
    englishSetDetailSchema,
    signal,
  );
}

// `markOpened`（FN-009 手順 4）。初めて開いた日時を残す。失敗しても画面は教材を出したままにし、
// 知らせを出さない（DD-02 FN-004 手順 4 と同じ。次に開いたときにもう一度呼ぶ）ので、結果は返さない。
export async function markOpened(contentId: number): Promise<void> {
  try {
    await deviceFetch(`/api/app/contents/${contentId}/opened`, {
      method: "POST",
    });
  } catch {
    // 知らせを出さない。
  }
}

// `putEnglishAnswer`（FN-012）の結果。
// - ok: 残した答え（200 で、応答の形が正しい）
// - unauthorized: 401（MSG-020）。全面の知らせは M01 の枠が出す
// - ungraded: 400 で MSG-005（○△× の無い問題か、セットに無い問題番号がある。DD-04 3.4）
// - failed: それ以外の失敗（つながらない、ほかの 400、403、404、500、形が違う）。画面は MSG-007 を出す
//   （DD-04 3.2、3.4。DD-02 2章 C03）。自動では送り直さない。
export type PutEnglishAnswerResult =
  | { status: "ok"; value: EnglishAnswer }
  | { status: "unauthorized" }
  | { status: "ungraded" }
  | { status: "failed" };

async function messageIdOf(response: Response): Promise<string | null> {
  try {
    const parsed = errorBodySchema.safeParse(await response.json());
    return parsed.success ? parsed.data.error.messageId : null;
  } catch {
    return null;
  }
}

const errorBodySchema = z.object({
  error: z.object({ messageId: z.string() }),
});

// `putEnglishAnswer`（FN-012）。答えと採点を残して完了する。前の答えは置き換える。
export async function putEnglishAnswer(
  contentId: number,
  body: PutEnglishAnswerBody,
): Promise<PutEnglishAnswerResult> {
  let response: Response;
  try {
    response = await deviceFetch(`/api/app/english/sets/${contentId}/answer`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return { status: "failed" };
  }
  if (response.status === 401) return { status: "unauthorized" };
  if (response.status === 400) {
    return (await messageIdOf(response)) === "MSG-005"
      ? { status: "ungraded" }
      : { status: "failed" };
  }
  if (!response.ok) return { status: "failed" };
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    return { status: "failed" };
  }
  const parsed = englishAnswerSchema.safeParse(json);
  return parsed.success
    ? { status: "ok", value: parsed.data }
    : { status: "failed" };
}
