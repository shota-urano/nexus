---
status: confirmed
範囲: 画面の道と共通の枠（M01）、PWA、CSP、共通部品（M07）
---

# 06. 画面の枠と共通部品 仕様

**親**: [`00-overview.md`](./00-overview.md) ｜ **担当**: Frontend ｜ **範囲**: 画面の道と共通の枠（M01）、PWA、CSP、共通部品（M07）

設計の正本は `docs/upstream/` の上流工程の書類である。この仕様書は、DD-11 実装単位一覧が書き出した実装への引き渡しで、設計の中身を書き写さず、書類と節で指す。

## 1. 目的

全ての画面が使う枠（上の帯、PWA の manifest と service worker、全面の知らせ）と、BD-09 6章の共通部品を作る。

## 2. 入出力

入力: 端末の API の応答。出力: 画面の枠と部品。

## 3. 処理詳細

- 画面の層: DD-01 1.1、M01、M07。
- 届いた文の表示: ADR-018、BD-09 6章。
- service worker と CSP: DD-09 2.1、2.4。

## 4. 設定値・確定値

- `dangerouslySetInnerHTML` を使わない（X-07 3章）。
- service worker は `/_next/static/` だけを保存する（DD-09 2.1）。
- 押す場所は 44 ピクセル四方以上、動きを減らす設定に従う（BD-09 5章）。

## 5. インターフェース

画面の道（DD-01 M01）。

## 6. エラー処理

MSG-018、MSG-019、MSG-020、MSG-021（BD-09 1.1）。

## 7. スコープ外

機能ごとの画面（07〜11）。

## 8. 関連仕様

- [`00-overview.md`](./00-overview.md)
- [`03-auth-and-admin.md`](./03-auth-and-admin.md)
- [`07-contents.md`](./07-contents.md)

## 9. 実装単位

- [ ] [Frontend] 画面の枠 M01（上の帯、全面の知らせ MSG-020・MSG-021、PWA の manifest と service worker）と、CSP の nonce と応答の欄を付ける middleware を作る（DD-01 M01、DD-09 2.1・2.4、BD-09 1.1）
  - 受け入れ基準: DD-10 TC104、DD-10 TC116 が通る; service worker の保存の対象が `/_next/static/` の中だけである（service worker のファイルの保存の条件を見て一つに決まる）
- [ ] [Frontend] 共通部品 M07（下から出る面、内容の一覧の行、空の状態、下の知らせ、確認の面、質問の対象の印、届いた文の表示、動きを減らす設定）を作る（DD-01 M07、NFR-008、NFR-018、ADR-018）
  - 受け入れ基準: DD-10 TC105 が通る
