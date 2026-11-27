---
status: confirmed
範囲: DD-03 の全てのテーブル、制約、索引を作るマイグレーション
---

# 02. データの物理の形 仕様

**親**: [`00-overview.md`](./00-overview.md) ｜ **担当**: Backend ｜ **範囲**: DD-03 の全てのテーブル、制約、索引を作るマイグレーション

設計の正本は `docs/upstream/` の上流工程の書類である。この仕様書は、DD-11 実装単位一覧が書き出した実装への引き渡しで、設計の中身を書き写さず、書類と節で指す。

## 1. 目的

BD-07 のエンティティ ENT-001〜ENT-013 と、検索の索引、マイグレーションの記録のテーブルを、DD-03 のとおりに作る。

## 2. 入出力

入力: 無し。出力: `src/server/db/migrations/0001-*.sql`。

## 3. 処理詳細

- テーブル、カラム、制約: DD-03 2.2。
- 制約で守らない規則（業務層で守る）: DD-03 2.3。各仕様書の行が守る。
- 索引: DD-03 3章。

## 4. 設定値・確定値

- 全てのテーブルを STRICT にする（DD-03 1章）。
- 外部キーの削除と更新は全て拒否にする（DD-03 1章）。

## 5. インターフェース

無し（テーブルの読み書きは、使う仕様書の行で M22 に足す）。

## 6. エラー処理

マイグレーションが当たらなければ Web サーバは動き出さない（DD-06 E17）。

## 7. スコープ外

テーブルの読み書きの関数（M22）は、使う仕様書の行で作る。

## 8. 関連仕様

- [`00-overview.md`](./00-overview.md)
- [`01-foundation.md`](./01-foundation.md)
- [`03-auth-and-admin.md`](./03-auth-and-admin.md)

## 9. 実装単位

- [x] [Backend] マイグレーション 0001 で、DD-03 2.2 の16のテーブル（`search_index` は FTS5 の trigram）と、3章の全ての索引を作る（ENT-001〜ENT-013、DD-03）（se/02-data-model）
  - 受け入れ基準: 空の DB に当てると DD-03 2.1 の16のテーブルと、3章の22の索引（主キーと FTS5 の索引を除く）ができる; `PRAGMA foreign_key_check` が行を返さず、`PRAGMA integrity_check` が ok を返す; `content.kind` に空の文字を入れる、`ai_run` の目的が answer で `reply_message_id` が空、`message` の話し手が owner で `reply_state` がある、のどれも挿入が拒まれる
- [x] [Backend] マイグレーション `0002-research-report.sql`（`delivery` と `sender_key` を `sender` の検査制約に `brain-research` を足して作り直し、`research_topic`、`research_report` と `research_report_week_uq`、`research_topic_received_ix` を作る）と、M21 の外部キーの検査を止めて当てる扱い（1行目の `-- nexus:foreign-keys-off`、確定の前の `PRAGMA foreign_key_check`、終わったら ON に戻す）を作る（ENT-014、ENT-015、DD-01 M21、DD-03 2.2・3章・5章、CR-020）（se/02-data-model-2）
  - 受け入れ基準: DD-10 TC149 が通る
