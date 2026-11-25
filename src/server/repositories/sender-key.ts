import type { Database } from "../db/connection";

// ENT-012 配信元の鍵（DD-03 `sender_key`）の読み書き（DD-01 M22）。

export interface SenderKeyRow {
  sender: string;
  issuedAt: string;
}

// 鍵の照合値で配信元を読む（一意の索引で引く。DD-02 3章 P05 手順 3）。無ければ null。
export function findSenderByKeyHash(
  db: Database,
  keyHash: string,
): string | null {
  const row = db
    .prepare("SELECT sender FROM sender_key WHERE key_hash = ?")
    .get(keyHash);
  return row === undefined ? null : String(row.sender);
}

// 配信元の鍵を置き換える（無ければ作る）。1つの文で行う（DD-02 FN-024 手順 1）。
export function upsertSenderKey(
  db: Database,
  sender: string,
  keyHash: string,
  issuedAt: string,
): void {
  db.prepare(
    "INSERT INTO sender_key (sender, key_hash, issued_at) VALUES (?, ?, ?) " +
      "ON CONFLICT (sender) DO UPDATE SET key_hash = excluded.key_hash, issued_at = excluded.issued_at",
  ).run(sender, keyHash, issuedAt);
}

// 配信元と用意した日時の一覧（配信元の名前の順）。照合値は読まない（DD-02 FN-024 手順 2）。
export function listSenderKeys(db: Database): SenderKeyRow[] {
  return db
    .prepare("SELECT sender, issued_at FROM sender_key ORDER BY sender")
    .all()
    .map((row) => ({
      sender: String(row.sender),
      issuedAt: String(row.issued_at),
    }));
}

// 配信元の鍵を消す。消した行の数を返す。
export function deleteSenderKey(db: Database, sender: string): number {
  return Number(
    db.prepare("DELETE FROM sender_key WHERE sender = ?").run(sender).changes,
  );
}
