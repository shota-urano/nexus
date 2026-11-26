# OP09 古い記録の削除を手で動かす

1年を過ぎた AI の実行と受け取りの記録を消す古い記録の削除（BAT-002）を、手で動かす（BD-11 2章 M05、3章、NFR-010、NFR-024）。

## きっかけ

- 古い記録の削除のログに MSG-041 が出た（BD-11 M05）。
- 月に1回の定常作業（BD-11 D02）でログを見て、上に当たったとき。
- 毎月1日の3時30分に Mac mini を止めていて、その月の回が動かなかったとき（BD-11 3章）。

## 手順

本人が Mac mini で行う。

1. 定期ジョブのログ（OP10）で、直近の回の結果を見る。

   ```sh
   grep -h 'MSG-04[01]' ~/Library/Logs/nexus/job-*.log | tail -n 20
   ```

2. 古い記録の削除を手で動かす。設定を `env` のファイルから読む。

   ```sh
   cd <リポジトリ>
   set -a; . "$HOME/Library/Application Support/nexus/env"; set +a
   node dist/jobs/main.js purge
   echo $?
   ```

   終了コードが `0` なら消し終えた（MSG-040）。`0` でなければ MSG-041 が出ている（BD-02 5.4）。同じバッチが動いているあいだは、後から起動したものは何もせずに終わる。

3. `0` でなければ、ログで MSG-041 の理由を見る。DB を開けないときは OP04 で確かめる。

4. 直らなければ、開発の担当（AI）に改修を頼む。急がない（次の月に消える。BD-11 5章）。

## 確かめ方

- 定期ジョブのログに、今日の MSG-040 が出ている。
- 1年を過ぎた AI の実行と、AI の実行から参照されていない受け取りの記録が0件である。手順 2 で動かした直後に確かめる。

  ```sh
  sqlite3 -readonly "$HOME/Library/Application Support/nexus/nexus.db" <<'SQL'
  WITH n(t) AS (SELECT strftime('%Y-%m-%dT%H:%M:%f+09:00', 'now', '+9 hours')),
       c(b) AS (SELECT printf('%04d', substr(t, 1, 4) - 1)
                       || CASE WHEN substr(t, 5, 6) = '-02-29' THEN '-02-28' || substr(t, 11) ELSE substr(t, 5) END
                FROM n)
  SELECT b,
         (SELECT COUNT(*) FROM ai_run WHERE created_at < b),
         (SELECT COUNT(*) FROM delivery
           WHERE received_at < b
             AND NOT EXISTS (SELECT 1 FROM ai_run WHERE ai_run.relate_delivery_id = delivery.delivery_id))
  FROM c;
  SQL
  ```

  出力の1つ目は境目の日時である。古い記録の削除と同じく、日本時間の今から1年前を、DB と同じ `YYYY-MM-DDTHH:MM:SS.sss+09:00` の形で作る（DD-03 1章。2月29日は前の年の2月28日にする）。2つ目（AI の実行）と3つ目（受け取りの記録）が `0` なら消し終えている。DB の日時は `T` と時差を付けた形なので、SQLite の `datetime()`（空白で区切り、時差を付けない）と比べてはいけない。
