import { type Home, homeSchema } from "../contracts/home";
import { deviceFetch } from "./device-api";

// 通信層 M09（DD-01 1.1）。ホームの表示（DD-04 `getHome`）を呼び、応答を M10 の形で確かめる。
// 結果は次の3つのどれかで返す。
// - ok: 応答の形が正しい
// - unauthorized: 401（MSG-020）。全面の知らせは M01 の枠が出す（deviceFetch が届け先に渡す）
// - failed: それ以外の失敗（つながらない、200 でない、形が違う）。画面は数の場所に MSG-019 を出す
// 呼んだ画面が止めた（AbortSignal）ときは、AbortError をそのまま投げる。

export type HomeResult =
  | { status: "ok"; value: Home }
  | { status: "unauthorized" }
  | { status: "failed" };

// `getHome`（FN-020）。
export async function fetchHome(
  request: { signal?: AbortSignal } = {},
): Promise<HomeResult> {
  const { signal } = request;
  let response: Response;
  try {
    response = await deviceFetch("/api/app/home", { signal });
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
  const parsed = homeSchema.safeParse(body);
  return parsed.success
    ? { status: "ok", value: parsed.data }
    : { status: "failed" };
}
