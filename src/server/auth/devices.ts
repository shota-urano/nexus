import { type Database, databasePath, openDatabase } from "../db/connection";
import { toDbError } from "../db/errors";
import { assertMigrationsApplied } from "../db/migrations";
import { inWriteTransaction } from "../db/transaction";
import {
  deleteDeviceByName,
  findDeviceByName,
  insertDevice,
  listDevices,
} from "../repositories/device";
import {
  consumeRegistrationCode,
  deleteExpiredRegistrationCodes,
  insertRegistrationCode,
} from "../repositories/registration-code";
import type { Clock } from "../shared/clock";
import { formatDateTime } from "../shared/datetime";
import { NexusError } from "../shared/errors";
import { formatMessage } from "../shared/messages";
import { createSecret, hashSecret } from "../shared/secret";

// 端末の登録と取り消し（DD-01 M12。DD-02 FN-023、3章 P05、DD-05 3章）。
// 登録コードと端末の鍵は作ったときに返すだけで、DB には照合値だけを置く。

// 登録コードが使えなくなるまでの時間（10 分。BD-10 T01、Q-079 の答え）。
export const REGISTRATION_CODE_TTL_MS = 10 * 60 * 1000;

export interface DeviceEntry {
  deviceName: string;
  registeredAt: string;
  lastUsedAt: string;
}

export type RegistrationResult =
  | { ok: true; deviceName: string; key: string }
  // invalid_code: 照合値が見つからない、使った、期限を過ぎた（DD-06 E03）。
  // name_taken: 同じ名前の端末がもうある（DD-06 E07）。どちらも MSG-021 にする。
  | { ok: false; reason: "invalid_code" | "name_taken" };

export interface Devices {
  // 登録コードを作る（FN-023 手順 1）。同じ名前の端末があれば E07（MSG-043）。
  add(deviceName: string): { code: string; expiresAt: string };
  // 端末の名前、登録した日時、最後に使った日時（FN-023 手順 3）。
  list(): DeviceEntry[];
  // 端末を消す（FN-023 手順 4）。無ければ E05（MSG-042）。
  revoke(deviceName: string): void;
  // 登録コードで端末を作り、端末の鍵を返す（FN-023 手順 2）。
  register(code: string): RegistrationResult;
}

export function deviceExistsMessage(deviceName: string): string {
  return formatMessage("MSG-043", { 端末の名前: deviceName });
}

export function unknownDeviceMessage(deviceName: string): string {
  return formatMessage("MSG-042", { 端末の名前: deviceName });
}

// 同じ名前の端末があるときに、登録の URL を開くトランザクションを戻すための印。
class NameTaken extends Error {}

export function createDevices(deps: { db: Database; clock: Clock }): Devices {
  const { db, clock } = deps;
  const withDb = <T>(fn: () => T): T => {
    try {
      return fn();
    } catch (error) {
      throw toDbError(error);
    }
  };
  return {
    add(deviceName) {
      const now = clock.now();
      const issuedAt = formatDateTime(now);
      const expiresAt = formatDateTime(
        new Date(now.getTime() + REGISTRATION_CODE_TTL_MS),
      );
      const code = createSecret();
      // 照合値を確定してから登録コードを返す（DD-05 5章）。
      inWriteTransaction(db, () => {
        deleteExpiredRegistrationCodes(db, issuedAt);
        if (findDeviceByName(db, deviceName) !== null) {
          throw new NexusError("RULE_VIOLATION", "同じ名前の端末がある", {
            msg: "MSG-043",
          });
        }
        insertRegistrationCode(db, {
          codeHash: hashSecret(code),
          deviceName,
          issuedAt,
          expiresAt,
        });
      });
      return { code, expiresAt };
    },
    list() {
      return withDb(() => listDevices(db)).map((row) => ({
        deviceName: row.deviceName,
        registeredAt: row.registeredAt,
        lastUsedAt: row.lastUsedAt,
      }));
    },
    revoke(deviceName) {
      if (withDb(() => deleteDeviceByName(db, deviceName)) === 0) {
        throw new NexusError("NOT_FOUND", "端末の名前が無い", {
          msg: "MSG-042",
        });
      }
    },
    register(code) {
      const now = formatDateTime(clock.now());
      const codeHash = hashSecret(code);
      try {
        // 1つのトランザクションでコードの行を消し、消した行の数で決める（DD-05 3章）。
        // 同じ URL を2台で開いたときは、先の1台だけが行を消せる。
        return inWriteTransaction(db, (): RegistrationResult => {
          const deviceName = consumeRegistrationCode(db, codeHash, now);
          if (deviceName === null) return { ok: false, reason: "invalid_code" };
          // 同じ名前の端末があれば戻す（端末と登録コードは変わらない。BD-02 FN-023 事後条件）。
          if (findDeviceByName(db, deviceName) !== null) throw new NameTaken();
          const key = createSecret();
          insertDevice(db, deviceName, hashSecret(key), now);
          return { ok: true, deviceName, key };
        });
      } catch (error) {
        if (error instanceof NameTaken) {
          return { ok: false, reason: "name_taken" };
        }
        throw error;
      }
    },
  };
}

// 管理のコマンドのプロセス（M30）が使う形。データの置き場所の DB を開き、
// マイグレーションの番号を確かめてから（DD-03 5章。違えば E17）、端末の部品を返す。
// 使い終わったら close で DB を閉じる。
export function openDevices(deps: {
  dataDir: string;
  clock: Clock;
}): Devices & { close(): void } {
  const db = openDatabase(databasePath(deps.dataDir));
  try {
    assertMigrationsApplied(db);
  } catch (error) {
    db.close();
    throw toDbError(error);
  }
  return {
    ...createDevices({ db, clock: deps.clock }),
    close: () => db.close(),
  };
}
