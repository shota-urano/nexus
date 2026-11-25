import type { Database } from "../db/connection";

// ENT-011 端末（DD-03 `device`）の読み書き（DD-01 M22）。

export interface DeviceRow {
  deviceId: number;
  deviceName: string;
  registeredAt: string;
  lastUsedAt: string;
}

// 鍵の照合値で端末を読む（一意の索引で引く。DD-02 3章 P05 手順 3）。無ければ null。
export function findDeviceByKeyHash(
  db: Database,
  keyHash: string,
): DeviceRow | null {
  const row = db
    .prepare(
      "SELECT device_id, device_name, registered_at, last_used_at FROM device WHERE device_key_hash = ?",
    )
    .get(keyHash);
  if (row === undefined) return null;
  return {
    deviceId: Number(row.device_id),
    deviceName: String(row.device_name),
    registeredAt: String(row.registered_at),
    lastUsedAt: String(row.last_used_at),
  };
}

// 最後に使った日時を変える。変えた行の数を返す（端末が消えていれば 0）。
export function updateDeviceLastUsedAt(
  db: Database,
  deviceId: number,
  at: string,
): number {
  const result = db
    .prepare("UPDATE device SET last_used_at = ? WHERE device_id = ?")
    .run(at, deviceId);
  return Number(result.changes);
}
