# OP01 NEXUS を入れて、自動で動き出すようにする

launchd、Tailscale Service、別のディスクの置き場所、送り手が呼ぶ送信のコマンド（`nexus-send`）を用意し、本人のログインで NEXUS が動き出すようにする。Mac mini は FileVault をオンにするので、再起動の後は本人がログインする（BD-11 7章、DD-09 2.6・2.7・4章、NFR-005、NFR-027、CR-016、CR-020）。

## きっかけ

- 初めて NEXUS を入れるとき。
- Mac mini を作り直したとき。入れ直した後に、OP07 で写しを戻す（BD-11 4章）。

## 手順

本人が Mac mini の本人のユーザで行う。設定した日付と、書き込んだ値（本人のホームの道、`<tailnet>`、別のディスクの名前）を、この手順の記録として残す（DD-09 3章）。

1. Node.js の長期サポート版を Homebrew で入れる。番号は nodejs.org の一覧で確かめる（DD-09 2.1）。

   ```sh
   brew install node@<番号>
   /opt/homebrew/opt/node@<番号>/bin/node -p 'process.release.lts'
   ```

   2つ目のコマンドが版の名前を出せば、長期サポート版である。空なら長期サポート版ではない。

2. Claude Code の CLI の版が 2.1.314 以後であることを確かめる（DD-09 2.5）。ログインしていなければ、本人がログインする。

   ```sh
   ~/.local/bin/claude --version
   ```

3. リポジトリを置き、部品を入れて作る（DD-09 4章 手順 2）。

   ```sh
   cd <リポジトリ>
   npm ci
   npm run build
   ```

4. 構築のスクリプトを動かす（DD-09 4章 手順 3）。データの置き場所、AI の作業の場所、ログの置き場所を権限 `0700` で作り、`env`、`claude-settings.json`、launchd の設定4つと、送信のコマンド `bin/nexus-send` を置く。

   ```sh
   sh deploy/setup.sh
   ```

   Node.js が見つからないと知らせたときは、手順 1 の道を `NEXUS_NODE_BIN` に入れて、もう一度動かす。

   ```sh
   NEXUS_NODE_BIN=/opt/homebrew/opt/node@<番号>/bin/node sh deploy/setup.sh
   ```

   送信のコマンドの置き場所は、リポジトリの `bin/nexus-send` である（DD-09 2.7。本番では `~/apps/nexus/bin/nexus-send`）。構築のスクリプトが `deploy/nexus-send` の雛形に、Node.js の絶対の道と `dist/cli/send/main.js` の絶対の道を書き込み、実行の権限を付けて置く。Git では管理しない。研究ループ（brain-research の送り手）は、この絶対の道で呼ぶ。`PATH` は変えない。Node.js を替えたときやリポジトリを置き直したときは、構築のスクリプトをもう一度動かして置き直す。

   ```sh
   ls -l <リポジトリ>/bin/nexus-send
   ```

5. 別のディスクを Mac mini につなぎ、`nexus-backup` のフォルダを権限 `0700` で作る（DD-09 4章 手順 4）。ディスクの扱いは OP11 に従う。

   ```sh
   mkdir "/Volumes/<ディスクの名前>/nexus-backup"
   chmod 0700 "/Volumes/<ディスクの名前>/nexus-backup"
   ```

6. `__TAILNET__` と `__BACKUP_VOLUME__` を、次の5つのファイルに書き込む（DD-09 3章）。
   - `~/Library/Application Support/nexus/env`
   - `~/Library/LaunchAgents/jp.uslab.nexus.web.plist`
   - `~/Library/LaunchAgents/jp.uslab.nexus.runner.plist`
   - `~/Library/LaunchAgents/jp.uslab.nexus.backup.plist`
   - `~/Library/LaunchAgents/jp.uslab.nexus.purge.plist`

   書き込んだ後、launchd の設定が壊れていないことを確かめる。

   ```sh
   plutil -lint ~/Library/LaunchAgents/jp.uslab.nexus.*.plist
   ```

7. launchd に読み込ませる。Web サーバを先に起動し（DB のマイグレーションが当たる）、続けて AI Runner と定期ジョブを読み込ませる（DD-09 4章 手順 5）。

   ```sh
   launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/jp.uslab.nexus.web.plist
   curl http://127.0.0.1:48400/api/health
   launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/jp.uslab.nexus.runner.plist
   launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/jp.uslab.nexus.backup.plist
   launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/jp.uslab.nexus.purge.plist
   ```

8. Tailscale の管理画面で Tailscale Service `svc:nexus` を用意し、Mac mini で `127.0.0.1:48400` へ渡す設定をする（evaloom と同じ形。DD-09 4章 手順 6、ADR-009）。

9. macOS の設定で FileVault がオンであることを確かめる。FileVault をオンにするので、Mac mini は自動でログインしない。LaunchAgent は本人のユーザのセッションで動くので、再起動の後は本人がログインすると NEXUS が動き出す（DD-09 2.6、CR-016）。

   ```sh
   fdesetup status
   ```

   計画した再起動（macOS の更新など）は、次のコマンドで行う。次の起動の1回だけ、FileVault の解除とログインを飛ばす（DD-09 2.6）。

   ```sh
   sudo fdesetup authrestart
   ```

10. 端末を登録し、配信元の鍵を用意する（OP03）。brain-research の鍵は、研究ループの `NEXUS_SENDER_KEY` に入れる（DD-09 4章 手順 7）。

## 確かめ方

DD-09 4章の構築後の確認を、上から順に行う。

| 確かめること | 確かめ方 | 期待する結果 |
|---|---|---|
| Web サーバが動く | `curl http://127.0.0.1:48400/api/health` | 200 と待ちの数 |
| Tailscale の中から開ける | 端末で `https://nexus.<tailnet>.ts.net/` を開く | ホーム（未登録なら MSG-020） |
| Tailscale の外から開けない | Tailscale を切った端末で開く | つながらない |
| 127.0.0.1 だけで待ち受ける | `lsof -nP -iTCP:48400 -sTCP:LISTEN` | `127.0.0.1:48400` だけ |
| SQLite の機能 | Web サーバのログ（OP10） | 起動のときに E17 の `STARTUP_MISMATCH`が出ていない |
| CLI の起動 | 端末から質問を1つ送る | 応答が出る。`ai_run` が `done` で、`failure_reason` が空（OP06） |
| CLI に API キーを渡していない | OP06 の手順 4 | `ANTHROPIC_` で始まる変数が無い |
| 定期ジョブ | OP08 の手順で、バックアップを手で1回取る | 別のディスクに今日の写しがあり、権限が `0600`。ログに MSG-038 |
| 再起動からの戻り | Mac mini を再起動し、本人がログインする | ログインから 5 分以内に `/api/health` が 200 |
| ログ | `ls ~/Library/Logs/nexus/` | プロセスごとの今日のファイルがある |
| 送信のコマンド | 研究ループが最初の本物の週報（手で作る最初の週）を `~/apps/nexus/bin/nexus-send` で送る。本番に試験の週報は送らない | 終了コード 0 で、課題の一覧（SCR-010）にその課題が出る |

どれかが期待どおりでなければ、OP04 で確かめる。値を変えたとき（ポートが使われていた、など）は、先に `deploy/` の雛形を直し、同じ変更の中で DD-09 2章の表を直す（DD-09 4章）。
