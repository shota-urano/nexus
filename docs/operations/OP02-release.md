# OP02 リリースと切り戻し

main にマージした変更を本番に入れ、動かなければ前の版に戻す（BD-11 6章、7章）。

## きっかけ

- 本人が PR を main にマージしたとき。
- 月に1回の定常作業（BD-11 D02。Renovate の更新を入れるとき）。
- 安全に関わる更新が出たとき（BD-11 D03）。

## 手順

本人が Mac mini で行う。配信元の受け取りの時刻（5時と5時半）の前後は避ける（BD-11 6章）。

1. 今の版を記録する。切り戻しで使う。

   ```sh
   cd <リポジトリ>
   git rev-parse HEAD
   ```

2. DB の形を変えるリリース（マイグレーションを足すリリース）では、先に OP08 でバックアップを手で取る（DD-03 5章）。

3. Web サーバと AI Runner を止める。

   ```sh
   launchctl bootout gui/$(id -u)/jp.uslab.nexus.runner
   launchctl bootout gui/$(id -u)/jp.uslab.nexus.web
   ```

4. 新しい版に替えて作る。

   ```sh
   git fetch
   git checkout main
   git pull --ff-only
   npm ci
   npm run build
   ```

   月に1回の定常作業では、ここで依存の脆弱性の点検（`npm audit`）も行う（DD-09 5章）。

5. Web サーバを起動し（マイグレーションが当たる）、続けて AI Runner を起動する。

   ```sh
   launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/jp.uslab.nexus.web.plist
   curl http://127.0.0.1:48400/api/health
   launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/jp.uslab.nexus.runner.plist
   ```

### 切り戻し

戻す条件: リリースの後に画面が開けない、受け取りか質問ができない（BD-11 6章）。

1. 手順 3 と同じく、Web サーバと AI Runner を止める。
2. 手順 1 で記録した版に戻して作る。

   ```sh
   git checkout <手順 1 の版>
   npm ci
   npm run build
   ```

3. DB の形を変えるリリースだったときは、OP07 で手順 2 の写しを戻す。マイグレーションを戻すファイルは無い（DD-03 5章）。
4. 手順 5 と同じく、Web サーバと AI Runner を起動する。
5. 直らなければ、開発の担当（AI）に改修を頼む（BD-11 5章）。

## 確かめ方

- `curl http://127.0.0.1:48400/api/health` が 200 を返す。
- 端末でホームが開き、新しい版の画面が出る。
- 端末から質問を1つ送り、応答が出る。
- Web サーバと AI Runner のログ（OP10）に、起動のときの E17 の `STARTUP_MISMATCH`が出ていない。

  ```sh
  grep -h 'STARTUP_MISMATCH' ~/Library/Logs/nexus/launchd-web.log ~/Library/Logs/nexus/launchd-runner.log ~/Library/Logs/nexus/web-$(date +%F).log ~/Library/Logs/nexus/runner-$(date +%F).log
  ```

  何も出なければよい。
