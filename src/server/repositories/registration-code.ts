import type { Database } from "../db/connection";

// ENT-012 登録コード（DD-03 `registration_code`）の読み書き（DD-01 M22）。
// 日時は同じ時差の形の文字なので、文字の比べで時刻を比べる（DD-03 1章）。

// 有効な期限を過ぎた（`expires_at` が今以前の）登録コードを消す。消した行の数を返す（DD-02 FN-023 手順 1）。
export function deleteExpiredRegistrationCodes(
  db: Database,
  now: string,
): number {
  return Number(
    db.prepare("DELETE FROM registration_code WHERE expires_at <= ?").run(now)
      .changes,
  );
}

export function insertRegistrationCode(
  db: Database,
  row: {
    codeHash: string;
    deviceName: string;
    issuedAt: string;
    expiresAt: string;
  },
): void {
  db.prepare(
    "INSERT INTO registration_code (code_hash, device_name, issued_at, expires_at) VALUES (?, ?, ?, ?)",
  ).run(row.codeHash, row.deviceName, row.issuedAt, row.expiresAt);
}

// 照合値が同じで `expires_at` が今より後の行を消し、その端末の名前を返す。
// 消した行が無ければ null（DD-02 FN-023 手順 2。DD-05 3章: 消した行の数で決める）。
export function consumeRegistrationCode(
  db: Database,
  codeHash: string,
  now: string,
): string | null {
  const row = db
    .prepare(
      "DELETE FROM registration_code WHERE code_hash = ? AND expires_at > ? RETURNING device_name",
    )
    .get(codeHash, now);
  return row === undefined ? null : String(row.device_name);
}
