import type { Database } from "../db/connection";
import { toDbError } from "../db/errors";
import {
  deleteSenderKey,
  findSenderByKeyHash,
  listSenderKeys,
  upsertSenderKey,
} from "../repositories/sender-key";
import type { Clock } from "../shared/clock";
import { formatDateTime } from "../shared/datetime";
import { NexusError } from "../shared/errors";
import { formatMessage } from "../shared/messages";
import { createSecret, hashSecret } from "../shared/secret";

// 配信元の鍵を作り、照合値で確かめ、取り消す（DD-01 M12。DD-02 FN-024、3章 P02 手順 1・2、P05）。
// 鍵そのものは作ったときに返すだけで、残さない。

// 配信元と、その鍵で使える連携（BD-07 4.2。NFR-014）。並びは BD-07 4.2 の並び順。
export const SENDER_INTERFACES = {
  "brain-harness": ["IF-001"],
  sharpen: ["IF-002", "IF-003"],
} as const satisfies Record<string, readonly string[]>;

export type Sender = keyof typeof SENDER_INTERFACES;
export type SenderInterface = (typeof SENDER_INTERFACES)[Sender][number];

export const SENDERS = Object.keys(SENDER_INTERFACES) as Sender[];

export function isSender(value: string): value is Sender {
  return Object.hasOwn(SENDER_INTERFACES, value);
}

export interface SenderKeyEntry {
  sender: Sender;
  issuedAt: string;
}

export interface SenderKeys {
  // 鍵を作り、置き換える（無ければ作る）。鍵を1回だけ返す（FN-024 手順 1）。
  issue(sender: string): { sender: Sender; key: string };
  // 配信元と用意した日時。鍵と照合値は返さない（FN-024 手順 2）。
  list(): SenderKeyEntry[];
  // 鍵を消す（FN-024 手順 3）。
  revoke(sender: string): void;
  // 鍵と使う連携から配信元を確かめる（P02 手順 1・2）。通らなければ null。
  verify(
    key: string | null | undefined,
    usedInterface: SenderInterface,
  ): Sender | null;
}

// 配信元の名前が値に無いときの E07（MSG-044。DD-06 2章）。
function unknownSender(): NexusError {
  return new NexusError("RULE_VIOLATION", "配信元の名前が値に無い", {
    msg: "MSG-044",
  });
}

function assertSender(sender: string): asserts sender is Sender {
  if (!isSender(sender)) throw unknownSender();
}

// MSG-044 の文言（差し込む値は、指定した名前と BD-07 4.2 の配信元の値）。
export function unknownSenderMessage(sender: string): string {
  return formatMessage("MSG-044", {
    配信元: sender,
    配信元の一覧: SENDERS.join("、"),
  });
}

export function createSenderKeys(deps: {
  db: Database;
  clock: Clock;
}): SenderKeys {
  const { db, clock } = deps;
  const withDb = <T>(fn: () => T): T => {
    try {
      return fn();
    } catch (error) {
      throw toDbError(error);
    }
  };
  return {
    issue(sender) {
      assertSender(sender);
      const key = createSecret();
      const issuedAt = formatDateTime(clock.now());
      // 照合値を確定してから鍵を返す（DD-05 5章）。
      withDb(() => upsertSenderKey(db, sender, hashSecret(key), issuedAt));
      return { sender, key };
    },
    list() {
      return withDb(() => listSenderKeys(db)).flatMap((row) =>
        isSender(row.sender)
          ? [{ sender: row.sender, issuedAt: row.issuedAt }]
          : [],
      );
    },
    revoke(sender) {
      assertSender(sender);
      withDb(() => deleteSenderKey(db, sender));
    },
    verify(key, usedInterface) {
      if (key === null || key === undefined || key === "") return null;
      const sender = withDb(() => findSenderByKeyHash(db, hashSecret(key)));
      if (sender === null || !isSender(sender)) return null;
      const allowed: readonly string[] = SENDER_INTERFACES[sender];
      return allowed.includes(usedInterface) ? sender : null;
    },
  };
}
