# OP03 端末の登録と取り消し、配信元の鍵の用意と取り消し

端末（iPad、Android）を登録し、知らない端末を取り消す。配信元（brain-harness、sharpen、brain-research）の鍵を用意し、漏れたか使わなくなった鍵を取り消す（BD-11 7章、FN-023、FN-024、BD-10 5章、CR-020）。

## きっかけ

- 端末を足すか替えるとき、端末をなくしたとき。
- 配信元の鍵が漏れたとき、配信元を初めてつなぐとき。
- 月に1回の定常作業（BD-11 D02）で、端末と鍵の一覧を見るとき。
- OP07 で写しを戻した後（端末と鍵を全て登録し直す）。

## 手順

本人が Mac mini のターミナルで、管理のコマンドを打つ。管理のコマンドは、設定を `env` のファイルから読む（DD-09 2.1）。申請と承認は無く、作業の記録は残さない（BD-11 6章）。

```sh
cd <リポジトリ>
set -a; . "$HOME/Library/Application Support/nexus/env"; set +a
```

### 端末を登録する

1. 登録の URL を出す。端末の名前は、本人が見分けられる名前にする。

   ```sh
   node src/cli/main.ts device add <端末の名前>
   ```

2. 出た URL を、10分のうちに登録する端末で開く。登録コードは1回だけ使える（BD-10 T01）。10分を過ぎたら、手順 1 からやり直す。

### 端末を取り消す

1. 登録した端末の一覧を見る。

   ```sh
   node src/cli/main.ts device list
   ```

2. 知らない端末、なくした端末、使わなくなった端末を取り消す。

   ```sh
   node src/cli/main.ts device revoke <端末の名前>
   ```

### 配信元の鍵を用意する

1. 鍵を作る。配信元は `brain-harness`、`sharpen`、`brain-research` のどれか。鍵はこのときに1回だけ出る（DD-09 3章）。

   ```sh
   node src/cli/main.ts sender-key issue <配信元>
   ```

2. 出た鍵を、配信元の設定（環境変数か、本人だけが読めるファイル）に入れる。鍵をこのリポジトリ、手順書、ログに書かない。

### brain-research の鍵を用意する（研究ループ。CR-020）

研究ループ（brain-harness の側で週報を送る送り手）は、送信のコマンド `nexus-send`（OP01 の手順 4）で週報を送る。鍵は brain-harness の鍵と分ける。brain-research の鍵で使えるのは週報の受け取り（IF-005）だけである（FN-024、DD-09 2.7）。

1. brain-research の鍵を作る。鍵はこのときに1回だけ出る。

   ```sh
   node src/cli/main.ts sender-key issue brain-research
   ```

2. 出た鍵を、研究ループの設定の環境変数 `NEXUS_SENDER_KEY` に入れる。あわせて、送り先の `NEXUS_SEND_URL` に `http://127.0.0.1:48400` を入れる（DD-09 2.7）。研究ループの設定は、環境変数か本人だけが読めるファイルにする。送信のコマンドは NEXUS の `env` のファイルを読まないので、NEXUS の `env` には入れない。鍵を引数、このリポジトリ、手順書、ログに書かない（NFR-019）。

3. brain-research の鍵を作り直したときは、研究ループの `NEXUS_SENDER_KEY` も新しい鍵に替える。

### 配信元の鍵を取り消す

1. 鍵の一覧を見る。配信元と作った日時が出る。

   ```sh
   node src/cli/main.ts sender-key list
   ```

2. 漏れた鍵か使わない鍵を取り消す。漏れたときは、続けて「配信元の鍵を用意する」で作り直す（BD-10 5章）。

   ```sh
   node src/cli/main.ts sender-key revoke <配信元>
   ```

## 確かめ方

- 登録した端末で NEXUS のホームが開く。`device list` に端末の名前が出る。
- 取り消した端末で開くと、未登録の画面（MSG-020）になる。`device list` に出ない。
- 新しい鍵を入れた配信元の次の送信が、受け取りの記録（`delivery`）で `accepted` になる（OP05 の確かめ方）。
- brain-research の鍵を入れた研究ループの次の送信で、`nexus-send` が終了コード 0 で終わり、受け取りの記録（`delivery`）に `brain-research` の `accepted` が出る（OP05 の確かめ方）。
- 取り消した鍵での送信は断られ、ログに鍵の失敗（MSG-032）が出る（OP10）。
