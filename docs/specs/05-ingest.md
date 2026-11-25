---
status: confirmed
範囲: ニュースと英語のセットの受け取り（IF-001、IF-002）、sharpen が読む API（IF-003）、配信元の鍵の入口（P02）
---

# 05. 配信の受け取りと答えの提供 仕様

**親**: [`00-overview.md`](./00-overview.md) ｜ **担当**: Backend ｜ **範囲**: ニュースと英語のセットの受け取り（IF-001、IF-002）、sharpen が読む API（IF-003）、配信元の鍵の入口（P02）

設計の正本は `docs/upstream/` の上流工程の書類である。この仕様書は、DD-11 実装単位一覧が書き出した実装への引き渡しで、設計の中身を書き写さず、書類と節で指す。

## 1. 目的

brain-harness と sharpen から届く内容を受け取って残し（FN-001、FN-007）、sharpen に答えを返す（FN-013）。

## 2. 入出力

入力: IF-001、IF-002 の本文と配信元の鍵。出力: DD-04 `postNewsBatch`、`postEnglishSet`、`getEnglishSetForSender`、`getEnglishResult` の応答。

## 3. 処理詳細

- DD-02 FN-001、FN-007、FN-013、3章 P02、P08。
- 受け取りの共通の部分と種類ごとの部分: DD-01 M13〜M16（NFR-004）。
- 排他と冪等性: DD-05 3章、4章。

## 4. 設定値・確定値

- IF-001 は 1 MiB、100 件まで。IF-002 は 256 KiB、問題 60 問まで（BD-06 3.2）。
- 同じ対象日の同じ slug、同じ日付のセットは置き換える（NFR-015）。
- 道と応答の形は今の cerebellum に合わせる（Q-039 の答え。DD-04 2章）。

## 5. インターフェース

DD-04 `postNewsBatch`、`postEnglishSet`、`getEnglishSetForSender`、`getEnglishResult`（`docs/api/openapi.yaml`）。

## 6. エラー処理

DD-06 E01、E02、E03、E05、E08、E16。

## 7. スコープ外

配信元（brain-harness、sharpen）の改修（13-release.md の人の行）。

## 8. 関連仕様

- [`00-overview.md`](./00-overview.md)
- [`03-auth-and-admin.md`](./03-auth-and-admin.md)
- [`04-ai-runner.md`](./04-ai-runner.md)
- [`07-contents.md`](./07-contents.md)

## 9. 実装単位

- [x] [Backend] 配信元の鍵の入口 P02 と、ニュースの受け取り（M13 の共通の受け取り、M14 の種類の一覧、M15 の形の確かめ、P08 の検索の索引、記事の関係の判定の待ち）の `postNewsBatch` を作る（FN-001、IF-001、DD-02 FN-001・3章 P02・P08、DD-05 2章）（se/05-ingest）
  - 受け入れ基準: DD-10 TC01、DD-10 TC02、DD-10 TC03、DD-10 TC04、DD-10 TC05、DD-10 TC06、DD-10 TC07、DD-10 TC08、DD-10 TC09、DD-10 TC99、DD-10 TC120 が通る
- [x] [Backend] 英語のセットの受け取り（M16 の形の確かめと置き換え）の `postEnglishSet` を作る（FN-007、IF-002、DD-01 M13、DD-01 M16、DD-02 FN-007）（se/05-ingest）
  - 受け入れ基準: DD-10 TC30、DD-10 TC31、DD-10 TC32、DD-10 TC33、DD-10 TC34、DD-10 TC119、DD-10 TC121 が通る
- [x] [Backend] sharpen が読む `getEnglishSetForSender` と `getEnglishResult` を作る（FN-013、IF-003、DD-01 M16、DD-02 FN-013）（se/05-ingest）
  - 受け入れ基準: DD-10 TC35、DD-10 TC36、DD-10 TC37 が通る
