# OP06 AI が失敗するときの確かめ方

AI の実行の記録、CLI が動くか、ログインが有効か、使える量を順に確かめる（BD-11 2章 M02、5章、NFR-029）。

## きっかけ

- ホームのカードに MSG-017 が出た（BD-11 M02）。24時間以内に、失敗のまま終わった AI の実行が1件以上ある。
- 質問に MSG-013 が出た。質問が「作成中」のまま進まない。
- 構築後の確かめ（OP01）で、CLI に渡す変数を見るとき。

## 手順

本人が Mac mini で行う。

1. AI の実行の記録を見る。失敗の理由と、何回目かが出る。

   ```sh
   sqlite3 -readonly "$HOME/Library/Application Support/nexus/nexus.db" \
     "SELECT ai_run_id, purpose, state, attempt, created_at, finished_at, failure_reason FROM ai_run ORDER BY ai_run_id DESC LIMIT 20;"
   ```

   `queued` のまま増えていくときは、AI Runner が止まっている。OP04 の手順 2 と 3 で `jp.uslab.nexus.runner` を確かめる。

2. AI Runner のログ（OP10）で、失敗した時刻の行を見る。

   ```sh
   less ~/Library/Logs/nexus/runner-<YYYY-MM-DD>.log
   ```

3. CLI が動くか、ログインが有効かを確かめる。本人のユーザで CLI を打つ。

   ```sh
   ~/.local/bin/claude --version
   ~/.local/bin/claude -p 'ping'
   ```

   - 版が 2.1.314 より前なら、CLI を上げる（DD-09 2.5）。
   - ログインを求められたら、本人がログインをやり直す。Claude のログインが他人に使われた疑いがあるときも、ログインをやり直す（BD-10 5章）。
   - 使える量の上限に当たったと出たら、上限が戻るのを待つ。従量の課金に切り替えない（NFR-009）。

4. CLI に API キーを渡していないことを確かめる。質問を1つ送り、応答を作っているあいだに、CLI のプロセスの環境を見る。

   ```sh
   pgrep -f "$HOME/.local/bin/claude"
   ps -E -ww -o command= -p <番号>
   ```

   `ANTHROPIC_` で始まる変数が無いことを確かめる（DD-09 2.5）。あれば AI Runner を止め（`launchctl bootout gui/$(id -u)/jp.uslab.nexus.runner`）、開発の担当（AI）に改修を頼む。

5. AI が許していない操作をした跡があるときは、AI Runner を止める（`launchctl bootout gui/$(id -u)/jp.uslab.nexus.runner`。BD-10 5章）。証拠として、ログ（OP10）と AI の実行の記録を消さずに残す。

6. 原因を直した後、AI Runner を起動し直す。直らなければ、開発の担当（AI）に改修を頼む（BD-11 5章）。

   まず、AI Runner が launchd に登録されているかを見る。

   ```sh
   launchctl print gui/$(id -u)/jp.uslab.nexus.runner > /dev/null && echo 登録あり || echo 登録なし
   ```

   - `登録あり` なら、起動し直す。

     ```sh
     launchctl kickstart -k gui/$(id -u)/jp.uslab.nexus.runner
     ```

   - `登録なし` なら（手順 4 や 5 で `launchctl bootout` で止めたときは、登録も外れている）、登録し直す。登録すると起動する。

     ```sh
     launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/jp.uslab.nexus.runner.plist
     ```

## 確かめ方

- 端末から質問を1つ送り、応答が出る。
- 手順 1 のコマンドで、その実行が `done` で、`failure_reason` が空である。
- ホームのカードの MSG-017 が、失敗から24時間を過ぎた後に消える。
