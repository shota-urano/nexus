import type { Database } from "../db/connection";
import { NexusError } from "../shared/errors";
import { newsIngest } from "./news/ingest";

// 種類の一覧（DD-01 M14。NFR-004）。種類ごとの操作を種類の値から引けるようにする。
// 共通の部分（M13、DD-02 3章 P08）は種類の値を直に分けず、この一覧から引く。
// 種類の値が正しいかもこの一覧で確かめる（DD-03 で `content.kind` に値の検査制約を置かない。RV16-05）。

// 形の正しい1件。見出しと検索の本文と、種類ごとの中身を残す処理を持つ。
export interface KindItem {
  // 同じ対象日で置き換える相手を決める値（ニュースは slug）。
  key: string;
  title: string;
  // 検索の本文（DD-02 3章 P08）。
  searchBody: string;
  insertDetail(db: Database, contentId: number): void;
  updateDetail(db: Database, contentId: number): void;
}

// 全体の形の確かめの結果。`date` は日付の項目（`today` のまま）か、断るときに分からなければ null。
export type KindBatchCheck =
  | { ok: true; date: string; items: unknown[] }
  | { ok: false; msg: "MSG-033"; field: string; date: string | null }
  | { ok: false; msg: "MSG-034"; date: string | null };

// 1件ごとの形の確かめの結果。断るときは、断った1件の名前（ニュースは slug）と外れた項目の名前。
export type KindItemCheck =
  { ok: true; item: KindItem } | { ok: false; label: string; field: string };

// 種類ごとの受け取りの操作。
export interface KindIngest {
  kind: string;
  // 同じ送信の中の重なりを見分ける項目の名前（MSG-033 に差し込む）。
  keyField: string;
  // 1件以上残したら、記事の関係の判定を待ちに入れるか。
  relatesAfterIngest: boolean;
  checkBatch(payload: unknown): KindBatchCheck;
  checkItem(raw: unknown): KindItemCheck;
  // 同じ対象日の同じ値の内容ID。無ければ null。
  findContentId(db: Database, date: string, key: string): number | null;
}

const KINDS: Readonly<Record<string, KindIngest>> = {
  [newsIngest.kind]: newsIngest satisfies KindIngest,
};

export function isKind(kind: string): boolean {
  return Object.hasOwn(KINDS, kind);
}

// 種類から受け取りの操作を引く。一覧に無い種類は E16（プログラムの不具合）として断る。
export function kindIngest(kind: string): KindIngest {
  if (!isKind(kind)) {
    throw new NexusError("INTERNAL", "種類の一覧に無い種類");
  }
  return KINDS[kind];
}
