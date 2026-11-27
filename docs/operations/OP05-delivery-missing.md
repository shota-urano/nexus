# OP05 配信が届かないときの確かめ方と送り直し方

ホームに未着が出たときに、NEXUS の受け取りの記録と配信元（brain-harness、sharpen）のログを見て、原因を直し、届かなかった日の分を送り直す。研究ループ（配信元 brain-research）の週報が送れなかったときは、送信のコマンド `nexus-send` の出力を見て原因を直し、`nexus-send` で送り直す（BD-11 2章 M01、5章、CR-020）。

## きっかけ

- ホームのカードに MSG-015 か MSG-016 が出た（BD-11 M01）。日本時間の7時を過ぎて、配信元ごとに、その日の対象日で「受け取った」の記録が無いときに出る。
- sharpen が前の日の答えを読めなかった（IF-003。BD-11 5章）。
- NEXUS を止めていた日があった（OP04、OP07、計画停止）。
- 研究ループが週報の送信の失敗を報告した。課題の一覧（SCR-010）の最後に届いた日が、送ったはずの日より古い。週報は届く曜日が決まっていないので、ホームに未着は出ない（BD-11 2章、Q-093）。

## 手順

本人が Mac mini で行う。

1. NEXUS が動いているかを確かめる。止まっていれば OP04 で起動し直す。

   ```sh
   curl http://127.0.0.1:48400/api/health
   ```

2. NEXUS の受け取りの記録を見る。直近の受け取りと、断った理由が出る。

   ```sh
   sqlite3 -readonly "$HOME/Library/Application Support/nexus/nexus.db" \
     "SELECT sender, target_date, received_at, item_count, result, rejection_reason FROM delivery ORDER BY delivery_id DESC LIMIT 20;"
   ```

   - 記録が1件も無い: 送信が NEXUS に届いていない。手順 3 へ進む。
   - `rejected` だけがある: 断った理由を見る。鍵が違う（MSG-032）ときは、配信元の鍵の設定を確かめ、要れば OP03 で鍵を作り直す。形が違うときは、配信元の改修が要る。

3. Web サーバのログ（OP10）で、その時刻の配信元の API の記録を見る。

   ```sh
   less ~/Library/Logs/nexus/web-<YYYY-MM-DD>.log
   ```

   鍵の失敗（MSG-032）と、形の確かめで断った記録を探す。

4. 配信元のログを見る。brain-harness と sharpen の送信のログで、送ったか、どの応答が返ったかを確かめる。送り先が Mac mini の中の NEXUS（`http://127.0.0.1:48400`）になっているかも確かめる（DD-09 2.1）。

5. 原因を直した後、届かなかった日の分を、配信元の手順で手で送り直す。対象日は、届かなかった日にする。

6. 直らなければ、配信元か NEXUS の改修を開発の担当（AI）に頼む（BD-11 5章）。

### 研究ループの週報が送れなかったとき（brain-research。CR-020）

研究ループは週報を `~/apps/nexus/bin/nexus-send`（OP01 の手順 4）で送る。`nexus-send` は自動で送り直さない（DD-02 FN-028）。

1. 研究ループのログで、`nexus-send` の終了コードと出力を見る（DD-09 2.7）。
   - 終了コード 2 と MSG-049: 送る前に止めた。出た項目（引数、ファイルの形、環境変数の名前）を直す。`NEXUS_SENDER_KEY` か `NEXUS_SEND_URL` が無いときは、研究ループの設定に入れる（OP03 の「brain-research の鍵を用意する」）。
   - 終了コード 1 と MSG-050: NEXUS につながらなかった。上の手順 1 で NEXUS が動いているかを確かめ、止まっていれば OP04 で起動し直す。`NEXUS_SEND_URL` が `http://127.0.0.1:48400` になっているかも確かめる。
   - 終了コード 1 と MSG-032: 鍵が違う。研究ループの `NEXUS_SENDER_KEY` が brain-research の鍵か（brain-harness の鍵ではないか）を確かめ、要れば OP03 で brain-research の鍵を作り直す。
   - 終了コード 1 と MSG-033、MSG-034、MSG-046: NEXUS が形か大きさで断ったか、NEXUS の中で失敗した。上の手順 2 と手順 3 で、NEXUS の受け取りの記録（`sender` が `brain-research` の行）とログを見る。

2. 原因を直した後、送れなかった週の週報のファイルを、研究ループの環境変数（`NEXUS_SENDER_KEY`、`NEXUS_SEND_URL`）のある所から `nexus-send` で送り直す。同じ課題の同じ週を送り直すと、NEXUS は前の週報を置き換え、既読と保存は残すので、2回送っても週報は増えない（BD-06 IF-005）。

   ```sh
   ~/apps/nexus/bin/nexus-send --source brain-research --kind research-report <週報のファイル>
   ```

3. 直らなければ、研究ループか NEXUS の改修を開発の担当（AI）に頼む（BD-11 5章）。

## 確かめ方

- 手順 2 のコマンドで、送り直した対象日の記録が `accepted` で出る。
- ホームのカードの MSG-015、MSG-016 が消える。
- 送り直した日の記事か英語のセットが、ホームか一覧に出る。
- 週報を送り直したときは、`nexus-send` が終了コード 0 で終わり、MSG-031 と `topicId`、`week` を出す。課題の一覧（SCR-010）の最後に届いた日が、送り直した日になる。
