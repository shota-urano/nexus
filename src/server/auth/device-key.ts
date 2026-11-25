import type { Database } from "../db/connection";
import { toDbError } from "../db/errors";
import {
  findDeviceByKeyHash,
  updateDeviceLastUsedAt,
} from "../repositories/device";
import type { Clock } from "../shared/clock";
import { formatDateTime } from "../shared/datetime";
import { hashSecret } from "../shared/secret";

// 端末の鍵を確かめる（DD-01 M12。DD-02 3章 P01 手順 1、2）。
// 鍵そのものは残さず、照合値（M23）で `device` を引く。

export interface VerifiedDevice {
  deviceId: number;
  deviceName: string;
}

export type DeviceKeyResult =
  | {
      ok: true;
      device: VerifiedDevice;
      // 最後に使った日時を変えられなかったときの失敗。処理は続け、呼んだ側がログに出す（DD-06 1章）。
      lastUsedError?: unknown;
    }
  | {
      ok: false;
      // 鍵の照合値。E03 のログを同じ照合値で抑えるのに使う（DD-06 2章）。鍵が無ければ null。
      // ログにも応答にも出さない（DD-06 5章）。
      keyHash: string | null;
    };

export interface DeviceKeyVerifier {
  verify(key: string | null | undefined): DeviceKeyResult;
}

export function createDeviceKeyVerifier(deps: {
  db: Database;
  clock: Clock;
}): DeviceKeyVerifier {
  const { db, clock } = deps;
  return {
    verify(key) {
      if (key === null || key === undefined || key === "") {
        return { ok: false, keyHash: null };
      }
      const keyHash = hashSecret(key);
      let device;
      try {
        device = findDeviceByKeyHash(db, keyHash);
      } catch (error) {
        throw toDbError(error);
      }
      if (device === null) return { ok: false, keyHash };

      const verified = {
        deviceId: device.deviceId,
        deviceName: device.deviceName,
      };
      try {
        updateDeviceLastUsedAt(
          db,
          device.deviceId,
          formatDateTime(clock.now()),
        );
      } catch (error) {
        return { ok: true, device: verified, lastUsedError: toDbError(error) };
      }
      return { ok: true, device: verified };
    },
  };
}
