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

- [x] [Frontend] 画面の枠 M01（上の帯、全面の知らせ MSG-020・MSG-021、PWA の manifest と service worker）と、CSP の nonce と応答の欄を付ける middleware を作る（DD-01 M01、DD-09 2.1・2.4、BD-09 1.1）（se/06-app-shell）
  - 受け入れ基準: DD-10 TC104、DD-10 TC116 が通る; service worker の保存の対象が `/_next/static/` の中だけである（service worker のファイルの保存の条件を見て一つに決まる）
- [x] [Frontend] 共通部品 M07（下から出る面、内容の一覧の行、空の状態、下の知らせ、確認の面、質問の対象の印、届いた文の表示、動きを減らす設定）を作る（DD-01 M07、NFR-008、NFR-018、ADR-018）（se/06-app-shell）
  - 受け入れ基準: DD-10 TC105 が通る
- [x] [Frontend] `public/img/` の画像に `Cache-Control: public, max-age=31536000, immutable` を付けて返す（DD-09 2.1、CR-017）（se/06-app-shell-2）
  - 受け入れ基準: `/img/home/planet_001.png` の応答の `Cache-Control` が `public, max-age=31536000, immutable` である; `public/img/` の画像の名前が全て版の番号（`_001` など）で終わる; service worker の保存の対象が `/_next/static/` の中だけのままである
- [x] [Frontend] ページ全体（`html` と `body`）の背景を BD-13 の試作 `prototype/app/globals.css` と同じ暗い色にし、画面の高さに満たないときも白を見せない。端末の上の帯の色（`theme-color`）と、ホーム画面に追加したときの上の帯の見え方を、暗い背景に合わせる（DD-01 M01、DD-01 3章 Tailwind CSS の決まり、BD-13）（se/06-app-shell-3）
  - 受け入れ基準: `html` と `body` の背景の色が、Tailwind の設定のファイルの背景の色である; ページの `theme-color` がその色である; ホーム画面に追加したときの上の帯の見え方（`apple-mobile-web-app-status-bar-style`）が、暗い背景に合う値である
- [x] [Frontend] ページ全体（`html` と `body`）の文字の色を、BD-13 の試作 `prototype/app/globals.css` と同じ明るい色（Tailwind の設定のファイルの文字の色）にし、文字の色を決めていない画面と全面の知らせ（MSG-020、MSG-021）が、暗い背景の上で読めるようにする（DD-01 M01、DD-01 3章 Tailwind CSS の決まり、BD-13）（se/06-app-shell）
  - 受け入れ基準: DD-10 TC116 が通る; `html` と `body` の文字の色が、Tailwind の設定のファイルの文字の色である; 全面の知らせの文の色が、ページ全体の背景の色と同じでない
- [x] [Frontend] `public/img/icon/app-icon_001.png`（1024×1024）から、PWA の manifest のアイコン（192px と 512px）と、iPad のホーム画面のアイコン（`apple-touch-icon`、180px）を作って設定する（DD-01 M01、BD-01 NFR-007）（se/06-app-shell-2）
  - 受け入れ基準: `/manifest.webmanifest` の `icons` に 192×192 と 512×512 の PNG があり、その道で画像が返る; ページに 180×180 の PNG を指す `apple-touch-icon` があり、その道で画像が返る; アイコンの画像の名前が版の番号（`_001` など）で終わる
- [ ] [Frontend] 上の帯（M01 の `TopBar`）のホームへ戻る操作を、「ホーム」の文字からホームと同じ NEXUS のロゴ（`public/img/home/logo_001.png`）にし、押すとホームに戻る。上の帯を、端末の上端の安全な余白（`env(safe-area-inset-top)`）と、ホームの上の余白（`pt-6`）の大きいほうだけ下げ、iPad のホーム画面のアプリのウィンドウの操作ボタンに隠れないようにする。そのため `viewport` に `viewportFit: "cover"` を付ける。題名は、最後の語（「News Galaxy」なら「Galaxy」）をアンバー（Tailwind の設定の値）にする（BD-09 5章、BD-03 SCR-002、DD-01 M01、CR-018）
  - 受け入れ基準: 上の帯に「ホーム」の文字が無く、`/` へのリンクが NEXUS のロゴの画像を持ち、ボタンの名前（`aria-label`）が「ホーム」である; そのリンクの押す場所が 44 ピクセル四方以上である; 上の帯の上の余白が `max(1.5rem, env(safe-area-inset-top))` である; ページの `viewport` に `viewport-fit=cover` がある; 題名「News Galaxy」の「Galaxy」が Tailwind の設定のアンバーの色で出る
