import type { Database } from "../../server/db/connection";
import { inWriteTransaction } from "../../server/db/transaction";
import { deleteAiRunsCreatedBefore } from "../../server/repositories/ai-run";
import { clearDeliveryIdsReceivedBefore } from "../../server/repositories/content";
import { deleteUnreferencedDeliveriesReceivedBefore } from "../../server/repositories/delivery";
import type { Clock } from "../../server/shared/clock";
import { formatDateTime } from "../../server/shared/datetime";

// BAT-002 古い記録の削除（DD-01 M29。DD-02 FN-022 手順 2〜3、DD-03 2.3、BD-02 5.3）。
// 境の日時（日本時間の今の1年前の同じ日時）より前の AI の実行と受け取りの記録を、1つのトランザクションで消す。
// 消す順は DD-03 2.3 のとおり（外部キーの削除を拒否にしているので、順を違えると消せずに止まる）。
// 失敗したら全てを戻して投げる。ログと終了コードは呼ぶ側の M27 が決める（MSG-040、MSG-041。DD-06 E08、E16）。

export interface RunPurgeDeps {
  db: Database;
  clock: Clock;
  // 試験で、受け取りの記録を消す直前に失敗を差し込むときに渡す（DD-10 TC92）。
  beforeDeleteDeliveries?: () => void;
}

export interface PurgeResult {
  // 境の日時（`YYYY-MM-DDTHH:MM:SS.sss+09:00`）。
  before: string;
  // 消した AI の実行の数（MSG-040 の件数1）。
  aiRuns: number;
  // 消した受け取りの記録の数（MSG-040 の件数2）。
  deliveries: number;
}

export function runPurge(deps: RunPurgeDeps): PurgeResult {
  const { db, clock } = deps;
  const before = oneYearBefore(formatDateTime(clock.now()));
  return inWriteTransaction(db, (): PurgeResult => {
    const aiRuns = deleteAiRunsCreatedBefore(db, before);
    clearDeliveryIdsReceivedBefore(db, before);
    deps.beforeDeleteDeliveries?.();
    const deliveries = deleteUnreferencedDeliveriesReceivedBefore(db, before);
    return { before, aiRuns, deliveries };
  });
}

// 日本時間の日時の文字の年を1つ戻す（DD-02 FN-022 手順 2）。
// 2月29日は前の年に無いので、2月28日の同じ時刻にする（境を早めに取り、消しすぎない側に倒す）。
// DD-02 FN-022 には閏日の定めが無い。この扱いは本人の決定（2026-11-25）による。
// DD-02 への追記は、本人が変更要求（CR）として別に起こして承認する。
export function oneYearBefore(dateTime: string): string {
  const year = Number(dateTime.slice(0, 4)) - 1;
  const rest = dateTime.slice(4);
  const adjusted =
    rest.startsWith("-02-29") && !isLeapYear(year)
      ? `-02-28${rest.slice(6)}`
      : rest;
  return `${String(year).padStart(4, "0")}${adjusted}`;
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}
