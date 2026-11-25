---
status: confirmed
範囲: 会話の選択（FN-014）、質問と応答（FN-015）、送り直しと中止（FN-016）の API、AI Runner の質問の応答と会話の要約、画面（SCR-006）
---

# 10. AI チャット 仕様

**親**: [`00-overview.md`](./00-overview.md) ｜ **担当**: Backend ｜ **範囲**: 会話の選択（FN-014）、質問と応答（FN-015）、送り直しと中止（FN-016）の API、AI Runner の質問の応答と会話の要約、画面（SCR-006）

設計の正本は `docs/upstream/` の上流工程の書類である。この仕様書は、DD-11 実装単位一覧が書き出した実装への引き渡しで、設計の中身を書き写さず、書類と節で指す。

## 1. 目的

開いている内容について AI に質問し、応答を少しずつ受け取る仕組みを、API、AI Runner、画面（M06）で作る。

## 2. 入出力

入力: 質問の対象、質問の文。出力: DD-04 の会話の API、`streamReply` の出来事、AI の発言。

## 3. 処理詳細

- DD-02 FN-014、FN-015（受け付け、応答、続きを流す、会話の要約）、FN-016、3章 P06、P07。
- CLI の起動: DD-09 2.5（質問の応答では WebSearch、WebFetch、Read、Glob、Grep と `--add-dir`）。
- 排他: DD-05 3章。

## 4. 設定値・確定値

- 質問の文は 4,000 文字まで（Q-079 の答え）。
- 要約は、直近の 6 発言を除いた本文が 20,000 文字を超えたら（Q-085 の答え）。
- 渡す内容は 9 MB まで（DD-02 3章 P07）。
- 書き足しは 100 ミリ秒ごと、続きを読む間隔は 200 ミリ秒（DD-02 FN-015）。

## 5. インターフェース

DD-04 `listConversations`、`createConversation`、`getConversation`、`postQuestion`、`streamReply`、`retryReply`、`stopReply`、`dismissReply`。

## 6. エラー処理

MSG-011〜MSG-014、MSG-019。DD-06 E01、E05、E06、E09〜E13。

## 7. スコープ外

ホームの AI の状況（11-home.md）。

## 8. 関連仕様

- [`00-overview.md`](./00-overview.md)
- [`04-ai-runner.md`](./04-ai-runner.md)
- [`07-contents.md`](./07-contents.md)
- [`11-home.md`](./11-home.md)

## 9. 実装単位

- [x] [Backend] 会話の API `listConversations`、`createConversation`、`getConversation` を作る（FN-014、DD-01 M18、DD-02 FN-014）（se/10-chat）
  - 受け入れ基準: DD-10 TC50、DD-10 TC51、DD-10 TC52、DD-10 TC53 が通る
- [x] [Backend] `postQuestion` と、AI Runner の質問の応答 M25（渡す内容の組み立て P07、ニュースと英語の組み立て M15・M16、写し、書き足し、ツールの回数）を作る（FN-015、DD-01 M18、DD-01 M25、DD-02 3章 P07、NFR-016）（se/10-chat）
  - 受け入れ基準: DD-10 TC54、DD-10 TC55、DD-10 TC57、DD-10 TC58、DD-10 TC59、DD-10 TC70 が通る
- [x] [Backend] 質問の応答の失敗の扱いと、拾う順と同時に動かす数を作る（FN-015、DD-02 3章 P06、NFR-017、DD-06 E09・E11・E12）（se/10-chat）
  - 受け入れ基準: DD-10 TC60、DD-10 TC61、DD-10 TC62、DD-10 TC63、DD-10 TC64、DD-10 TC65、DD-10 TC129 が通る
- [x] [Backend] 応答の続きを流す `streamReply`（SSE、`Last-Event-ID`、`retry`、空のコメント行）を作る（FN-015、ADR-013、DD-04 3.5）（se/10-chat）
  - 受け入れ基準: DD-10 TC66、DD-10 TC117 が通る
- [x] [Backend] 会話の要約（待ちに入れる判断、要約の実行、失敗の扱い）を作る（FN-015、DD-01 M25、DD-02 FN-015、Q-076、Q-085）（se/10-chat）
  - 受け入れ基準: DD-10 TC67、DD-10 TC68、DD-10 TC69 が通る
- [x] [Backend] `retryReply`、`stopReply`、`dismissReply` と、AI Runner の止める求めの見張りを作る（FN-016、DD-02 FN-016、DD-05 3章）（se/10-chat）
  - 受け入れ基準: DD-10 TC71、DD-10 TC72、DD-10 TC74、DD-10 TC123 が通る
- [x] [Frontend] AI チャットの面 M06（対象の印、前の会話、質問、応答の続きの受け取り、状態ごとの操作、二重送信の防止）を作る（SCR-006、DD-01 M06・M09、BD-09 5章）（se/10-chat）
  - 受け入れ基準: DD-10 TC75 が通る
- [x] [Backend] 種類の一覧 M14 に、テストだけの3つ目の種類（一覧への登録、形の確かめ、渡す内容の組み立て、種類ごとの中身のテーブルを作るテスト用のマイグレーション）を足して、M13、M17、M18 と DD-02 3章 P08 を変えずに動くことを確かめる（NFR-004、REQ-019、DD-01 M14、DD-03 2.2）（se/10-chat）
  - 受け入れ基準: DD-10 TC110 が通る
