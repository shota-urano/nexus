# OP04 NEXUS が開けないときの確かめ方と起動し直し方

状態を返す API、launchd、Tailscale Serve、ログの順に確かめ、止まっているものを起動し直す（BD-11 2章 M03、5章）。

## きっかけ

- 端末の上の帯に MSG-018 が出た（BD-11 M03）。
- 画面が開いても内容が出ない（MSG-019）。DB を疑うときは、この手順の後に OP07 を見る。
- 配信元の送信が失敗している、sharpen が答えを読めない（BD-11 5章）。

## 手順

本人が Mac mini で行う。

1. Web サーバが応答するかを確かめる。

   ```sh
   curl -i http://127.0.0.1:48400/api/health
   ```

   200 が返れば、Web サーバは動いている。手順 4 へ進む。

2. launchd の様子を見る。

   ```sh
   launchctl print gui/$(id -u)/jp.uslab.nexus.web | grep -E 'state|last exit'
   launchctl print gui/$(id -u)/jp.uslab.nexus.runner | grep -E 'state|last exit'
   ```

   読み込まれていないと出たときは、OP01 の手順 7 で読み込ませる。

3. ログを見る（OP10）。起動の失敗は `launchd-web.log` に、起動の後のエラーは `web-YYYY-MM-DD.log` に出る。E17 の `STARTUP_MISMATCH`（設定が足りない、マイグレーションの番号が違う、SQLite の機能が無い）と E08 の `DB_UNAVAILABLE`（DB を開けない）を探す。ログには分類の番号でなくコードが出る（OP10）。

   ```sh
   tail -n 50 ~/Library/Logs/nexus/launchd-web.log
   tail -n 50 ~/Library/Logs/nexus/web-$(date +%F).log
   grep -h 'STARTUP_MISMATCH\|DB_UNAVAILABLE' ~/Library/Logs/nexus/launchd-web.log ~/Library/Logs/nexus/web-$(date +%F).log
   ```

   原因を直した後に、起動し直す。

   ```sh
   launchctl kickstart -k gui/$(id -u)/jp.uslab.nexus.web
   launchctl kickstart -k gui/$(id -u)/jp.uslab.nexus.runner
   ```

4. 127.0.0.1 だけで待ち受けていることを確かめる。

   ```sh
   lsof -nP -iTCP:48400 -sTCP:LISTEN
   ```

5. Tailscale を確かめる。Mac mini の Tailscale がつながっているか、Tailscale Service `svc:nexus` が `127.0.0.1:48400` へ渡しているかを見る。

   ```sh
   tailscale status
   tailscale serve status
   ```

   設定が消えていれば、OP01 の手順 8 でやり直す。

6. 端末の Tailscale がつながっているかを確かめる。

7. 直らなければ、開発の担当（AI）に改修を頼む（BD-11 5章）。DB が壊れているときは OP07 で写しを戻す。

## 確かめ方

- `curl http://127.0.0.1:48400/api/health` が 200 を返す。
- 端末で `https://nexus.<tailnet>.ts.net/` を開き、ホームが出る。上の帯に MSG-018 が出ていない。
- 止まっていたあいだに届かなかった配信は、OP05 で送り直す。
