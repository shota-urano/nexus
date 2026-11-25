import { createHash, randomBytes } from "node:crypto";

// 乱数と照合値（DD-02 3章 P05。BD-10 4章 秘密情報の管理）。
// 乱数と照合値は、この関数だけで作る（DD-01 3章）。

// 32 バイトの乱数を base64url（43 文字）にする。端末の鍵、登録コード、配信元の鍵に使う。
export function createSecret(): string {
  return randomBytes(32).toString("base64url");
}

// 照合値: 鍵の文字の SHA-256 を16進の小文字（64 文字）にする。ストレッチは使わない（P05）。
export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

// 要求ごとの番号: 乱数の16進8文字（DD-06 5章 `requestId`）。
export function createRequestId(): string {
  return randomBytes(4).toString("hex");
}
