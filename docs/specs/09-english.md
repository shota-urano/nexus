---
status: confirmed
範囲: 教材の一覧と教材と完了（FN-008〜FN-012）の API と画面（SCR-004、SCR-005）
---

# 09. 英語の教材 仕様

**親**: [`00-overview.md`](./00-overview.md) ｜ **担当**: Frontend ｜ **範囲**: 教材の一覧と教材と完了（FN-008〜FN-012）の API と画面（SCR-004、SCR-005）

設計の正本は `docs/upstream/` の上流工程の書類である。この仕様書は、DD-11 実装単位一覧が書き出した実装への引き渡しで、設計の中身を書き写さず、書類と節で指す。

## 1. 目的

英語の教材の一覧、教材の表示、問題と採点、完了を、API と画面（M04、M08 の英語の部品）で作る。

## 2. 入出力

入力: 内容 ID、答えと ○△×。出力: DD-04 `listEnglishSets`、`getEnglishSet`、`putEnglishAnswer` の応答と画面。

## 3. 処理詳細

- DD-02 FN-008、FN-009、FN-011、FN-012。
- 自動の採点の比べ方: DD-02 FN-011 の表。

## 4. 設定値・確定値

- 答えは 500 文字まで（BD-07 4.1）。
- 段は教材 → 問題 → 採点で、先へは飛ばせない（RD-03 R07）。
- 読む教材があるときは「## 読む」の節を出さない（BD-13 P07）。

## 5. インターフェース

DD-04 `listEnglishSets`、`getEnglishSet`、`putEnglishAnswer`。

## 6. エラー処理

MSG-004、MSG-005、MSG-006、MSG-007、MSG-019。DD-06 E01、E05、E07、E08。

## 7. スコープ外

AI チャットを開く入口の中身（10-chat.md）。

## 8. 関連仕様

- [`00-overview.md`](./00-overview.md)
- [`07-contents.md`](./07-contents.md)
- [`10-chat.md`](./10-chat.md)

## 9. 実装単位

- [x] [Backend] `listEnglishSets`、`getEnglishSet`、`putEnglishAnswer` を作る（FN-008、FN-009、FN-012、DD-01 M16、DD-02 FN-009・FN-012）（se/09-english）
  - 受け入れ基準: DD-10 TC38、DD-10 TC40、DD-10 TC45、DD-10 TC46 が通る
- [x] [Frontend] 教材の一覧と学習の画面 M04（教材、問題、採点の段と自動の採点）と、英語の表示部品 M08 を作る（SCR-004、SCR-005、FN-010、FN-011）（se/09-english）
  - 受け入れ基準: DD-10 TC39、DD-10 TC41、DD-10 TC42、DD-10 TC43、DD-10 TC44 が通る
- [x] [Frontend] 完了の確認（MSG-006）、失敗の知らせ（MSG-007）、二重送信の防止を作る（SCR-005-A07、BD-09 5章、DD-05 4章）（se/09-english）
  - 受け入れ基準: DD-10 TC47、DD-10 TC48、DD-10 TC49 が通る
- [ ] [Frontend] 英語の学習（SCR-005）の上の帯に「AI に質問」（SCR-005-A09）を置き、押すと AI チャットの面 SCR-006（M06 の `ChatSheet`）を下から開く。語句か文を選んでいれば、その語句と文と位置を対象（`kind: "phrase"`）にし、選んでいなければその教材のページ全体（`kind: "page"` と内容 ID）を対象にする。今は設計にあるこの入口が置かれていない（BD-03 SCR-005-A09・4章、DD-01 M01・M04・M06、DD-02 FN-014）
  - 受け入れ基準: 英語の学習の画面の上の帯に「AI に質問」があり、押すと AI チャットの面が開く; 語句も文も選んでいないときは、質問の対象がその教材のページ全体（`kind: "page"` とその教材の内容 ID）である; 語句か文を選んでいるときは、質問の対象が `kind: "phrase"` で、選んだ語句と文と位置を持つ; AI チャットの面を閉じると、学習の画面の答えと段がそのまま残っている; 英語の教材の一覧（SCR-004）には「AI に質問」が無い
