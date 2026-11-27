---
id: DD-09
name: 環境定義書（基盤詳細設計）
phase: 詳細設計
version: 1.3
updated: 2026-11-27
---

# DD-09 環境定義書（基盤詳細設計）（NEXUS）

- 読んだもの: BD-01 1.2（4章、5章、6章、7章）、BD-02 1.2（5章）、BD-10 1.2、BD-11 1.0、RD-15 1.2（AC22、AC26）、X-02 1.4、X-04 1.1（Q-082 の答え、CR-005、CR-007、CR-012、CR-013）、DD-01 0.1、DD-03 0.1、DD-04 0.1、DD-05 0.1、DD-06 0.1。X-06 で DD-07 を省いたので読まない。
- 今の Mac mini の様子は、2026-11-24 に次を見て確かめた。Claude Code の CLI は 2.1.330（`~/.local/bin/claude`）。Node.js は Homebrew の 26.12.1 で、長期サポート版ではない（`process.release.lts` が空）。待ち受けているポートは 48210、48310、48320、48330。cerebellum の launchd の設定（`deploy/jp.uslab.cerebellum.plist`。名前 `jp.uslab.cerebellum`、データ `~/Library/Application Support/cerebellum/`、ログ `~/Library/Logs/cerebellum/`）。Tailscale Serve は、Mac mini の名前に cerebellum ほか、`svc:evaloom` に evaloom を割り当てている。`~/projects/brain-harness` に鍵らしい名前のファイルは無い（名前だけを見た）。
- CLI の引数と設定の名前は、Claude Code の公式の文書（https://code.claude.com/docs/en/cli-reference 、https://code.claude.com/docs/en/settings 、https://code.claude.com/docs/en/permissions 、https://code.claude.com/docs/en/memory 、https://code.claude.com/docs/en/authentication 、https://code.claude.com/docs/en/env-vars 、https://code.claude.com/docs/en/tools-reference 。2026-11-24 に読んだ）で確かめた。
- 0.1: 初めて書いた（2026-11-24）。
- 0.2: X-05 RV16 の指摘に合わせ、多重起動の印のフォルダを外した（DB の `job_lock` に替えた。RV16-03）。6章の参照に書類の名前を付けた（2026-11-25）。
- 1.0: 詳細設計の完了判定（X-05 PG03。2026-11-25 RD-01 SH01。進める）で承認した。
- 1.1: X-04 CR-016（2026-11-26 RD-01 SH01 が承認）で、2.6 と構築後の確認の再起動を、FileVault をオンにして本人がログインする形に直した。
- 1.2: X-04 CR-017（2026-11-26 RD-01 SH01 が承認）で、2.1 の画面（PWA）に、`public/img/` の画像を長く保存させる決まりを足した。
- 1.3: X-04 CR-020（2026-11-27 RD-01 SH01 が承認）で、送信のコマンド（2.7）を足し、2.1 の構成要素の表と 4章の構築の手順に入れた。
- 書いた AI: Claude（Opus 5.5）。人の承認の前の案である。

## 1. 環境一覧

| 環境名 | 目的 | 利用者 | 本番との違い | データ | 用意する時期 |
|---|---|---|---|---|---|
| 本番 | 本人が毎日使う。受入テスト（RD-15） | 本人が使い、変える。開発の担当（AI）は本人の頼みでリリースの手順（BD-11 OP02）を手伝う | - | 本当の配信と、本人の会話 | Phase 1 の受入テストの前（DD-11 の最後の作業） |
| 試験 | 自動のテスト（DD-10 の結合テスト）と総合テスト（RD-15。AC22 を含む） | 開発の担当（AI）と本人 | 同じ Mac mini の別のポートと別のデータの置き場所。launchd に載せず、テストのコマンドが起動して止める。AI は決まった応答を返す偽の AI（DD-01 M26）を使い、総合テストのときだけ本番の CLI を使う（BD-01 4章）。配信元の代わりに、テストのコマンドが試験の鍵で送る。結果への影響: 性能（NFR-001、NFR-002）は本番と同じ Mac mini で測るので同じとみなす。AI の時間は偽の AI では測れないので、総合テストで測る | テストが作るサンプルのデータだけ。本番のデータは使わない（Q-052 の答え） | 最初の結合テストの前（DD-11 の基盤の作業） |
| 開発 | 実装中に開発の担当（AI）が動かす | 開発の担当（AI） | 試験と同じく別のポートと別のデータ。launchd に載せない。偽の AI を使う | サンプルのデータ | 実装の開始（DD-11 の最初の作業） |

## 2. 環境ごとの構成とパラメータ

### 2.1 本番

| 構成要素 | 実行基盤とサイズ | OS・ミドルウェア・ライブラリの版 | パラメータ | 通信の許可 |
|---|---|---|---|---|
| 画面（PWA） | 本人の iPad と Android（RD-11 NFR-007） | 端末のブラウザ（Safari、Chrome）。部品の版は `package.json` で固定する（DD-01 3章） | service worker は、`/_next/static/` の中の名前に版の付いたファイルだけを保存し、画面の HTML はネットワークを先に読み、API の応答は保存しない（新しい版を出したときに古い画面が残らないため。DD-04 3.6）。`public/img/` の画像は名前の終わりに版の番号（`_001` など）を付け、Web サーバが `Cache-Control: public, max-age=31536000, immutable` を付けて返す。画像を替えるときは名前の番号を上げる（Tailscale 越しに開くたびに読み直さないため。CR-017）。CSP は 2.4 | Tailscale Serve の NEXUS の名前だけへ。記事の画像と元の記事は端末が直に読む（T12） |
| Web サーバ | Mac mini（1台）。Node.js の1つのプロセス | Node.js の長期サポート版の最新（Homebrew で `node@<番号>` を入れる。番号は入れるときに nodejs.org の一覧で確かめる。BD-01 5章）。Next.js ほかは `package.json` で固定し、Renovate で上げる（NFR-026） | `next start` を `127.0.0.1` の 48400 で待ち受ける。設定は 2.3 の環境変数。起動のときに DB のマイグレーションを当てる（DD-03 5章） | 受け付ける: Tailscale Serve から 127.0.0.1:48400 だけ（NFR-012）。配信元から 127.0.0.1:48400 |
| AI Runner | Mac mini。Node.js の1つのプロセス | Web サーバと同じ | 同時に 2 つ、1 回 5 分（NFR-017）、待ちを読む間隔 500 ミリ秒（DD-02 3章 P06）。CLI の引数と設定は 2.5 | 待ち受けない（BD-10 2章）。CLI は 2.5 の範囲でだけ外へ出る |
| DB | Mac mini の内蔵のディスクの1つのファイル | SQLite（Node.js に入っている版。ADR-020）。起動のときに M21 が、FTS5 の trigram と `backup` が使えるかを確かめ、使えなければ DD-06 E17 で止まる | `~/Library/Application Support/nexus/nexus.db`。フォルダの権限は本人のユーザだけ（`0700`）。接続の設定は DD-05 1章（WAL、`busy_timeout` 5,000 ミリ秒、外部キー）。容量は 1 年に最大 約 390 MB（DD-03 4章） | ファイルなので通信しない |
| 定期ジョブ | Mac mini。launchd が起動する Node.js のプロセス | Web サーバと同じ | BAT-001 は毎日 3:00、BAT-002 は毎月 1日の 3:30（BD-02 5.1。CR-012）。写しの置き場所は 2.3 の `NEXUS_BACKUP_DIR`。写しは 7 日分（DD-02 FN-021） | 通信しない |
| 管理のコマンド | Mac mini。本人がターミナルで打つ | Web サーバと同じ | 2.3 の環境変数を、本番の値を書いたファイル（`~/Library/Application Support/nexus/env`。権限 `0600`）から読む | 通信しない |
| 送信のコマンド（CR-020） | Mac mini。送り手（brain-harness の研究ループ）が送り手のユーザで打つ | Web サーバと同じ Node.js | 2.7 | `127.0.0.1:48400` の IF-005 だけへ送る |
| Tailscale Serve | Mac mini の Tailscale | 本人の Tailscale の版 | Tailscale Service `svc:nexus` を作り、`https://nexus.<tailnet>.ts.net`（Tailscale の中だけ）を 127.0.0.1:48400 へ渡す（ADR-009。evaloom と同じ形） | Tailscale の中だけ（NFR-012、NFR-021） |

### 2.2 試験と開発

| 項目 | 試験 | 開発 |
|---|---|---|
| ポート | 48401 | 48402 |
| データの置き場所 | テストのコマンドが一時のフォルダに作り、終わったら消す。総合テストのときは `~/Library/Application Support/nexus-test/` | リポジトリの `.data/dev/`（Git に入れない） |
| ログ | データの置き場所の `logs/` | 標準出力 |
| AI | 偽の AI（`NEXUS_AI_PROVIDER=fake`）。総合テストだけ `claude` | 偽の AI |
| launchd | 載せない | 載せない |
| オリジン | `http://localhost:48401` | `http://localhost:48402` |
| バックアップの置き場所 | データの置き場所の `backup/`（別のディスクを使わない） | 同左 |

- 開発と試験では、`localhost` を安全な場所としてブラウザが扱うので、`Secure` の Cookie を http のまま使える。

### 2.3 環境変数（設定の名前）

全てのプロセスは、設定を環境変数から読み、M23（DD-01）の設定の読み込みで確かめる。足りないか形が違えば DD-06 E17 で止まる。本番の値は launchd の設定（2.6）と `env` のファイルに書く。秘密の情報は入れない（3章）。

| 名前 | 意味 | 本番の値 |
|---|---|---|
| `NEXUS_ENV` | 環境の名前 | `production`（試験は `test`、開発は `development`） |
| `NEXUS_DATA_DIR` | データの置き場所（DB、AI の作業の場所、試験の証拠） | `~/Library/Application Support/nexus`（本人のホームの絶対の道で書く） |
| `NEXUS_LOG_DIR` | ログの置き場所（CR-013） | `~/Library/Logs/nexus` |
| `NEXUS_PORT` | Web サーバのポート | `48400` |
| `NEXUS_ORIGIN` | NEXUS のオリジン（DD-04 3.1 のオリジンの確かめと、登録の URL） | `https://nexus.<tailnet>.ts.net` |
| `NEXUS_BACKUP_DIR` | バックアップの置き場所（別のディスク） | 別のディスクの中の `nexus-backup` のフォルダ。ディスクの名前は OP01 で本人が決めて書く（BD-11 OP11） |
| `NEXUS_AI_PROVIDER` | AI の呼び方 | `claude`（試験と開発は `fake`） |
| `NEXUS_CLAUDE_BIN` | CLI の道 | `~/.local/bin/claude`（絶対の道で書く） |
| `NEXUS_BRAIN_HARNESS_DIR` | 質問の応答で読ませるフォルダ（CR-005） | `~/projects/brain-harness`（絶対の道で書く） |
| `NEXUS_AI_EVENT_LOG_DIR` | 試験のときだけ、CLI の出来事をそのまま残す置き場所（2.5 の AC22 の証拠） | 本番では設定しない |
| `TZ` | 時刻帯 | `Asia/Tokyo`（BD-01 6章） |

### 2.4 Web サーバの応答の決まり

| 項目 | 値 | 理由 |
|---|---|---|
| CSP | `default-src 'self'`、`script-src 'self' 'nonce-<要求ごとの乱数>' 'strict-dynamic'`、`style-src 'self' 'unsafe-inline'`、`img-src 'self' https: data:`、`connect-src 'self'`、`frame-ancestors 'none'`、`base-uri 'self'`、`form-action 'self'`、`object-src 'none'` | 画面のスクリプトの読み込み先を自分のオリジンに限る（BD-10 T05）。Next.js が画面に入れるスクリプトは、要求ごとの乱数（nonce）で許す。乱数は Next.js の middleware で作る（DD-01 3章の「middleware で鍵を確かめない」とは別で、応答の欄を付けるだけに使う）。記事の画像は外のサイトから読む（T12）ので `img-src` に `https:` を入れる |
| そのほかの欄 | `X-Content-Type-Options: nosniff`、`Referrer-Policy: no-referrer`、`Cache-Control: no-store`（API の応答） | 端末が記事のサイトを開くときに NEXUS の道を渡さない。API の応答を途中で保存させない |
| 本文の大きさの上限 | 配信元の API は DD-04 の上限（1 MiB、256 KiB）。端末の API は 64 KiB | 端末の求めは質問の 4,000 文字が最大で、64 KiB で足りる（BD-10 T07） |

### 2.5 AI の CLI の起動（X-04 Q-082 の答え）

AI Runner の M26（DD-01）が、子のプロセスとして次のとおり起動する。引数は配列で渡し、シェルを通さない（X-07 3章）。

| 項目 | 質問の応答（answer） | 記事の関係の判定（relate）、会話の要約（summarize） |
|---|---|---|
| コマンド | `NEXUS_CLAUDE_BIN` の道 | 同左 |
| 出力の形 | `-p`、`--output-format stream-json`、`--verbose`、`--include-partial-messages`、`--input-format text`（DD-04 4.2） | 同左 |
| 使えるツール | `--tools WebSearch,WebFetch,Read,Glob,Grep`。`--disallowedTools mcp__*` | `--tools ""`（全てのツールを使わせない）。`--disallowedTools mcp__*` |
| 読む場所 | 作業の場所を空のフォルダ `NEXUS_DATA_DIR/ai-workdir`（権限 `0700`）にし、`--add-dir <NEXUS_BRAIN_HARNESS_DIR>` で決めたフォルダを足す（CR-005） | 作業の場所は同左。`--add-dir` を付けない |
| 許可の扱い | `--permission-mode dontAsk`。許可の要る呼び出しは、下の設定で許したもの（WebSearch、WebFetch）のほかは断られ、待たない | 同左 |
| 設定の読み込み | `--safe-mode`（CLAUDE.md、skills、プラグイン、フック、MCP、カスタムのコマンドとエージェント、自動のメモリを読み込まない。認証と権限はふだんどおり働く）。`--setting-sources project`（作業の場所は空なので、プロジェクトの設定は無い。利用者の設定 `~/.claude/settings.json` と、ローカルの設定を読み込ませない）。`--settings <NEXUS_DATA_DIR/claude-settings.json>`（下の表）。`--strict-mcp-config`（`--mcp-config` は付けない） | 同左 |
| そのほか | `--no-session-persistence`（会話を CLI の側に残さない。会話の正本は NEXUS の DB。依頼 6章） | 同左 |
| 渡す環境変数 | AI Runner の環境変数を引き継がず、次だけを渡す: `HOME`、`USER`、`LOGNAME`、`PATH`（`/usr/bin:/bin:/usr/sbin:/sbin`）、`LANG`（`ja_JP.UTF-8`）、`TMPDIR`、`TZ`、`DISABLE_AUTOUPDATER=1`、`CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`。`ANTHROPIC_API_KEY` ほか `ANTHROPIC_` で始まる変数は渡さない。渡すと `-p` では API キーが使われ、従量の課金になるためである（authentication の頁。NFR-009、BD-10 T08） | 同左 |
| 止め方 | 5 分を超えたか本人が止めたら SIGTERM、5 秒後に終わっていなければ SIGKILL（DD-06 4章） | 同左 |

`NEXUS_DATA_DIR/claude-settings.json` の中身（構築のときに、リポジトリの `deploy/claude-settings.json` の雛形の `~` を、本人のホームの絶対の道に直さずにそのまま置く。`~/` は permissions の頁の「ホームからの道」の書き方である）:

| 設定 | 値 | 根拠 |
|---|---|---|
| `permissions.allow` | `WebSearch`、`WebFetch` | `dontAsk` では許可の要るツールが断られるので、2つだけを許す（permissions の頁。tools-reference の頁で、2つは許可の要るツール） |
| `permissions.deny`（ツール） | `Bash`、`Edit`、`Write`、`NotebookEdit` | `--tools` で使わせないものを、設定でも断る（重ねて守る。NFR-016） |
| `permissions.deny`（読ませないファイル） | `Read(~/projects/brain-harness/.git/**)`、`Read(~/projects/brain-harness/.claude/**)`、`Read(~/projects/brain-harness/**/.env*)`、`Read(~/projects/brain-harness/**/*.pem)`、`Read(~/projects/brain-harness/**/*.key)`、`Read(~/projects/brain-harness/**/*.p12)`、`Read(~/projects/brain-harness/**/id_rsa*)`、`Read(~/projects/brain-harness/**/id_ed25519*)`、`Read(~/projects/brain-harness/**/*credential*)`、`Read(~/projects/brain-harness/**/*secret*)`、`Read(~/projects/brain-harness/**/.netrc)`、`Read(~/projects/brain-harness/**/.npmrc)` | 決めたフォルダの中の `.git` と鍵のファイル（Q-082 の答え、RD-15 AC22）と、brain-harness の `.claude/`（Q-082 の答え）。鍵のファイルは、2026-11-24 には1つも無いが、置かれたときに読ませない名前の型として並べた。`Read` の拒否は Read、Glob、Grep に効く（tools-reference の頁） |
| `permissions.deny`（ページの読み取りの宛先） | `WebFetch(domain:localhost)`、`WebFetch(domain:127.0.0.1)`、`WebFetch(domain:*.ts.net)`、`WebFetch(domain:*.local)` | Mac mini の中と Tailscale の中を名前で拒む（BD-10 T16、Q-082 の答え）。ドットの無い名前は WebFetch が断る（Q-082 の答え）。IP で直接指した宛先などは受け入れたリスク（CR-007） |
| `permissions.blockReadsOutsideWorkingDirectories` | `true` | 読み取りを作業の場所と `--add-dir` のフォルダの中に限る（Q-082 の答え。2.1.257 以後。今は 2.1.330） |
| `permissions.blockWritesOutsideWorkingDirectories` | `true` | 書くツールは無いが、重ねて守る（2.1.314 以後） |

- 拒否は許可より先に判定される（permissions の頁「deny, then ask, then allow」）ので、`WebFetch` を許しても上の宛先は断られる。
- 文書で確かめられなかった点: `--setting-sources project` で利用者の `~/.claude/settings.json` を読まないことと、`--safe-mode` で `--settings` の権限が効くことは、文書に「読み込む元の一覧」「権限はふだんどおり働く」とあるだけで、はっきりとは書かれていない。そのため、DD-10 の総合テスト（AC22）で、読ませないファイルと宛先が断られることを実際に確かめる。断られなければ、本人に知らせて止める。
- CLI の版が上がって、この表の引数か設定の名前が変わったときは、AI Runner の起動の確かめ（4章）と AC22 の試験で気付く。

AC22 の証拠の残し方（RD-15 AC22、CR-005）:

1. 総合テストのときだけ、試験の環境で `NEXUS_AI_PROVIDER=claude` と `NEXUS_AI_EVENT_LOG_DIR=<試験のデータの置き場所>/evidence/ac22/<YYYY-MM-DD>/` を設定する。M26 は、実行ごとに CLI の標準出力の全ての行を、`<実行ID>.jsonl`（権限 `0600`）にそのまま書く。本番では設定せず、書かない（会話の中身を含むため）。
2. 試験用の読ませないファイルとして、`<試験のデータの置き場所>/ac22-bait/secret.txt`（決めたフォルダの外）を作る。決めたフォルダの中の読ませないファイルは、今ある `.git/config` を使い、brain-harness に試験用のファイルを置かない（brain-harness は読むだけにする決まり）。
3. 数える道具（DD-10 の AC22 の試験の中の数える処理）は、全ての `.jsonl` を読み、`type` が `assistant` の出来事の `tool_use`（名前と入力）と、`type` が `user` の出来事の `tool_result`（`tool_use_id` と `is_error`）を組にして、次を数える: Write、Edit、NotebookEdit、Bash の呼び出しの数。Read、Glob、Grep で、決めたフォルダの外を指したか、上の読ませないファイルの型に当たり、`is_error` が偽だった呼び出しの数。relate と summarize の実行のツールの呼び出しの数。WebFetch で上の拒否の宛先を指し、`is_error` が偽だった呼び出しの数。
4. 数えた結果（数だけで中身を含まない）を、リポジトリの `docs/test-evidence/ac22-<YYYY-MM-DD>.md` に残し、本人が確かめる。`.jsonl` は試験の置き場所に残し、総合テストの判定が終わったら本人が消す。

### 2.6 launchd

リポジトリの `deploy/` に雛形を置き、構築のときに本人のホームの道を書き込んで `~/Library/LaunchAgents/` に置く（cerebellum と同じ形）。本人のユーザのセッションで動く LaunchAgent にする。CLI が本人のログイン（macOS のキーチェーン）を使うためである（authentication の頁。Q-075 の答え）。

| 名前（Label） | 起動するもの | 起動の条件 | そのほか |
|---|---|---|---|
| `jp.uslab.nexus.web` | `next start -H 127.0.0.1 -p 48400`（Node.js の道は絶対の道で書く） | `RunAtLoad`、`KeepAlive`、`ThrottleInterval` 10 秒 | 2.3 の環境変数。標準出力と標準エラーは `NEXUS_LOG_DIR/launchd-web.log` |
| `jp.uslab.nexus.runner` | AI Runner（`node dist/runner/main.js`） | 同上 | 同上（`launchd-runner.log`） |
| `jp.uslab.nexus.backup` | 定期ジョブの入口（`node dist/jobs/main.js backup`） | `StartCalendarInterval` の 3 時 0 分 | 同上（`launchd-job.log`） |
| `jp.uslab.nexus.purge` | 定期ジョブの入口（`node dist/jobs/main.js purge`） | `StartCalendarInterval` の 1 日 3 時 30 分 | 同上 |

- LaunchAgent は本人のユーザのセッションで動く。Mac mini は FileVault をオンにするので自動でログインせず、再起動の後は本人がログインすると動き出す。計画した再起動は `sudo fdesetup authrestart` で行い、次の起動の1回だけログインを飛ばす。OP01 で確かめる（NFR-005、AC26、CR-016）。
- ログ（CR-013）: 各プロセスは M23 のログの関数で `NEXUS_LOG_DIR/<プロセスの名前>-YYYY-MM-DD.log` に書き、日が替わったら新しいファイルに書き、30 日より古いファイルを消す（NFR-025）。launchd の標準出力と標準エラーのファイルには、ログの関数が使えるようになる前の出力（起動の失敗など）だけが出る。このファイルは Web サーバと AI Runner の起動のときに、1 MB を超えていれば空にする。

### 2.7 送信のコマンド（FN-028、IF-005。CR-020）

| 項目 | 決まり |
|---|---|
| 入口 | `src/cli/send/main.ts`（DD-01 M34）。`npm run build` で `dist/cli/send/main.js` にする（管理のコマンドと同じ変換） |
| 打つ名前 | `nexus-send`。構築のとき（4章 手順 3）に、`deploy/nexus-send` の雛形から、Node.js の絶対の道（2.1 と同じものを `setup.sh` が選ぶ）と `dist/cli/send/main.js` の絶対の道を書き込んだ実行のファイルを、リポジトリの `bin/nexus-send`（Git で管理しない）に置く。本番では `~/apps/nexus/bin/nexus-send` になる。送り手はこの絶対の道で呼ぶ。`PATH` は変えない |
| 引数 | `nexus-send --source brain-research --kind research-report <ファイル>`。値は今はこの組だけ（DD-02 FN-028） |
| 送り手の側の環境変数 | `NEXUS_SEND_URL`（NEXUS の配信元の API の根。本番は `http://127.0.0.1:48400`）、`NEXUS_SENDER_KEY`（brain-research の鍵。FN-024 で作り、本人が研究ループの設定に入れる。BD-11 OP03）。NEXUS の `env` のファイルは読まない（送り手のユーザが読めなくてよいようにするため） |
| 待つ時間 | 30 秒（DD-02 FN-028 手順 5。受け取りは1秒未満の見込みで、Web サーバの起動し直しの間を待てる長さとして置いた） |
| 終了コード | 0 は受け取られた。1 は NEXUS が断ったか、つながらなかった。2 は送る前に止めた（引数、ファイル、形、環境変数） |
| 試験と開発 | 試験では `NEXUS_SEND_URL` を試験の Web サーバに向け、試験の鍵を使う（BD-06 4.2 連携テストの進め方） |

## 3. IaC とパラメータシート

| 項目 | 決まり |
|---|---|
| IaC を使うか | 使わない。1台の Mac mini に、launchd の設定と Tailscale Service を置くだけで、作り直す回数も少ないため（BD-01 4章）。手順は 4章と BD-11 OP01 に書く |
| 定義の置き場所 | 該当なし（IaC を使わない）。設定の雛形はリポジトリの `deploy/` に置く |
| パラメータシート | 2章の表がパラメータシートである。値の正本は、リポジトリの `deploy/` の雛形（launchd の設定、`claude-settings.json`、`env` の雛形）と、2章の表である。構築のときに本人が書き込む値（本人のホームの道、`<tailnet>`、別のディスクの名前）は、OP01 の記録に、設定した日付と一緒に残す |
| 秘密情報の扱い | NEXUS の設定と雛形に秘密の情報は無い。端末の鍵、登録コード、配信元の鍵は、DB に照合値だけを置く（DD-03、DD-02 3章 P05）。配信元の鍵そのものは、作ったときに1回だけ出し、本人が brain-harness と sharpen の設定（環境変数か、本人だけが読めるファイル）に入れる（BD-10 4章、BD-11 OP03）。Claude の認証の情報は macOS のキーチェーンにあり、NEXUS は読まない（BD-10 T09）。この書類とリポジトリに値を書かない |

## 4. 構築の手順と構築後の確認

構築の手順（本番。BD-11 OP01 の中身。OP01 の手順書は実装で書く）:

1. Homebrew で Node.js の長期サポート版を入れる（2.1）。`claude --version` が 2.1.314 以後であることを確かめる（2.5 の設定の下限）。
2. リポジトリを置き、`npm ci` と `npm run build`（Next.js の画面と、AI Runner、定期ジョブ、管理のコマンド、送信のコマンドの TypeScript の変換）を行う。
3. `~/Library/Application Support/nexus/`（`0700`）、`ai-workdir/`、`~/Library/Logs/nexus/` を作り、`deploy/` の雛形から `env`、`claude-settings.json`、launchd の設定と、送信のコマンドの `bin/nexus-send`（2.7。CR-020）を置く。
4. 別のディスクに `nexus-backup` のフォルダ（`0700`）を作る（BD-11 OP11）。
5. launchd の設定を読み込ませ、Web サーバを起動する（マイグレーションが当たる）。続けて AI Runner を起動する。
6. Tailscale の管理画面で Tailscale Service `svc:nexus` を用意し、Mac mini で 127.0.0.1:48400 へ渡す設定をする（evaloom と同じ形。ADR-009）。Mac mini の Tailscale の設定を変えるので、本人が行う。
7. 管理のコマンドで、端末の登録の URL を出して端末を登録し（FN-023）、配信元の鍵を用意して配信元の設定に入れる（FN-024、BD-11 OP03）。brain-research の鍵は、研究ループの `NEXUS_SENDER_KEY` に入れる（CR-020）。

構築後の確認:

| 確かめること | 確かめ方 | 期待する結果 |
|---|---|---|
| Web サーバが動く | Mac mini で `curl http://127.0.0.1:48400/api/health` | 200 と待ちの数（DD-04 `getHealth`） |
| Tailscale の中から開ける | 端末で `https://nexus.<tailnet>.ts.net/` を開く | ホーム（未登録なら MSG-020） |
| Tailscale の外から開けない | Tailscale を切った端末で開く | つながらない（NFR-012。AC21） |
| 127.0.0.1 だけで待ち受ける | `lsof -nP -iTCP:48400 -sTCP:LISTEN` | `127.0.0.1:48400` だけ |
| SQLite の機能 | Web サーバのログ | 起動のときの確かめ（2.1 DB）で E17 が出ていない |
| CLI の起動 | 本番の端末から質問を1つ送る | 応答が出る。`ai_run` が done で、`failure_reason` が空 |
| CLI に API キーを渡していない | AI Runner のプロセスの環境を確かめる手順（OP06）で、CLI に渡す変数の一覧を見る | `ANTHROPIC_` で始まる変数が無い |
| 定期ジョブ | `node dist/jobs/main.js backup` を手で動かす | 別のディスクに今日の写しがあり、権限が `0600`。ログに MSG-038 |
| 再起動からの戻り | Mac mini を再起動し、本人がログインする | ログインから 5 分以内に `getHealth` が 200（NFR-005。AC26。CR-016） |
| ログ | `NEXUS_LOG_DIR` | プロセスごとの今日のファイルがある |
| 送信のコマンド（CR-020） | 研究ループが最初の本物の週報（手で作る最初の週）を `~/apps/nexus/bin/nexus-send` で送る。本番に試験の週報は送らない | 終了コード 0 で、課題の一覧（SCR-010）にその課題が出る |

- 書類の直し方: 構築してみて値を変えたとき（ポートが使われていた、など）は、先に `deploy/` の雛形を直し、同じ変更の中でこの書類の 2章の表を直す。版を上げ、冒頭に直したわけを書く。

## 5. 開発とテストの作業環境

| 項目 | 決まり |
|---|---|
| 立ち上げのコマンド | `npm ci` の後に `npm run setup:dev`（`.data/dev/` を作り、マイグレーションを当て、サンプルのデータを入れる）。前提の道具は、Node.js の長期サポート版（2.1 と同じ番号。リポジトリの `.nvmrc` と `package.json` の `engines` に書く）と npm |
| テストのコマンド | テスト: `make verify`。中身は、Prettier の確かめ、ESLint（DD-01 1.3 の層の規則と、DD-06 1章の空の `catch` の禁止を含む）、TypeScript の型の確かめ、Redocly CLI の `lint`（DD-04 1章）、DD-10 の自動のテスト。結果は標準出力に出し、どれかが失敗したら 0 でない終了コードで終わる。テストの道具と結果のファイルの形は DD-10 で決める |
| 作業用の複製へコピーしてよいファイル | 無い。開発と試験の設定は既定の値で動き、Git で管理しない設定のファイルを要らないようにする。`.env` と本番の `env` のファイルはコピーしない |
| 外部への通信 | 立ち上げ（`npm ci`）は npm の公開の置き場所（`registry.npmjs.org`）だけ。`make verify` は外へ通信しない（偽の AI を使い、依存の脆弱性の点検も入れない）。依存の脆弱性の点検（`npm audit`）は、通信が要るので `make verify` に入れず、毎月の定常作業（BD-11 7章 D02）で Renovate の PR と一緒に行う（BD-10 4章 使う部品の脆弱性） |

## 6. 上流との対応

| 環境・構成要素・パラメータ | 根拠（NFR、ADR、BD-11 の行、BD-10 の対策） |
|---|---|
| 1章 本番、試験、開発 | BD-01 4章 環境の種類、RD-15 1章、Q-052 の答え |
| 2.1 画面の service worker、2.4 CSP | NFR-007、NFR-018、BD-10 T05、DD-04 3.6 |
| 2.1 Web サーバの待ち受け、Tailscale Serve | NFR-011、NFR-012、NFR-021、ADR-009、BD-10 2章 |
| 2.1 DB の置き場所と権限、容量 | NFR-003、NFR-001、DD-03 4章、ADR-007、ADR-020 |
| 2.1 AI Runner、2.5 CLI の起動 | NFR-016、NFR-017、NFR-019、NFR-009、BD-10 T03、BD-10 T08、BD-10 T09、BD-10 T16、X-04 Q-082・CR-005・CR-007、ADR-016 |
| 2.1 定期ジョブ、2.6 launchd | NFR-005、NFR-023、NFR-024、BD-02 5.1（CR-012）、ADR-008 |
| 2.3 `NEXUS_BACKUP_DIR` | NFR-023、NFR-028、BD-11 4章・BD-11 OP11 |
| 2.6 ログ | NFR-025、BD-01 6章 ログ（CR-013）、BD-11 OP10 |
| 2.5 試験の証拠の残し方 | NFR-016、CR-005（RD-15 AC22） |
| 5章 `make verify` | X-07 3章、DD-01 1.3、DD-04 1章、DD-06 1章 |
| 5章 依存の脆弱性の点検 | NFR-026、BD-10 4章 |

- BD-01 7章で詳細を決める書類を DD-09 とした NFR（NFR-001、NFR-003、NFR-005、NFR-007、NFR-011、NFR-012、NFR-016、NFR-019、NFR-021、NFR-025）は、全てこの表の根拠にある。
- BD-01 3章の構成要素7つは、全て 2.1 にある。
- BD-11 の監視とバックアップのうち設定で実現するもの（BD-11 M04 のバックアップの時刻と置き場所、BD-11 OP10 のログ）は、2.1、2.3、2.6 にある。
- RD-15 と DD-10 で使う環境（総合テストの試験、受入テストの本番）は、1章にある。

## 7. 未決事項

この書類で起こした未決事項は無い。
