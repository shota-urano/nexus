import { enqueueRelate } from "../ai-jobs";
import type { Database } from "../db/connection";
import { inWriteTransaction } from "../db/transaction";
import { kindIngest, type KindItem } from "../kinds";
import { insertContent, updateContentOnReplace } from "../repositories/content";
import {
  type DeliverySender,
  insertAcceptedDelivery,
  insertRejectedDelivery,
} from "../repositories/delivery";
import { replaceSearchIndexRow } from "../repositories/search-index";
import type { Clock } from "../shared/clock";
import { formatDate, formatDateTime } from "../shared/datetime";
import { NexusError } from "../shared/errors";
import type { Logger } from "../shared/logger";
import {
  formatMessage,
  type MessageId,
  type MessageValues,
} from "../shared/messages";

// 種類を問わない受け取り（DD-01 M13。DD-02 FN-001 手順 4〜7、3章 P08、DD-05 2章）。
// 受け取りの記録を残し（NFR-020）、同じ対象日の同じ内容を置き換え（NFR-015）、
// 同じ送信の中の重なりを見分ける。種類ごとの形の確かめと中身の残し方は M14 から引く。

export type IngestSender = DeliverySender;

export interface MessageRef {
  id: MessageId;
  values?: MessageValues;
}

// 受け取れなかった1件（`openapi.yaml` の `RejectedItem`）。
export interface RejectedItem {
  slug: string;
  reason: string;
}

export type IngestOutcome =
  | {
      ok: true;
      deliveryId: number;
      targetDate: string;
      receivedAt: string;
      itemCount: number;
      rejected: RejectedItem[];
    }
  // 全体の形か件数が正しくない（DD-02 FN-001 手順 4）。断った記録は作ってある。
  | { ok: false; message: MessageRef };

export interface Ingest {
  // 受け取る（DD-02 FN-001 手順 4〜7）。手順 7 の途中で失敗したら、断った記録を作ってから投げる。
  receive(sender: IngestSender, kind: string, payload: unknown): IngestOutcome;
  // 断った記録を、別のトランザクションで作る（DD-02 FN-001「結果とメッセージ」、DD-05 2章）。
  // 作れなくても投げず、ログに出す（DD-06 1章。応答は変えない）。
  recordRejected(
    sender: IngestSender,
    targetDate: string | null,
    message: MessageRef,
  ): void;
}

// 断った理由の文（MSG の番号と差し込んだ値。BD-07 ENT-010 断った理由）。
export function rejectionReason(message: MessageRef): string {
  const values = Object.entries(message.values ?? {});
  if (values.length === 0) return message.id;
  return `${message.id}（${values.map(([name, value]) => `${name}: ${value}`).join("、")}）`;
}

// 手順 7 の失敗の、MSG-045 に差し込む理由（DD-06 2章の分類名。内部の中身は入れない）。
export function failureReason(error: unknown): string {
  return error instanceof NexusError && error.code === "DB_UNAVAILABLE"
    ? "DB が使えない"
    : "予期しない失敗";
}

// 検索の本文（DD-02 3章 P08、DD-03 2.2）。見出しと種類の検索の本文を改行でつなぎ、
// NFKC で正規化して小文字にする。
export function searchIndexBody(title: string, searchBody: string): string {
  return `${title}\n${searchBody}`.normalize("NFKC").toLowerCase();
}

export function createIngest(deps: {
  db: Database;
  clock: Clock;
  logger: Logger;
}): Ingest {
  const { db, clock, logger } = deps;

  const recordRejected: Ingest["recordRejected"] = (
    sender,
    targetDate,
    message,
  ) => {
    try {
      inWriteTransaction(db, () =>
        insertRejectedDelivery(db, {
          sender,
          targetDate,
          receivedAt: formatDateTime(clock.now()),
          rejectionReason: rejectionReason(message),
        }),
      );
    } catch (error) {
      const code = error instanceof NexusError ? error.code : "INTERNAL";
      logger.log({
        level: "warn",
        code,
        detail: "断った受け取りの記録を作れない",
        error,
      });
    }
  };

  return {
    recordRejected,
    receive(sender, kind, payload) {
      const ops = kindIngest(kind);
      const now = clock.now();
      const today = formatDate(now);

      // 手順 4: 全体の形と件数。
      const batch = ops.checkBatch(payload);
      if (!batch.ok) {
        const message: MessageRef =
          batch.msg === "MSG-034"
            ? { id: "MSG-034" }
            : { id: "MSG-033", values: { 項目: batch.field } };
        const knownDate = batch.date === "today" ? today : batch.date;
        recordRejected(sender, knownDate, message);
        return { ok: false, message };
      }

      // 手順 5: `today` は日本時間の今日。
      const targetDate = batch.date === "today" ? today : batch.date;

      // 手順 6: 1件ごとの形と、同じ送信の中の2回目からの重なり。全てを確かめて集める。
      const kept: KindItem[] = [];
      const seen = new Set<string>();
      const rejected: RejectedItem[] = [];
      for (const raw of batch.items) {
        const checked = ops.checkItem(raw);
        // 2回目かどうかは、形の正否にかかわらず slug の初出で決める。
        const key = checked.ok ? checked.item.key : checked.label;
        const repeated = key !== "" && seen.has(key);
        if (key !== "") seen.add(key);
        if (!checked.ok) {
          rejected.push({
            slug: checked.label,
            reason: formatMessage("MSG-033", { 項目: checked.field }),
          });
          continue;
        }
        if (repeated) {
          rejected.push({
            slug: checked.item.key,
            reason: formatMessage("MSG-033", { 項目: ops.keyField }),
          });
          continue;
        }
        kept.push(checked.item);
      }

      // 手順 7: 1つのトランザクションで残す（DD-05 2章）。
      const receivedAt = formatDateTime(now);
      let deliveryId: number;
      try {
        deliveryId = inWriteTransaction(db, () => {
          const id = insertAcceptedDelivery(db, {
            sender,
            targetDate,
            receivedAt,
            itemCount: kept.length,
          });
          for (const item of kept) {
            const existing = ops.findContentId(db, targetDate, item.key);
            let contentId: number;
            if (existing === null) {
              contentId = insertContent(db, {
                kind: ops.kind,
                title: item.title,
                targetDate,
                receivedAt,
                deliveryId: id,
              });
              item.insertDetail(db, contentId);
            } else {
              contentId = existing;
              updateContentOnReplace(db, contentId, {
                title: item.title,
                receivedAt,
                deliveryId: id,
              });
              item.updateDetail(db, contentId);
            }
            replaceSearchIndexRow(
              db,
              contentId,
              searchIndexBody(item.title, item.searchBody),
            );
          }
          if (ops.relatesAfterIngest && kept.length > 0) {
            enqueueRelate(db, id, now);
          }
          return id;
        });
      } catch (error) {
        recordRejected(sender, targetDate, {
          id: "MSG-045",
          values: { 理由: failureReason(error) },
        });
        throw error;
      }

      return {
        ok: true,
        deliveryId,
        targetDate,
        receivedAt,
        itemCount: kept.length,
        rejected,
      };
    },
  };
}
