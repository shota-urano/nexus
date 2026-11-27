---
status: confirmed
範囲: 研究課題の一覧（FN-026）と週報（FN-027）の API と画面（SCR-010、SCR-011）、ホームの Research のセグメント（SCR-001）
---

# 14. 調査の週報の画面 仕様

**親**: [`00-overview.md`](./00-overview.md) ｜ **担当**: Frontend ｜ **範囲**: 研究課題の一覧（FN-026）と週報（FN-027）の API と画面（SCR-010、SCR-011）、ホームの Research のセグメント（SCR-001）

設計の正本は `docs/upstream/` の上流工程の書類である。この仕様書は、DD-11 実装単位一覧が書き出した実装への引き渡しで、設計の中身を書き写さず、書類と節で指す。CR-020（2026-11-27 RD-01 SH01 が承認）で足した。

## 1. 目的

brain-harness の研究ループが送る調査の週報を、課題の一覧から開き、最新の週の全体像と今週の変化を一緒に読み、方法の印を見分け、方法を広げてそのためにはと出典を読み、過去の週をさかのぼれるようにする（REQ-031）。ホームの円形 HUD に Research を足す（REQ-018）。

## 2. 入出力

入力: 内容 ID（週報）。出力: DD-04 `listResearchTopics`、`getResearchReport` の応答と画面（M32）。

## 3. 処理詳細

- DD-02 FN-026、FN-027。
- 既読と保存と開いた日時は 07-contents の `setRead`、`setSaved`、`markOpened` を使う（DD-02 FN-005、FN-006、3章 P04）。
- AI に質問は 10-chat の AI チャットの面 M06 を、対象 `page` とその週報の内容 ID で開く（DD-02 3章 P07）。
- 画面の見た目: BD-03 SCR-010、SCR-011、SCR-001。印の見せ方、帯の色の優先順、方法の広げ方、HUD の7分割、Research のアイコンは、本人が試作（`prototype/shots/q095-*.png`）を見て決めた（Q-095 の答え。2026-11-27）。

## 4. 設定値・確定値

- 課題の一覧は続きを持たない（DD-04 3.3。課題は同時に1〜3個）。
- 方法は 15 件まで、出典の数は出典の URL の数（Q-088 の答え）。
- 印は「今週足した」「出典が増えた」「反対の意見あり」で、記号と文字のタグを印ごとの色の枠と文字の色で出し（塗らない）、方法の行の左に色の帯を1本出す。帯の色は 反対の意見あり → 今週足した → 出典が増えた の優先順で先の印の色（BD-03 SCR-011。Q-095 の答え）。
- 方法はスマートフォンも iPad もその場で下に広げ、複数を同時に開ける。左右に並べる形は作らない（Q-095 の答え）。
- Research のアイコンは虫眼鏡と折れ線（試作の `researchB`）。Explore の方位の印とは、形、色、機能名で見分ける（BD-03 SCR-001。Q-095 の答え）。
- 一覧に出す日時は日付だけ（BD-09 5章。CR-004）。

## 5. インターフェース

DD-04 `listResearchTopics`、`getResearchReport`（`docs/api/openapi.yaml`）。画面の道 `/research`、`/research/{contentId}`（06-app-shell）。

## 6. エラー処理

MSG-047、MSG-048、MSG-019、MSG-003（BD-09 1.1）。DD-06 E03、E05、E08。

## 7. スコープ外

週報の受け取りと送信のコマンド（05-ingest.md）。ホームの API の `research.unreadCount`（11-home.md）。週報を作ること（brain-harness の作業）。

## 8. 関連仕様

- [`00-overview.md`](./00-overview.md)
- [`05-ingest.md`](./05-ingest.md)
- [`06-app-shell.md`](./06-app-shell.md)
- [`07-contents.md`](./07-contents.md)
- [`10-chat.md`](./10-chat.md)
- [`11-home.md`](./11-home.md)

## 9. 実装単位

- [x] [Backend] 課題の一覧 `listResearchTopics` と週報 `getResearchReport`（週の一覧、出典の数）を M33 で作り、`docs/api/openapi.yaml` に2つの operation（`/api/app/research/topics`、`/api/app/research/reports/{contentId}`）と応答の schema（`ResearchTopicList`、`ResearchTopicSummary`、`ResearchReportDetail`、`Approach`）を足す（DD-04 の定義どおり。CR-021）（FN-026、FN-027、DD-01 M11・M33、DD-02 FN-026・FN-027、DD-04、CR-020）（se/14-research）
  - 受け入れ基準: DD-10 TC138、DD-10 TC139、DD-10 TC102 が通る
- [x] [Frontend] 課題の一覧の画面 SCR-010（M32）を作る（FN-026、DD-01 M32、BD-03 SCR-010、CR-020）（se/14-research）
  - 受け入れ基準: DD-10 TC140 が通る
- [x] [Frontend] 課題の週報の画面 SCR-011（M32。今週の変化と全体像、方法の印と広げる操作、週の切り替え、既読と保存、AI に質問、出典のリンク）を、BD-03 SCR-011 3.2 の見た目（行の左の色の帯、枠と文字の色のタグ、その場で広げる）で作る（FN-027、FN-005、FN-006、DD-01 M32・M08、BD-03 SCR-011、Q-095、CR-020）（se/14-research）
  - 受け入れ基準: DD-10 TC141 が通る; 幅 390 ピクセルと iPad の幅（1180 ピクセル）のどちらでも、方法がその場で広がり、左右に並ばない
- [x] [Frontend] 画面の道 M01 に、課題の一覧 `/research`（SCR-010）と課題の週報 `/research/{contentId}`（SCR-011）を足し、上の帯（ロゴでホームへ戻る）を付ける。道の中身は、この仕様書の SCR-010、SCR-011 の行で作った M32 の部品にする（DD-01 M01・M32、BD-03 2章 遷移表、CR-020。CR-023 で 06-app-shell から移した）（se/14-research）
  - 受け入れ基準: `/research` と `/research/1` を開くと、上の帯と M32 の部品が出る; 上の帯のロゴを押すと `/` へ戻る; service worker の保存の対象が `/_next/static/` の中だけのままである
- [x] [Frontend] ホームの円形 HUD（M02）を7つのセグメントにして Research を足し、Research のカードに「未読 {件数}」（`getHome` の `research.unreadCount`。11-home の行で足す）を出し、カードを押すと `/research`（SCR-010）へ移る。HUD の7分割は試作のまま、Research のアイコンは虫眼鏡と折れ線（試作の `researchB`）にする（SCR-001-O01・O10、DD-01 M02、BD-03 SCR-001、Q-095、CR-020）（se/14-research）
  - 受け入れ基準: DD-10 TC143、DD-10 TC114 が通る; Research のアイコンの SVG の path が、試作 `prototype/app/page.tsx` の `researchB` の path と同じである
