---
status: confirmed
範囲: 記事の図（FN-003）と記事の案内（FN-004）の API と画面（SCR-002、SCR-003）
---

# 08. ニュース（News Galaxy と記事の案内） 仕様

**親**: [`00-overview.md`](./00-overview.md) ｜ **担当**: Frontend ｜ **範囲**: 記事の図（FN-003）と記事の案内（FN-004）の API と画面（SCR-002、SCR-003）

設計の正本は `docs/upstream/` の上流工程の書類である。この仕様書は、DD-11 実装単位一覧が書き出した実装への引き渡しで、設計の中身を書き写さず、書類と節で指す。

## 1. 目的

選んだ日の記事の図と、記事の案内を、API と画面（M03、M08 のニュースの部品）で作る。

## 2. 入出力

入力: 日付、内容 ID。出力: DD-04 `getGalaxy`、`getArticle` の応答と画面。

## 3. 処理詳細

- DD-02 FN-003、FN-004。
- 図の部品: ADR-015（React Flow）。

## 4. 設定値・確定値

- 作り物の中心を置かず、選んだ記事を中心にする（RD-03 R04）。
- テーマの絞り込みは画面の中で行う（SCR-002-A03）。

## 5. インターフェース

DD-04 `getGalaxy`、`getArticle`。

## 6. エラー処理

MSG-001、MSG-002、MSG-003、MSG-019。DD-06 E01、E05、E08。

## 7. スコープ外

AI チャットを開く入口の中身（10-chat.md）。

## 8. 関連仕様

- [`00-overview.md`](./00-overview.md)
- [`07-contents.md`](./07-contents.md)
- [`10-chat.md`](./10-chat.md)

## 9. 実装単位

- [x] [Backend] `getGalaxy` と `getArticle` を作る（FN-003、FN-004、DD-01 M15、DD-02 FN-003・FN-004）（se/08-news）
  - 受け入れ基準: DD-10 TC19、DD-10 TC20、DD-10 TC22、DD-10 TC23 が通る
- [x] [Frontend] News Galaxy と記事の案内の画面 M03 と、ニュースの表示部品 M08 を作る（SCR-002、SCR-003、ADR-015）（se/08-news）
  - 受け入れ基準: DD-10 TC21、DD-10 TC29 が通る
