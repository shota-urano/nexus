import type { Database } from "../db/connection";
import { NexusError } from "../shared/errors";
import { englishChat } from "./english/chat";
import { englishIngest } from "./english/ingest";
import { newsChat } from "./news/chat";
import { newsIngest } from "./news/ingest";

// 種類の一覧（DD-01 M14。NFR-004）。種類ごとの操作を種類の値から引けるようにする。
// 共通の部分（M13、DD-02 3章 P08）は種類の値を直に分けず、この一覧から引く。
// 種類の値が正しいかもこの一覧で確かめる（DD-03 で `content.kind` に値の検査制約を置かない。RV16-05）。

// 形の正しい1件。見出しと検索の本文と、種類ごとの中身を残す処理を持つ。
export interface KindItem {
  // 同じ対象日で置き換える相手を決める値（ニュースは slug。英語は日付だけで決まるので空の文字）。
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
  // `rawBody` は届いた本文の文字（原文を残す種類が使う。DD-02 FN-007 手順 4.3）。
  checkBatch(payload: unknown, rawBody?: string): KindBatchCheck;
  checkItem(raw: unknown): KindItemCheck;
  // 同じ対象日の同じ値の内容ID。無ければ null（英語は日付だけで決まる）。
  findContentId(db: Database, date: string, key: string): number | null;
}

const KINDS = new Map<string, KindIngest>([
  [newsIngest.kind, newsIngest satisfies KindIngest],
  [englishIngest.kind, englishIngest satisfies KindIngest],
]);

export function isKind(kind: string): boolean {
  return KINDS.has(kind);
}

// 種類から受け取りの操作を引く。一覧に無い種類は E16（プログラムの不具合）として断る。
export function kindIngest(kind: string): KindIngest {
  const ops = KINDS.get(kind);
  if (ops === undefined) {
    throw new NexusError("INTERNAL", "種類の一覧に無い種類");
  }
  return ops;
}

// 質問の対象（`question_target_json`。BD-07 4.1）。種類ごとの組み立てが使う項目。
export interface ChatTarget {
  kind: string;
  contentId: number;
  phrase?: string;
  sentence?: string;
  position?: {
    part?: string;
    paragraphIndex?: number;
    sentenceIndex?: number;
    problemNo?: number;
  };
}

// 種類ごとの AI チャットに渡す内容の組み立て（DD-02 3章 P07 手順 3。BD-02 FN-015 業務ルール）。
export interface KindChat {
  kind: string;
  // 対象の内容の読む材料の文。内容が無ければ null。
  buildAnswerMaterial(
    db: Database,
    contentId: number,
    target: ChatTarget,
  ): string | null;
}

const CHAT_KINDS = new Map<string, KindChat>([
  [newsChat.kind, newsChat satisfies KindChat],
  [englishChat.kind, englishChat satisfies KindChat],
]);

// 種類から AI チャットに渡す内容の組み立てを引く。一覧に無い種類は E16（プログラムの不具合）として断る。
export function kindChat(kind: string): KindChat {
  const ops = CHAT_KINDS.get(kind);
  if (ops === undefined) {
    throw new NexusError("INTERNAL", "種類の一覧に無い種類");
  }
  return ops;
}

// 種類を一覧に登録する（DD-01 M14 の「この一覧への登録」）。受け取りの操作と、AI チャットに渡す内容の
// 組み立ての種類の値は同じでなければならない。同じ値の種類がもうあれば E16 として断る。
// 本番の種類（ニュースと英語）は上の一覧に書く。これは種類を足しても共通の部分を変えずに動くことを
// 確かめるテスト（DD-10 TC110。NFR-004）が、テストだけの種類を登録するために使う。
export function registerKind(ingest: KindIngest, chat: KindChat): void {
  if (ingest.kind !== chat.kind || ingest.kind === "") {
    throw new NexusError("INTERNAL", "登録する種類の値がそろっていない");
  }
  if (KINDS.has(ingest.kind) || CHAT_KINDS.has(chat.kind)) {
    throw new NexusError("INTERNAL", "種類の一覧にもうある種類");
  }
  KINDS.set(ingest.kind, ingest);
  CHAT_KINDS.set(chat.kind, chat);
}
