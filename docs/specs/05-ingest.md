---
status: confirmed
範囲: ニュースと英語のセットの受け取り（IF-001、IF-002）、sharpen が読む API（IF-003）、配信元の鍵の入口（P02）、週報の受け取り（IF-005）と送信のコマンド（FN-028）
---

# 05. 配信の受け取りと答えの提供 仕様

**親**: [`00-overview.md`](./00-overview.md) ｜ **担当**: Backend ｜ **範囲**: ニュースと英語のセットの受け取り（IF-001、IF-002）、sharpen が読む API（IF-003）、配信元の鍵の入口（P02）、週報の受け取り（IF-005）と送信のコマンド（FN-028）

設計の正本は `docs/upstream/` の上流工程の書類である。この仕様書は、DD-11 実装単位一覧が書き出した実装への引き渡しで、設計の中身を書き写さず、書類と節で指す。

## 1. 目的

brain-harness と sharpen から届く内容を受け取って残し（FN-001、FN-007）、sharpen に答えを返す（FN-013）。brain-harness の研究ループ（配信元 brain-research）が送る調査の週報を受け取り（FN-025）、送り手が使う送信のコマンドを配る（FN-028。CR-020）。

## 2. 入出力

入力: IF-001、IF-002、IF-005 の本文と配信元の鍵。送信のコマンドの引数とファイル。出力: DD-04 `postNewsBatch`、`postEnglishSet`、`getEnglishSetForSender`、`getEnglishResult`、`postResearchReport` の応答。送信のコマンドの出力と終了コード。

## 3. 処理詳細

- DD-02 FN-001、FN-007、FN-013、FN-025、FN-028、3章 P02、P08。送信のコマンドの置き場所と環境変数: DD-09 2.7。
- 受け取りの共通の部分と種類ごとの部分: DD-01 M13〜M16（NFR-004）。
- 排他と冪等性: DD-05 3章、4章。

## 4. 設定値・確定値

- IF-001 は 1 MiB、100 件まで。IF-002 は 256 KiB、問題 60 問まで（BD-06 3.2）。IF-005 は 256 KiB まで、方法の件数の上限は無い（CR-024 で外した。Q-099 の答え）、欄ごとの上限は Q-096 の答え（BD-06 IF-005 3.2）。段の欄（`steps` 30 件、段の `title` 200 文字、`stepChangesMd` 4 KiB）は Q-098、Q-100 の答え（CR-024）。
- 同じ対象日の同じ slug、同じ日付のセットは置き換える（NFR-015）。
- 道と応答の形は今の cerebellum に合わせる（Q-039 の答え。DD-04 2章）。

## 5. インターフェース

DD-04 `postNewsBatch`、`postEnglishSet`、`getEnglishSetForSender`、`getEnglishResult`、`postResearchReport`（`docs/api/openapi.yaml`）。送信のコマンド `nexus-send`（DD-09 2.7）。

## 6. エラー処理

DD-06 E01、E02、E03、E05、E08、E16、E18。MSG-046、MSG-049、MSG-050（CR-020）。

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
- [x] [Backend] 週報の受け取り `postResearchReport` を作り、`docs/api/openapi.yaml` に `postResearchReport`（`/api/research/reports`）と、その求めと応答の schema（`ResearchReportPayload`、`ApproachPayload`、`ResearchReportResult`、`ResearchStatus`、`ApproachMark`）を足す（DD-04 の定義どおり。CR-021）。M10 に IF-005 の本文の形 `ResearchReportPayload`（Q-096 の答えの上限）を置き、M14 の種類の一覧に research（M33）を登録し、M33 で形の確かめ、研究課題と週報の作成と置き換え、検索の本文（課題名、現時点の答え、方法の見出し）を作る（FN-025、IF-005、DD-01 M10・M13・M14・M33、DD-02 FN-025・3章 P02・P08、DD-05 3章、CR-020）（se/05-ingest-2）
  - 受け入れ基準: DD-10 TC130、DD-10 TC131、DD-10 TC132、DD-10 TC133、DD-10 TC134、DD-10 TC135、DD-10 TC136、DD-10 TC137、DD-10 TC102 が通る
- [x] [Backend] 送信のコマンド M34 `nexus-send`（引数とファイルと環境変数の確かめ、M10 の `ResearchReportPayload` での形の確かめ、IF-005 への送信、終了コード）と、`npm run build` で `dist/cli/send/main.js` を作ることと、`deploy/nexus-send` の雛形を作る（FN-028、DD-01 M34、DD-02 FN-028、DD-06 E18、DD-09 2.7、CR-020）（se/05-ingest-2）
  - 受け入れ基準: DD-10 TC146、DD-10 TC147、DD-10 TC148 が通る; `deploy/nexus-send` の雛形に、Node.js の道と `dist/cli/send/main.js` の道を書き込む場所がある
- [ ] [Backend] 週報の受け取りに段の欄を足す。M10 の `ResearchReportPayload` に任意の `steps`（`no`、`title`、`status`）、`stepChangesMd`、方法の任意の `no`、`step` を足し、段の欄のつながり（段と方法の番号の重なり、`current` は1つまで、`step` は `steps` にある段、`steps` が無いのに `step` を書かない）を確かめ、方法の件数の上限を外す。M33 は `steps_json`、`step_changes_md` を残す。`docs/api/openapi.yaml` の `ResearchReportPayload`、`ApproachPayload` に同じ項目を足し、`approaches` の `maxItems` を外す。欄の無い今の形の週報は今までどおり受ける（FN-025、IF-005、DD-01 M10・M33、DD-02 FN-025・2章 C10、DD-03 2.2、DD-04、Q-098〜Q-100、Q-103、CR-024）
  - 受け入れ基準: DD-10 TC151、DD-10 TC134 が通る; DD-10 TC130、TC131、TC132、TC133、TC135、TC102 が通るまま; `nexus-send` が段の欄のある週報を送る前の確かめで通す（TC146 の形の正しい週報に段の欄を足しても終了コード 0）
