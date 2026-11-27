---
status: confirmed
範囲: launchd と CLI の設定の雛形、運用の手順書、契約のテスト、総合テスト、受入テスト、配信元の改修
---

# 13. 本番の構築、配信元の切り替え、受入 仕様

**親**: [`00-overview.md`](./00-overview.md) ｜ **担当**: Backend、（人間） ｜ **範囲**: launchd と CLI の設定の雛形、運用の手順書、契約のテスト、総合テスト、受入テスト、配信元の改修

設計の正本は `docs/upstream/` の上流工程の書類である。この仕様書は、DD-11 実装単位一覧が書き出した実装への引き渡しで、設計の中身を書き写さず、書類と節で指す。

## 1. 目的

本番で動かすための設定の雛形と手順書を用意し、総合テストと受入テストで RD-15 の受入基準を確かめる。配信元（brain-harness、sharpen）の送り先を NEXUS に替える（ADR-002）。

## 2. 入出力

入力: DD-09 の設定の値。出力: `deploy/` の雛形、`docs/operations/` の手順書、試験の記録。

## 3. 処理詳細

- DD-09 2.5、2.6、4章。
- 運用の手順の一覧: BD-11 7章（OP01〜OP11）。
- AC22 の証拠の残し方: DD-09 2.5。

## 4. 設定値・確定値

- launchd の名前は `jp.uslab.nexus.web`、`jp.uslab.nexus.runner`、`jp.uslab.nexus.backup`、`jp.uslab.nexus.purge`（DD-09 2.6）。
- 本番のポートは 48400、Tailscale Service は `svc:nexus`（DD-09 2.1）。
- CLI の設定は DD-09 2.5 の表のとおり。

## 5. インターフェース

`deploy/`、`docs/operations/`、`docs/test-evidence/`。

## 6. エラー処理

-

## 7. スコープ外

Messages API への切り替え（ADR-017 の見直しのとき）。

## 8. 関連仕様

- [`00-overview.md`](./00-overview.md)
- [`11-home.md`](./11-home.md)
- [`12-batch.md`](./12-batch.md)

## 9. 実装単位

- [x] [Backend] `deploy/` に、launchd の4つの雛形、`claude-settings.json`、`env` の雛形と、構築のスクリプト（フォルダを作り、雛形に本人のホームの道を書き込んで置く）を置く（NFR-005、NFR-016、NFR-025、DD-01 M01、DD-09 2.5・2.6・4章、CR-013）（se/13-release）
  - 受け入れ基準: deploy のフォルダに launchd の雛形4つと、CLI の設定の雛形と、環境変数の雛形がある; launchd の雛形4つが plutil の lint を通る; CLI の設定の雛形の許可、拒否、作業の場所の外の読み取りと書き込みを断る設定の値が DD-09 2.5 の表と同じ; 構築のスクリプトを一時のホームで動かすと DD-09 4章の手順 3 のフォルダが権限 0700 でできる
- [x] [Backend] 運用の手順書 `docs/operations/` の OP01〜OP11 を書く（NFR-027、BD-11 7章）（se/13-release）
  - 受け入れ基準: DD-10 TC128 が通る
- [x] [Backend] 全ての operation の応答を `docs/api/openapi.yaml` と照らす契約のテストを作る（NFR-015、DD-01 M10、ADR-021）（se/13-release）
  - 受け入れ基準: DD-10 TC102 が通る
- [x] [Backend] AC22 の証拠の数える処理を作る（NFR-016、NFR-019、DD-09 2.5）（se/13-release）
  - 受け入れ基準: DD-10 TC112 が通る
- [ ] （人間） 本番を構築する（OP01。Node.js の長期サポート版、Tailscale Service `svc:nexus`、LaunchAgents、自動のログインの確かめ、DD-09 4章の構築後の確かめ）（NFR-005、NFR-011、NFR-012）
- [ ] （人間） brain-harness の送り先を NEXUS に替え、配信元の鍵と、元の記事の URL・画像の URL・テーマの項目を足し、3日間 cerebellum と両方に送る（IF-001、ADR-002、ADR-014、REQ-026、Q-062、Q-065）
- [ ] （人間） sharpen の英語のレーンの送り先と読み先を NEXUS に替え、配信元の鍵と読む教材を足し、3日間 cerebellum と両方に送る（IF-002、IF-003、ADR-002、REQ-026）
- [ ] （人間） 試験の環境で総合テスト（RD-15 の総合テストの受入基準）を行い、本番の CLI で DD-10 TC113（AC22）を行って結果を `docs/test-evidence/` に残し、CLI の出力を1回分 `test/fixtures/` に置く（NFR-016、NFR-018、NFR-019、DD-10 TC113）
- [ ] [Backend] 記録した CLI の出力で、DD-04 4.2 の出来事の名前を読めることを確かめるテストを置く（IF-004、DD-01 M26、DD-04 4.2）
  - 受け入れ基準: DD-10 TC107 が通る
- [x] [Backend] 運用の手順書 OP01 の手順 9（自動でログイン）と確かめ方の「再起動からの戻り」を、FileVault をオンにして再起動の後は本人がログインする形に直す。計画した再起動は `sudo fdesetup authrestart` で行うことを書く（NFR-005、DD-09 2.6・4章、CR-016）（se/13-release）
  - 受け入れ基準: DD-10 TC128 が通る; OP01 に自動でログインする手順が無く、再起動の後に本人がログインすることと `sudo fdesetup authrestart` が書いてある; 確かめ方の「再起動からの戻り」の期待する結果が、ログインから 5 分以内に `/api/health` が 200 である
- [ ] （人間） 性能を計測する（NFR-001、NFR-002、NFR-003）
- [ ] （人間） 運用の試験を行う（NFR-005、NFR-006、NFR-025、NFR-027）
- [ ] （人間） 受入テストを行う（NFR-007、NFR-008、NFR-009、NFR-011、NFR-029、REQ-026）
- [x] [Backend] 構築の雛形のテスト `tests/13-release-deploy.test.ts` の `run` が、起動の口が標準エラーの末尾に足す「標準入力に書けない」を出力に混ぜず、`plutil` の結果だけで比べるようにして、子のプロセスが先に終わったときに不安定に落ちないようにする（DD-01 M26、DD-06 1章）（se/13-release）
  - 受け入れ基準: `tests/13-release-deploy.test.ts` の launchd の雛形の Label の確かめが、子のプロセスが標準入力を読まずに終わっても通る; Label の確かめが、`plutil` の標準出力だけを比べ、標準エラーを比べる値に含めない
- [ ] [Backend] 構築のスクリプト `deploy/setup.sh` が、`deploy/nexus-send` の雛形に Node.js の道とリポジトリの道を書き込んで `bin/nexus-send`（実行の権限、Git で管理しない）を置くようにする。運用の手順書の OP01（送信のコマンドの置き場所）、OP03（brain-research の鍵を作り、研究ループの `NEXUS_SENDER_KEY` に入れる）、OP05（研究ループの送信の失敗の確かめ方と、送信のコマンドでの送り直し）を足す（FN-024、FN-028、DD-09 2.7・4章、BD-11 OP01・OP03・OP05、CR-020）
  - 受け入れ基準: DD-10 TC128 が通る; 構築のスクリプトを一時のホームで動かすと、`bin/nexus-send` が実行の権限で置かれ、中の Node.js の道と `dist/cli/send/main.js` の道が絶対の道である; `.gitignore` に `bin/nexus-send` がある; OP03 に `sender-key issue brain-research` と `NEXUS_SENDER_KEY` が書いてあり、OP05 に `nexus-send` での送り直しが書いてある
- [ ] （人間） 本番で `sender-key issue brain-research` の鍵を作り、brain-harness の研究ループの `NEXUS_SENDER_KEY` と `NEXUS_SEND_URL` に入れる（OP03。FN-024、IF-005、Q-090）
- [ ] （人間） brain-harness の側で研究ループを作り、最初の週報を手で作って `~/apps/nexus/bin/nexus-send` で送る（brain-harness の作業で、NEXUS のリポジトリでは行わない。IF-005、DD-09 4章 構築後の確認）
- [ ] （人間） 受入テストで、週報の受け取りと課題の一覧と週報の画面（RD-15 AC37、AC38、AC39）を本番の端末で確かめる（REQ-030、REQ-031、REQ-032）
