# OP10 ログの見方とログを消す決まり

NEXUS のログの置き場所、ファイルの分け方、探し方と、30日で消す決まりを書く（BD-11 7章、DD-09 2.6、NFR-025）。ほかの全ての OP から参照する。

## きっかけ

- ほかの OP（OP01〜OP09）でログを見るとき。
- 画面でエラーを見たとき。画面に問い合わせ用の番号は出ないので、日時と操作でログを探す（DD-06）。
- 月に1回の定常作業（BD-11 D02）で、バックアップと古い記録の削除のログを見るとき。

## 手順

### ログの置き場所とファイル

ログは `~/Library/Logs/nexus/`（`NEXUS_LOG_DIR`）にある。

| ファイル | 中身 |
|---|---|
| `web-YYYY-MM-DD.log` | Web サーバのその日のログ |
| `runner-YYYY-MM-DD.log` | AI Runner のその日のログ |
| `job-YYYY-MM-DD.log` | 定期ジョブ（バックアップ、古い記録の削除）のその日のログ |
| `cli-YYYY-MM-DD.log` | 管理のコマンドのその日のログ |
| `launchd-web.log`、`launchd-runner.log`、`launchd-job.log` | launchd が受けた標準出力と標準エラー。ログの関数が使えるようになる前の出力（起動の失敗など）だけが出る |

- 日付は日本時間である。日が替わると新しいファイルに書く（DD-09 2.6）。
- `launchd-web.log` と `launchd-runner.log` は、起動のときに 1 MB を超えていれば空になる。

### 探し方

1. 起きた日時から、プロセスとその日のファイルを決める。画面のエラーは `web-`、AI の失敗は `runner-`、バックアップと古い記録の削除は `job-`。
2. ファイルを開き、その時刻の行と、エラーのコードと、MSG の番号を探す。エラーは分類の番号（E08 など）ではなく、内部のエラーコードで出る（DD-06 2章）。その日のファイルでは JSON の1行に `"code":"DB_UNAVAILABLE"` のように出る。`launchd-*.log` では `NEXUS の AI Runner を起動できない: STARTUP_MISMATCH: …` のように文の中に出る。探すときは下の表のコードをそのまま検索語に使う。

   ```sh
   less ~/Library/Logs/nexus/web-<YYYY-MM-DD>.log
   grep -h 'DB_UNAVAILABLE\|STARTUP_MISMATCH' ~/Library/Logs/nexus/*.log | tail -n 20
   grep -h 'MSG-03[89]\|MSG-04[01]' ~/Library/Logs/nexus/job-*.log | tail -n 20
   ```

3. 起動しないときは、`launchd-*.log` を見る。

### よく探すエラーコード

| 分類 | ログに出るコード | 意味 | 次の手順 |
|---|---|---|---|
| E08 | `DB_UNAVAILABLE` | DB を開けない | OP04、OP07 |
| E12 | `AI_UNAVAILABLE` | AI を使えない | OP06 |
| E14 | `BACKUP_TARGET_UNAVAILABLE` | バックアップ先を使えない | OP08、OP11 |
| E16 | `INTERNAL` | 内部のエラー | 開発の担当（AI）に改修を頼む |
| E17 | `STARTUP_MISMATCH` | 起動の前提が合わない（設定が足りない、マイグレーションの番号が違う、SQLite の機能が無い） | OP04、OP02 |

### よく見る MSG

| MSG | 意味 | 次の手順 |
|---|---|---|
| MSG-032 | 配信元の鍵が正しくない | OP05、OP03 |
| MSG-038 | バックアップを取った | なし |
| MSG-039 | バックアップが取れなかった | OP08 |
| MSG-040 | 古い記録を消した | なし |
| MSG-041 | 古い記録を消せなかった | OP09 |

### ログを消す決まり

- 各プロセスは、30日より古いログのファイルを自分で消す（DD-09 2.6、NFR-025）。本人が手で消す作業は無い。
- ログは Mac mini の外に写さない。
- 事故の疑いがあるときは、証拠として、消える前に要る日のファイルを本人のユーザの中に写して残す（BD-10 5章）。

## 確かめ方

- `ls ~/Library/Logs/nexus/` で、動いているプロセスごとに今日のファイルがある。
- 30日より古いログのファイルが残っていない（RD-15 AC33）。

  ```sh
  find ~/Library/Logs/nexus -name '*-????-??-??.log' -mtime +30
  ```

  何も出なければよい。
