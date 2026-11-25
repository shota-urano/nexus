import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Database } from "../../../src/server/db/connection";
import {
  type Migration,
  MIGRATIONS_DIR,
  readMigrations,
} from "../../../src/server/db/migrations";
import type {
  KindBatchCheck,
  KindChat,
  KindIngest,
  KindItemCheck,
} from "../../../src/server/kinds";

// テストだけの3つ目の種類「メモ」（DD-10 TC110。NFR-004、DD-01 M14）。
// 新しい種類を足すときに足すもの（DD-01 M14）のうち、表示部品（M08）を除く全てをここに置く。
//   - 受け取りの形の確かめ（見出しと、検索の本文と、種類ごとの中身を返す）
//   - 種類ごとの中身を残す・読む処理（`memo` のテーブル）
//   - AI に渡す内容の組み立て
//   - 種類ごとの中身のテーブルを作るマイグレーション（`memo-kind.sql`）
// 一覧への登録は、テストが M14 の `registerKind` で行う。
// 届いた形: `{ "date": "YYYY-MM-DD" | "today", "items": [{ "key", "title", "bodyMd" }] }`。

export const MEMO_KIND = "memo";

const DATE_PATTERN = /^(?:today|[0-9]{4}-[0-9]{2}-[0-9]{2})$/;

// 本番のマイグレーションの後に当てる、メモの中身のテーブルを作るマイグレーション。
export function memoMigrations(): Migration[] {
  const known = readMigrations(MIGRATIONS_DIR);
  const version = known.length + 1;
  return [
    ...known,
    {
      version,
      name: `${String(version).padStart(4, "0")}-test-memo-kind.sql`,
      sql: readFileSync(join(import.meta.dirname, "memo-kind.sql"), "utf8"),
    },
  ];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

export const memoIngest: KindIngest = {
  kind: MEMO_KIND,
  keyField: "key",
  relatesAfterIngest: false,
  checkBatch(payload): KindBatchCheck {
    if (!isRecord(payload)) {
      return { ok: false, msg: "MSG-033", field: "date", date: null };
    }
    const { date, items } = payload;
    if (typeof date !== "string" || !DATE_PATTERN.test(date)) {
      return { ok: false, msg: "MSG-033", field: "date", date: null };
    }
    if (!Array.isArray(items)) {
      return { ok: false, msg: "MSG-033", field: "items", date };
    }
    if (items.length === 0) return { ok: false, msg: "MSG-034", date };
    return { ok: true, date, items };
  },
  checkItem(raw): KindItemCheck {
    const label = isRecord(raw) && typeof raw.key === "string" ? raw.key : "";
    if (!isRecord(raw) || !nonEmptyString(raw.key)) {
      return { ok: false, label, field: "key" };
    }
    if (!nonEmptyString(raw.title) || /[\r\n]/u.test(raw.title)) {
      return { ok: false, label, field: "title" };
    }
    if (!nonEmptyString(raw.bodyMd)) {
      return { ok: false, label, field: "bodyMd" };
    }
    const key = raw.key;
    const bodyMd = raw.bodyMd;
    return {
      ok: true,
      item: {
        key,
        title: raw.title,
        searchBody: bodyMd,
        insertDetail(db, contentId) {
          db.prepare(
            "INSERT INTO memo (content_id, memo_key, body_md) VALUES (?, ?, ?)",
          ).run(contentId, key, bodyMd);
        },
        updateDetail(db, contentId) {
          db.prepare("UPDATE memo SET body_md = ? WHERE content_id = ?").run(
            bodyMd,
            contentId,
          );
        },
      },
    };
  },
  findContentId(db, date, key) {
    const row = db
      .prepare(
        "SELECT c.content_id FROM content c JOIN memo m ON m.content_id = c.content_id WHERE c.kind = ? AND c.target_date = ? AND m.memo_key = ?",
      )
      .get(MEMO_KIND, date, key) as { content_id: number } | undefined;
    return row === undefined ? null : Number(row.content_id);
  },
};

// メモの中身を読む。無ければ null。
export function findMemo(
  db: Database,
  contentId: number,
): { title: string; bodyMd: string } | null {
  const row = db
    .prepare(
      "SELECT c.title, m.body_md FROM content c JOIN memo m ON m.content_id = c.content_id WHERE c.content_id = ?",
    )
    .get(contentId) as { title: string; body_md: string } | undefined;
  return row === undefined ? null : { title: row.title, bodyMd: row.body_md };
}

export const memoChat: KindChat = {
  kind: MEMO_KIND,
  buildAnswerMaterial(db: Database, contentId: number) {
    const memo = findMemo(db, contentId);
    if (memo === null) return null;
    return ["種類: メモ", `見出し: ${memo.title}`, "本文:", memo.bodyMd].join(
      "\n",
    );
  },
};
