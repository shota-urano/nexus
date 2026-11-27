---
status: confirmed
範囲: 端末の鍵と登録、配信元の鍵の用意、API の入口の土台（P01）、管理のコマンド（M30）
---

# 03. 鍵と管理のコマンド 仕様

**親**: [`00-overview.md`](./00-overview.md) ｜ **担当**: Backend ｜ **範囲**: 端末の鍵と登録、配信元の鍵の用意、API の入口の土台（P01）、管理のコマンド（M30）

設計の正本は `docs/upstream/` の上流工程の書類である。この仕様書は、DD-11 実装単位一覧が書き出した実装への引き渡しで、設計の中身を書き写さず、書類と節で指す。

## 1. 目的

端末の登録と取り消し（FN-023）、配信元の鍵の用意と取り消し（FN-024）と、全ての端末の API の入口で端末の鍵を確かめる土台を作る。

## 2. 入出力

入力: 管理のコマンドの引数、登録の URL、端末の Cookie。出力: 登録の URL、鍵（1回だけ）、Cookie、端末と鍵の一覧。

## 3. 処理詳細

- DD-02 FN-023、FN-024、3章 P01、P05。
- API の入口の土台（要求ごとの番号、エラーから状態の番号と MSG への変換）: DD-04 3.4、DD-06 2章。
- 排他: DD-05 3章（同じ登録コード）。

## 4. 設定値・確定値

- 登録コードは 10 分で使えなくなる（BD-10 T01、Q-079 の答え）。
- Cookie は `nexus_device`、`HttpOnly`、`Secure`、`SameSite=Strict`、`Path=/`、`Max-Age` 34,560,000 秒（DD-02 3章 P01）。
- 鍵は 32 バイトの乱数の base64url、照合値は SHA-256 の16進（DD-02 3章 P05）。

## 5. インターフェース

`openRegistration`（DD-04）。管理のコマンド `device add|list|revoke`、`sender-key issue|list|revoke`（DD-02 FN-023、FN-024）。

## 6. エラー処理

DD-06 E03、E05、E07。

## 7. スコープ外

配信元の API の入口（P02）は 05-ingest.md。画面の全面の知らせは 06-app-shell.md。

## 8. 関連仕様

- [`00-overview.md`](./00-overview.md)
- [`02-data-model.md`](./02-data-model.md)
- [`05-ingest.md`](./05-ingest.md)
- [`06-app-shell.md`](./06-app-shell.md)

## 9. 実装単位

- [x] [Backend] API の入口の土台（要求ごとの番号、DD-06 の分類から DD-04 3.4 の状態の番号と MSG への変換）と、端末の鍵の確かめ P01（照合、最後に使った日時、オリジン、Cookie の付け直し、E03 のログの抑え）を作る（DD-01 M11・M12、DD-02 3章 P01、DD-04 3.1・3.4、DD-06）（se/03-auth-and-admin）
  - 受け入れ基準: DD-10 TC97、DD-10 TC98、DD-10 TC115 が通る
- [x] [Backend] 管理のコマンド M30 の `sender-key issue|list|revoke` と、配信元の鍵を M12 で作り照合する処理を作る（FN-024、DD-01 M30、DD-01 M12、DD-02 FN-024・3章 P05）（se/03-auth-and-admin）
  - 受け入れ基準: DD-10 TC100 が通る
- [x] [Backend] 管理のコマンドの `device add|list|revoke` と、登録の URL を開く `openRegistration` を作る（FN-023、DD-02 FN-023、DD-05 3章）（se/03-auth-and-admin）
  - 受け入れ基準: DD-10 TC93、DD-10 TC94、DD-10 TC95、DD-10 TC96 が通る
- [x] [Backend] 管理のコマンドの `sender-key issue|list|revoke` と M12 の配信元の鍵の確かめに、配信元 `brain-research`（使える連携は IF-005 だけ）を足す（FN-024、DD-01 M12・M30、DD-02 FN-024・3章 P02、BD-07 4.2、CR-020）（se/03-auth-and-admin-2）
  - 受け入れ基準: DD-10 TC99、DD-10 TC100、DD-10 TC150 が通る
