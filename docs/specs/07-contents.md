---
status: confirmed
範囲: 既読と保存と開いた日時（FN-004 の一部、FN-005、FN-006）、Inbox、Explore、Library（FN-017〜FN-019）
---

# 07. 内容の状態、一覧、検索 仕様

**親**: [`00-overview.md`](./00-overview.md) ｜ **担当**: Backend ｜ **範囲**: 既読と保存と開いた日時（FN-004 の一部、FN-005、FN-006）、Inbox、Explore、Library（FN-017〜FN-019）

設計の正本は `docs/upstream/` の上流工程の書類である。この仕様書は、DD-11 実装単位一覧が書き出した実装への引き渡しで、設計の中身を書き写さず、書類と節で指す。

## 1. 目的

種類を問わない内容の状態と一覧と検索（DD-01 M17）と、Inbox、Explore、Library の画面（M05）を作る。

## 2. 入出力

入力: 内容 ID、既読と保存の値、検索の言葉。出力: DD-04 `markOpened`、`setRead`、`setSaved`、`listInbox`、`searchContents`、`listSaved` の応答。

## 3. 処理詳細

- DD-02 FN-005、FN-006、FN-017、FN-018、FN-019、3章 P03、P04。
- 検索の探し方: DD-03 3章。

## 4. 設定値・確定値

- 1ページは既定 30 件、上限 50 件（DD-04 3.3）。
- 検索の言葉は 200 文字まで（Q-079 の答え）。
- 一覧には日付だけを出す（BD-09 5章。CR-004）。

## 5. インターフェース

DD-04 `markOpened`、`setRead`、`setSaved`、`listInbox`、`searchContents`、`listSaved`。

## 6. エラー処理

DD-06 E01、E03、E04、E05、E06、E08。

## 7. スコープ外

ニュースと英語の画面（08、09）。

## 8. 関連仕様

- [`00-overview.md`](./00-overview.md)
- [`05-ingest.md`](./05-ingest.md)
- [`06-app-shell.md`](./06-app-shell.md)
- [`08-news.md`](./08-news.md)
- [`09-english.md`](./09-english.md)

## 9. 実装単位

- [x] [Backend] 内容の状態 M17（P04）と、`markOpened`、`setRead`、`setSaved` を作る（FN-004、FN-005、FN-006、DD-02 3章 P04、DD-05 3章）（se/07-contents）
  - 受け入れ基準: DD-10 TC24、DD-10 TC26、DD-10 TC126 が通る
- [x] [Backend] 一覧の続き P03 と `listInbox`、`listSaved` を作る（FN-005、FN-006、FN-017、FN-019、DD-01 M17、DD-02 FN-017・3章 P03）（se/07-contents）
  - 受け入れ基準: DD-10 TC25、DD-10 TC27、DD-10 TC76 が通る
- [x] [Backend] 検索 `searchContents`（NFKC と小文字、3文字以上は FTS5、2文字以下は部分の一致）を作る（FN-018、DD-01 M17、DD-02 FN-018、DD-03 3章）（se/07-contents）
  - 受け入れ基準: DD-10 TC77、DD-10 TC78、DD-10 TC79 が通る
- [x] [Frontend] 端末の API の呼び出し M09 と、Inbox、Explore、Library の画面 M05 を作る（SCR-007、SCR-008、SCR-009、DD-01 M05・M09）（se/07-contents）
  - 受け入れ基準: DD-10 TC84 が通る
