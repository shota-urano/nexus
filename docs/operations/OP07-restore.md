# OP07 バックアップから戻す

別のディスクの写しを Mac mini に戻し、端末と配信元の鍵を登録し直す（BD-11 4章、NFR-006、NFR-028）。

## きっかけ

- DB が壊れた（画面が開いても内容が出ない MSG-019、ログに E08）。
- 誤ってデータを消した。
- Mac mini を作り直した（OP01 で入れ直した後）。
- DB の形を変えるリリースを切り戻すとき（OP02）。
- 復旧の訓練（総合テストのとき、DB の形を変えるリリースの前。BD-11 4章）。

## 手順

本人が Mac mini の本人のユーザで行う。前日の終わりの時点まで、本人が気付いた日のうちに戻す（NFR-006）。

守ること（NFR-028）:

- 別のディスクは Mac mini につないだまま戻す。ディスクを持ち出さない。ほかの機器につながない。
- 写しは Mac mini の本人のユーザの中だけで戻す。ほかのユーザや、ほかの機器に写さない。
- 戻すために取り出した写しの複製を捨てるときは、捨てる前に中身を消す（ディスクごと捨てるときは OP11）。

1. どの写しを戻すかを決める。写しは日ごとに `nexus-YYYY-MM-DD.db` の名前で7日分ある（DD-02 FN-021）。日付は写しを取った日（毎日3時）である。壊れる前の一番新しい写しを選ぶ。

   ```sh
   ls -l "/Volumes/<ディスクの名前>/nexus-backup/"
   ```

   `.partial` で終わるファイルは、取っている途中で止まった写しなので選ばない。

2. Web サーバ、AI Runner、定期ジョブを止める。

   ```sh
   launchctl bootout gui/$(id -u)/jp.uslab.nexus.runner
   launchctl bootout gui/$(id -u)/jp.uslab.nexus.web
   launchctl bootout gui/$(id -u)/jp.uslab.nexus.backup
   launchctl bootout gui/$(id -u)/jp.uslab.nexus.purge
   ```

3. 今の DB を、データの置き場所の中で別の名前に替えて残す。WAL のファイル（`-wal`、`-shm`）も一緒に替える。

   ```sh
   cd "$HOME/Library/Application Support/nexus"
   mkdir -m 0700 broken-$(date +%F)
   mv nexus.db nexus.db-wal nexus.db-shm broken-$(date +%F)/ 2>/dev/null
   ```

4. 選んだ写しを戻し、権限を本人のユーザだけにする。

   ```sh
   cp "/Volumes/<ディスクの名前>/nexus-backup/nexus-<YYYY-MM-DD>.db" nexus.db
   chmod 0600 nexus.db
   sqlite3 nexus.db 'PRAGMA integrity_check;'
   ```

   最後のコマンドが `ok` を出すことを確かめる。出なければ、1つ前の日の写しで手順 4 をやり直す。

5. 端末、登録コード、配信元の鍵を全て消す。写しには、写しを取った後に取り消した端末と鍵が入っているためである（BD-11 4章）。

   ```sh
   sqlite3 nexus.db 'DELETE FROM device; DELETE FROM registration_code; DELETE FROM sender_key;'
   ```

6. Web サーバ、AI Runner、定期ジョブを起動し直す。

   ```sh
   launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/jp.uslab.nexus.web.plist
   launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/jp.uslab.nexus.runner.plist
   launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/jp.uslab.nexus.backup.plist
   launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/jp.uslab.nexus.purge.plist
   ```

7. OP03 で、端末を登録し直し、配信元の鍵を作り直して配信元の設定に入れる。

8. 写しを取った後に届いた配信は、OP05 で送り直す。

9. 戻した DB で動くことを確かめた後、手順 3 で残した `broken-<日付>` のフォルダを消す。消す前に中身を見て、要らないことを確かめる。

## 確かめ方

- `curl http://127.0.0.1:48400/api/health` が 200 を返す。
- 登録し直した端末でホームが開き、戻した日の前日の終わりまでのデータ（記事、英語のセット、会話）がそろっている。
- 手順 5 の後、`device list` と `sender-key list`（OP03）が、登録し直した端末と鍵だけを出す。
- `ls -l "$HOME/Library/Application Support/nexus/nexus.db"` で、権限が `-rw-------`（本人のユーザだけ）である。
- 作業が、本人が気付いた日のうちに終わった。
