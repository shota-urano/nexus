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

// 名前で端末を読む。無ければ null。
export function findDeviceByName(
  db: Database,
  deviceName: string,
): DeviceRow | null {
  const row = db
    .prepare(
      "SELECT device_id, device_name, registered_at, last_used_at FROM device WHERE device_name = ?",
    )
    .get(deviceName);
  if (row === undefined) return null;
  return {
    deviceId: Number(row.device_id),
    deviceName: String(row.device_name),
    registeredAt: String(row.registered_at),
    lastUsedAt: String(row.last_used_at),
  };
}

// 端末を作る（`registered_at` と `last_used_at` は同じ今。DD-02 FN-023 手順 2）。
export function insertDevice(
  db: Database,
  deviceName: string,
  keyHash: string,
  at: string,
): void {
  db.prepare(
    "INSERT INTO device (device_name, device_key_hash, registered_at, last_used_at) VALUES (?, ?, ?, ?)",
  ).run(deviceName, keyHash, at, at);
}

// 端末の一覧（名前の順）。照合値は読まない（DD-02 FN-023 手順 3）。
export function listDevices(db: Database): DeviceRow[] {
  return db
    .prepare(
      "SELECT device_id, device_name, registered_at, last_used_at FROM device ORDER BY device_name",
    )
    .all()
    .map((row) => ({
      deviceId: Number(row.device_id),
      deviceName: String(row.device_name),
      registeredAt: String(row.registered_at),
      lastUsedAt: String(row.last_used_at),
    }));
}

// 名前で端末を消す。消した行の数を返す（DD-02 FN-023 手順 4）。
export function deleteDeviceByName(db: Database, deviceName: string): number {
  return Number(
    db.prepare("DELETE FROM device WHERE device_name = ?").run(deviceName)
      .changes,
  );
}
