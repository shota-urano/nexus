---
id: DD-04
name: API 詳細設計書
phase: 詳細設計
version: 1.4
updated: 2026-11-27
---

# DD-04 API 詳細設計書（NEXUS）

- 読んだもの: BD-02 1.1、BD-03 1.1、BD-06 1.1、BD-07 1.1、BD-09 1.1、BD-10 1.2、RD-11 1.0（NFR-001、NFR-002）、X-02 1.3、DD-01 0.1、DD-03 0.1。X-06 で BD-08、BD-14、DD-07 を省いたので読まない。
- 配信元の API の形は、今の cerebellum の `docs/specs/03-api.md`（2章、3章、4章）と `24-inbox.md` を読んで合わせた（Q-039 の答え。2026-11-24）。読む教材の項目の名前は、sharpen の `drills/en/2026-11-10/read.json` を読んで合わせた（2026-11-24）。
- IF-004 の CLI の出来事の形は、Claude Code の公式の文書（https://code.claude.com/docs/en/headless 、https://code.claude.com/docs/en/agent-sdk/streaming-output 、https://code.claude.com/docs/en/agent-sdk/typescript 、https://code.claude.com/docs/en/tools-reference 。2026-11-24 に読んだ）から決めた（4.2）。
- 0.1: 初めて書いた（2026-11-24）。
- 0.2: X-05 RV16 の指摘で直した（2026-11-25）。`streamReply` に `reset` の出来事と、出来事の番号の形と、失敗の扱いを足した（RV16-01、RV16-10）。
- 1.0: 詳細設計の完了判定（X-05 PG03。2026-11-25 RD-01 SH01。進める）で承認した。
- 1.1: CR-015 で、`openapi.yaml` の `openRegistration`（`/register`）に 500 の応答を足した（2026-11-26 RD-01 SH01）。
- 1.2: X-04 CR-017（2026-11-26 RD-01 SH01 が承認）で、`openapi.yaml` の `Conversation` に `firstQuestionText` を足した（`listConversations` と `createConversation` の応答）。
- 1.3: X-04 CR-018（2026-11-27 RD-01 SH01 が承認）で、`createConversation` の画面の欄から SCR-002-A05 を外した。API は変えない。
- 1.4: X-04 CR-020（2026-11-27 RD-01 SH01 が承認）で、`postResearchReport`（IF-005）、`listResearchTopics`、`getResearchReport` を足し、`Home` に `research` を足した。IF-005 の各欄の上限は Q-096 の答え（2026-11-27）による。
- 書いた AI: Claude（Opus 5.5）。人の承認の前の案である。

## 1. 正本の定義ファイル

| 項目 | 決まり |
|---|---|
| ファイルの場所 | `docs/api/openapi.yaml`。端末の API（`/api/app/`、`/register`）、配信元の API（`/api/inbox/`、`/api/learning/`）、状態の API（`/api/health`）を1つのファイルに書く。構成要素の間（Web サーバと AI Runner）は API で呼び合わず、DB の待ち行列で受け渡す（ADR-012）ので、AsyncAPI のファイルは作らない |
| 形式と版 | OpenAPI 3.1.0 |
| 形式の検査 | Redocly CLI の `lint` で、形式の誤りと参照の抜けを確かめる（ADR-021）。検証のコマンドに入れ、コミットの前と CI で動かす（コマンドの中身は DD-09） |
| 実装との一致の確かめ方 | M10（DD-01）の zod の形は、定義ファイルを見て手で書く。DD-10 の結合テストで、全ての operation の応答の本文を、定義ファイルの schema で Ajv を使って確かめる（ADR-021）。SSE（`streamReply`）と転送（`openRegistration`）は schema で表しきれないので、出来事の並びと `Location`・`Set-Cookie` を DD-10 の個別のテストで確かめる |

## 2. API の一覧

| operationId | メソッドとパス | 公開の範囲 | 標準のメソッドか | 起こりうるエラーの分類（DD-06） |
|---|---|---|---|---|
| `getHome` | GET `/api/app/home` | 端末に公開 | Get | E03、E08、E16 |
| `getGalaxy` | GET `/api/app/news/galaxy` | 端末に公開 | Get（1日分の図を1つのリソースとして読む） | E01、E03、E08、E16 |
| `getArticle` | GET `/api/app/news/articles/{contentId}` | 端末に公開 | Get | E03、E05、E08、E16 |
| `markOpened` | POST `/api/app/contents/{contentId}/opened` | 端末に公開 | 独自（開いた日時を一度だけ入れる。値を渡さない操作なので Update にしない） | E03、E04、E05、E08、E16 |
| `setRead` | PUT `/api/app/contents/{contentId}/read` | 端末に公開 | Update | E01、E03、E04、E05、E06、E08、E16 |
| `setSaved` | PUT `/api/app/contents/{contentId}/saved` | 端末に公開 | Update | E01、E03、E04、E05、E06、E08、E16 |
| `listEnglishSets` | GET `/api/app/english/sets` | 端末に公開 | List | E01、E03、E08、E16 |
| `getEnglishSet` | GET `/api/app/english/sets/{contentId}` | 端末に公開 | Get | E03、E05、E08、E16 |
| `putEnglishAnswer` | PUT `/api/app/english/sets/{contentId}/answer` | 端末に公開 | Update（答えを丸ごと置き換える） | E01、E03、E04、E05、E07、E08、E16 |
| `listInbox` | GET `/api/app/contents/inbox` | 端末に公開 | List | E01、E03、E08、E16 |
| `searchContents` | GET `/api/app/contents/search` | 端末に公開 | List（検索の言葉で絞る） | E01、E03、E08、E16 |
| `listSaved` | GET `/api/app/contents/saved` | 端末に公開 | List | E01、E03、E08、E16 |
| `listConversations` | GET `/api/app/conversations` | 端末に公開 | List | E01、E03、E08、E16 |
| `createConversation` | POST `/api/app/conversations` | 端末に公開 | Create | E01、E03、E04、E05、E08、E16 |
| `getConversation` | GET `/api/app/conversations/{conversationId}` | 端末に公開 | Get | E03、E05、E08、E16 |
| `postQuestion` | POST `/api/app/conversations/{conversationId}/questions` | 端末に公開 | 独自（本人の発言と AI の発言と AI の実行を一度に作り、応答は非同期で返す） | E01、E03、E04、E05、E06、E08、E16 |
| `streamReply` | GET `/api/app/messages/{messageId}/stream` | 端末に公開 | 独自（SSE で続きを流す。ADR-013） | E03、E05、E08、E16。応答の失敗は state の出来事で E09、E10、E11、E12、E13（MSG-012、MSG-013） |
| `retryReply` | POST `/api/app/messages/{messageId}/retry` | 端末に公開 | 独自（状態の遷移。BD-02 3章） | E03、E04、E05、E06、E08、E16 |
| `stopReply` | POST `/api/app/messages/{messageId}/stop` | 端末に公開 | 独自（同上） | E03、E04、E05、E06、E08、E16 |
| `dismissReply` | POST `/api/app/messages/{messageId}/dismiss` | 端末に公開 | 独自（同上） | E03、E04、E05、E06、E08、E16 |
| `openRegistration` | GET `/register` | 端末に公開（鍵の無い端末も開ける） | 独自（登録の URL。ブラウザで開くので GET にする） | E01、E03、E08、E16 |
| `getHealth` | GET `/api/health` | 鍵なしで公開（3.1。Tailscale Serve の口と 127.0.0.1） | Get | E08、E16 |
| `postNewsBatch` | POST `/api/inbox/batches` | 配信元に公開（Mac mini の中の 127.0.0.1） | Create（今の cerebellum の道） | E01、E02、E03、E08、E16 |
| `postEnglishSet` | POST `/api/learning/sets` | 配信元に公開（同上） | Create（同上。同じ日付は置き換える） | E01、E02、E03、E08、E16 |
| `getEnglishSetForSender` | GET `/api/learning/sets/{date}?lane=en` | 配信元に公開（同上） | Get（同上） | E01、E03、E05、E08、E16 |
| `getEnglishResult` | GET `/api/learning/sets/{date}/result?lane=en` | 配信元に公開（同上） | Get（同上） | E01、E03、E05、E08、E16 |
| `postResearchReport` | POST `/api/research/reports` | 配信元に公開（同上。CR-020） | Create（同じ課題の同じ週は置き換える。NEXUS が決めた道で、cerebellum に元の形は無い） | E01、E02、E03、E08、E16 |
| `listResearchTopics` | GET `/api/app/research/topics` | 端末に公開（CR-020） | List（続きを持たない。課題は年に十数件） | E03、E08、E16 |
| `getResearchReport` | GET `/api/app/research/reports/{contentId}` | 端末に公開（CR-020） | Get（その週の週報と、同じ課題の週の一覧） | E03、E05、E08、E16 |

- 端末の API の道は `/api/app/` で始め、今の cerebellum の形に合わせた配信元の道（`/api/inbox/`、`/api/learning/`）と重ならないようにした。IF-005 の道（`/api/research/`）は NEXUS が新しく決めた配信元の道で、`/api/app/` と重ならない（CR-020）。
- 構成要素の間だけの API は無い（1章）。

## 3. 共通の決まり

### 3.1 認可の判定

ロールは本人1つで、ROLE の番号は振らない（X-06 で BD-08 を省いた）。判定するのは、どの鍵で呼べるかだけである。判定は M11 の handler の最初に M12 を呼んで行う（DD-01 4章）。

操作ごとのロール:

| operationId | 呼べるもの | 鍵が無い・通らないとき |
|---|---|---|
| `/api/app/` の全て | 端末の鍵（Cookie `nexus_device`）が ENT-011 の照合値と合う端末 | 401 `unauthorized`、MSG-020（DD-06 E03） |
| `openRegistration` | 鍵を求めない。登録コード（ENT-012）が有効な期限の前で、まだ使っていないこと | 303 で `/?notice=MSG-021` へ移す（端末の鍵を渡さない） |
| `postNewsBatch` | 配信元の鍵が brain-harness のもの（BD-07 4.2 配信元。IF-001） | 401 `unauthorized`、MSG-032 |
| `postEnglishSet`、`getEnglishSetForSender`、`getEnglishResult` | 配信元の鍵が sharpen のもの（IF-002、IF-003） | 401 `unauthorized`、MSG-032（DD-06 E03） |
| `postResearchReport` | 配信元の鍵が brain-research のもの（IF-005。Q-090 の答え。CR-020）。brain-harness と sharpen の鍵では通らない | 401 `unauthorized`、MSG-032（DD-06 E03） |
| `getHealth` | 鍵を求めない（Q-084 の答え、BD-10 2章。CR-011）。返すのは待ちの数と処理中の数と一番古い待ちの日時だけにし、内容と鍵は返さない | - |

- 鍵が無い、正しくない、取り消した、その連携を使えない、を応答で分けない。どれも 401 と MSG-032（配信元）か MSG-020（端末）にする。どの鍵が生きているかを外から分からなくするためである（BD-06 4.2、BD-10 T02）。
- 端末の鍵の Cookie は `HttpOnly`、`Secure`、`SameSite=Strict`、`Path=/` にし、期限は端末のブラウザが許す最も長い値にして、鍵が通るたびに延ばす（BD-10 4章 セッション）。値は鍵そのもので、DB には照合値だけを置く（作り方は DD-02）。
- データを変える端末の API（POST と PUT）は、`Origin` の欄が NEXUS のオリジン（DD-09 の設定）と同じときだけ受ける。違うか無いときは 403 `forbidden_origin` と MSG-019 を返し、何もしない（BD-10 T17）。
- データの範囲: 該当なし。利用者は本人1人で、範囲で絞らない（X-06 で BD-08、DD-07 を省いた）。

### 3.2 冪等性と再送

| operationId | 同じ要求を2回送ったときの結果 |
|---|---|
| `markOpened` | 冪等。開いた日時が入っていれば変えない |
| `setRead`、`setSaved` | 冪等（今と同じ値は DD-06 E06 として今の状態を返す）。同じ値にするだけ。2台から逆の値を続けて送ったら、後に届いた値が残る（BD-02 FN-005、BD-01 6章） |
| `putEnglishAnswer` | 冪等。答えを丸ごと置き換え、完了した日時を新しくする（BD-02 FN-012） |
| `createConversation` | 冪等でない。2回届くと会話が2つできる。画面が押してから結果が出るまで押せなくして防ぐ（BD-09 5章 誤操作の防止）。要求を見分ける欄は持たない（本人1人で、余分な会話ができても害が無いため） |
| `postQuestion` | 冪等でない。同じ会話に作成中の応答があるあいだは受けず、409 `reply_in_progress` と作成中の AI の発言を返す（BD-02 FN-015 同時に操作されたとき）。応答が完了した後に同じ文を送ると、新しい質問として受ける |
| `retryReply`、`stopReply`、`dismissReply` | 冪等（DD-06 E06）。事前条件（BD-02 FN-016）に合わないときは、何もせずに今の AI の発言を 200 で返す。2台から続けて送り直したら、先の1回だけを受ける |
| `postNewsBatch` | 記事は冪等。同じ対象日の同じ slug は置き換え、記事は増えない（NFR-015、RD-03 R01）。受け取りの記録（ENT-010）は送られるたびに1件増える（送られた事実の記録のため） |
| `postEnglishSet` | セットは冪等。同じ日付は置き換える（RD-03 R06）。受け取りの記録は1件増える |
| `postResearchReport` | 週報は冪等。同じ課題の同じ週は置き換え、既読と保存は残す（RD-03 R23。CR-020）。応答の `replaced` が真になる。受け取りの記録は1件増える。過去の週を送り直しても、研究課題の課題名と状態は最新の週のまま（DD-02 FN-025 手順 6.2） |
| `openRegistration` | 冪等でない。登録コードは1回だけ使え、2回目は MSG-021 になる（BD-02 FN-023） |

再送してよい応答:

- 端末の画面は、自動で送り直さない。500 と、つながらないときは、MSG-003、MSG-007、MSG-019 を出し、本人が押し直す（BD-09）。
- `streamReply` は、切れたら画面（M09）が `Last-Event-ID` を付けてつなぎ直す。Web サーバは最初の出来事の前に `retry: 3000`（3秒）を送る。応答の状態が作成中のあいだは、つなぎ直しを続ける。
- 配信元は、500 とつながらないときに、同じ内容を送り直してよい（記事とセットは置き換えになるため）。400、401、413 は、直さずに送り直しても同じ結果になる。配信元の今の作りでは、本人が動かし直す（Q-032 の答え）。

### 3.3 ページングとフィルタ

| 項目 | 決まり |
|---|---|
| ページング | 続きを表すトークン（`cursor`）。トークンは、並べる値と ID の組を base64url にした文字で、画面は中身を読まない。1ページの件数は既定 30、上限 50（`limit`）。30 は一覧の画面を2画面ほど埋める数で、NFR-001 の2秒に収まるかは DD-10 の性能の試験で確かめる（BD-09 5章 一覧の決まり） |
| データが変わったとき | トークンは並べる値と ID の後から読むので、後から届いた内容は次のページに混ざらない（一覧を開き直すと出る）。保存し直して保存した日時が変わった内容は、別の位置に移ることがある |
| フィルタと並び順（フィルタ） | `searchContents` の `q`（BD-02 FN-018、DD-03 3章の探し方）と、`listConversations` の `targetContentId`（省くと対象の無い会話）だけ。ほかに絞り込みと並べ替えの切り替えは受けない（BD-09 5章） |
| フィルタと並び順（並び順） | `listInbox`、`searchContents` は届いた日時の新しい順。`listSaved` は保存した日時の新しい順。`listEnglishSets` は対象日の新しい順。`listConversations` は最後に話した日時の新しい順。同じ値のときは ID の大きい順。`listResearchTopics` は最後に届いた日時の新しい順で、続きを持たない（課題は同時に1〜3個。CR-020）。`getResearchReport` の `weeks` は週の大きい順 |

### 3.4 エラー

エラーの形は、定義ファイルの `Error`（今の cerebellum の `{ "error": { "code", "message" } }` に `messageId` を足したもの）にする。`message` には MSG の文言を入れる。内部の分類は DD-06 で決める。

エラーとメッセージの対応:

| 状態の番号 | `code` | 起きるとき | 画面で出す MSG | 分類（DD-06） |
|---|---|---|---|---|
| 400 | `bad_request` | 入力の形が定義ファイルと違う | `putEnglishAnswer` で ○△× の無い問題か、セットに無い問題番号があるときは MSG-005。ほかは MSG-019（画面が形を守るので、ふだんは起きない） | E01、E07 |
| 401 | `unauthorized` | 3.1 の鍵が通らない | MSG-020（端末）。配信元には MSG-032 | E03 |
| 403 | `forbidden_origin` | 3.1 のオリジンが違う | MSG-019 | E04 |
| 404 | `not_found` | 指した内容、会話、発言が無い | `getResearchReport` は MSG-048（CR-020）。`getArticle` は MSG-002。`getEnglishSet`、`getConversation` は MSG-019。`createConversation` は 404 を返さず、対象の無い会話を作って MSG-011 を返す（BD-02 FN-014） | E05 |
| 409 | `reply_in_progress` | 3.2 の `postQuestion` | 画面は質問の文を入力の欄に残し、作成中の応答を見せる | E06 |
| 413 | `payload_too_large` | 配信元の送った全体が上限を超えた（BD-06 3.2） | MSG-034（配信元） | E02 |
| 500 | `internal` | 予期しない失敗 | `setRead`、`setSaved` は MSG-003。`putEnglishAnswer` は MSG-007。`postQuestion` は MSG-019。読むだけの操作は MSG-019。`postNewsBatch` は MSG-045。`postResearchReport` は MSG-046（CR-020） | E08、E16 |

- 配信元への 400 は MSG-033（差し込む値は外れた項目の名前）、404 は MSG-035 か MSG-036 にする（BD-06 IF-003）。
- `postNewsBatch` で一部の記事だけ形が正しくないときは、200 で返し、`rejected` に slug と MSG-033 の文言を入れる（BD-06 IF-001）。全体の形か鍵か大きさが正しくないときは、何も残さず 400、401、413 を返す。
- 内部のエラーの中身は応答に入れず、ログにだけ出す（BD-10 4章 エラー）。

### 3.5 長く時間がかかる操作

非同期にする操作:

| 操作 | 受け付けで返すもの | 結果の受け取り方 |
|---|---|---|
| `postQuestion` | 202 と、本人の発言と、作成中の AI の発言（NFR-002 の処理中の印） | `streamReply` を AI の発言の ID でつなぎ、`delta` と `state` の出来事で受ける。つなげないときは `getConversation` で読む |
| `retryReply` | 作成中に戻った AI の発言 | 同上 |
| `postNewsBatch` の記事の関係の判定 | 受け取った件数だけを返し、判定の結果は返さない | 画面が `getGalaxy` と `getArticle` で読む（ADR-011、ADR-012） |

- `streamReply` の出来事: `delta`（`id` は `<実行ID>.<書き足した後の本文の長さ>`。長さは UTF-16 の単位で数える。`data` は `{"text": 続きの文}`）、`reset`（自動の送り直しか本人の送り直しで本文を作り直したとき。画面は表示している本文を空にし、続く `delta` で作り直す。RV16-01）、`state`（`data` は応答の状態と、出す MSG）。つないだとき、`Last-Event-ID` の実行が今の実行と違えば `reset` を送ってから位置 0 から送り、同じなら位置より後の本文を最初に1つの `delta` で送る。応答の状態が完了、失敗、中止になったら、`state` を送って閉じる。15秒ごとに空のコメント行を送り、途中の仕組みに切られないようにする。DB を読む間隔は DD-02 で決める。
- `streamReply` の失敗: 送り始める前の失敗（DB が使えないなど）は 500 で返す。送り始めた後の失敗では、出来事を送らずに接続を閉じ、画面は 3 秒後に `Last-Event-ID` を付けてつなぎ直す（DD-06 E08。RV16-10）。

### 3.6 版と互換性

| 項目 | 決まり |
|---|---|
| 版の付け方 | 道に版を付けない。配信元は本人のものだけで（BD-06 4.2）、端末の画面は同じ Web サーバが配るので、API と画面は同じ版で入れ替わる。配信元の API で項目を足すときは、NEXUS が先に「あってもなくてもよい」として受け、配信元が後から送る順にする（BD-06 4.2）。service worker が古い画面を持ち続けないようにする作りは DD-09 で決める |
| 項目の振る舞い | 必須は schema の `required`、決まった値は `const`、選べる値は `enum` で表す。求めと応答の形を別の schema に分けたので、`readOnly` と `writeOnly` は使わない。求めの形は `additionalProperties: false` にし、知らない項目を断る。ただし配信元の求め（`NewsBatch`、`EnglishSetPayload`）は、今の配信元が送る項目（cerebellum の `options`、`refPath` など）を断らないよう、知らない項目を読み捨てる |

## 4. 操作ごとの補足

### 4.1 副作用と性能の目標

| operationId | 副作用（変えるテーブル。DD-03） | 性能の目標 |
|---|---|---|
| `getHome` | なし | NFR-001（画面を開いてから内容が出るまで2秒以内。Web サーバの応答は、その中で 0.5 秒以内を目安にする） |
| `getGalaxy`、`getArticle` | なし（DD-06 E05、E08） | NFR-001（同上） |
| `markOpened` | `content_state`（無ければ作り、`opened_at` が空なら入れる） | - |
| `setRead` | `content_state`（`is_read`、`read_at`） | - |
| `setSaved` | `content_state`（`is_saved`、`saved_at`） | - |
| `listEnglishSets`、`getEnglishSet` | なし（DD-06 E05、E08） | NFR-001 |
| `putEnglishAnswer` | `english_answer`（置き換え）、`content_state`（既読にする） | - |
| `listInbox`、`searchContents`、`listSaved` | なし（DD-06 E08） | NFR-001 |
| `listConversations`、`getConversation` | なし（DD-06 E05、E08） | NFR-001 |
| `createConversation` | `conversation` | - |
| `postQuestion` | `message`（本人の発言と作成中の AI の発言）、`ai_run`（待ち）、`conversation`（`last_spoken_at`） | NFR-002（処理中の印を1秒以内。202 を返すまでを 0.5 秒以内の目安にする） |
| `streamReply` | なし | NFR-002（応答の最初の文字を10秒以内。AI の CLI の時間を含む） |
| `retryReply` | `message`（本文を空にして作成中に戻す）、`ai_run`（新しい実行を待ちに入れる） | - |
| `stopReply` | `ai_run`（`stop_requested` を真にする。待ちなら中止にする）、`message`（待ちの実行を中止にしたときは中止にする） | - |
| `dismissReply` | `message`（中止にする） | - |
| `openRegistration` | `device`（作る）、`registration_code`（消す） | - |
| `getHealth` | なし | - |
| `postNewsBatch` | `delivery`（1件作る）、`content`、`article`、`search_index`（作るか置き換える）、`ai_run`（1件以上残したら記事の関係の判定を待ちに入れる） | - |
| `postEnglishSet` | `delivery`、`content`、`english_set`、`search_index` | - |
| `getEnglishSetForSender`、`getEnglishResult` | なし（DD-06 E05、E08） | - |
| `postResearchReport` | `delivery`（1件作る）、`research_topic`（作るか、最新の週なら変える）、`content`、`research_report`、`search_index`（作るか置き換える）。AI の実行は作らない（CR-020） | - |
| `listResearchTopics`、`getResearchReport` | なし（DD-06 E05、E08。CR-020） | NFR-001 |

- 端末の鍵が通るたびに `device` の `last_used_at` を変える。この更新は全ての `/api/app/` の操作に共通で、表の各行には書かない（BD-02 1章）。
- 監査ログは残さない（Q-059 の答え）。AI の実行と受け取りの記録は表の `ai_run` と `delivery` に残す（NFR-020）。

### 4.2 IF-004 の CLI の出来事

IF-004 は HTTP の API ではないが、BD-06 3.2 で「出来事の項目の名前は DD-04 で実装の前の公式の文書から決める」とした。CLI の引数と設定（使えるツール、読む場所、読ませないファイル、許可の扱い）は DD-09 で決める（X-04 Q-082 の答え）。

| 項目 | 決まり |
|---|---|
| 出力の形 | `--output-format stream-json`、`--verbose`、`--include-partial-messages` を付け、標準出力の1行を1つの JSON の出来事として読む（headless の頁、streaming-output の頁）。`--include-partial-messages` が無いと文の続きが少しずつ出ない（streaming-output の頁） |
| 渡す内容 | 標準入力に文字で書く（`--input-format text`。headless の頁）。標準入力の上限は 10 MB で、超えると CLI が失敗で終わる。渡す内容の組み立てと大きさの抑え方は DD-02 |
| 応答の文の続き | `type` が `stream_event` で、`event.type` が `content_block_delta`、`event.delta.type` が `text_delta` の出来事の `event.delta.text` を、AI の発言の本文に書き足す（質問の応答、会話の要約） |
| ツールを使った出来事 | `type` が `stream_event` で、`event.type` が `content_block_start`、`event.content_block.type` が `tool_use` の出来事の `event.content_block.name` で数える。`WebSearch` はウェブの検索の回数、`WebFetch` はページの読み取りの回数、`Read`、`Glob`、`Grep` はフォルダの読み取りの回数に足す（ENT-009。ツールの名前は tools-reference の頁） |
| 終わりの出来事 | `type` が `result` の出来事。`subtype` が `success` で `is_error` が偽なら完了。記事の関係の判定は `result` の文を JSON として読み、BD-06 3.2 の記事の関係の一覧の形（DD-02 で JSON の形を決める）でなければ失敗（応答の形が正しくない）にする。`subtype` が `success` 以外か `is_error` が真なら失敗にし、`errors` の文を失敗の理由の元にする（認証の情報を入れない。NFR-019） |
| AI を動かす仕組みが使えない | `type` が `assistant` の出来事の `error` が `authentication_failed`、`oauth_org_not_allowed`、`account_on_hold`、`billing_error`、`rate_limit` のどれか、または CLI が起動できないときは、失敗の理由を「AI を動かす仕組みが使えない」にし、自動で送り直さない（BD-06 IF-004）。ほかの `error`（`overloaded`、`server_error` など）は、時間の上限と同じ扱いで1回だけ自動で送り直す |
| 終了の状態 | 終了コード 0 で `result` の出来事があれば、`result` で決める。0 でないか `result` が無ければ失敗（途中で止まった）にする。AI Runner が止めたとき（5分を超えた、本人が止めた）は、AI Runner の側で失敗か中止に決め、CLI の終了コードを見ない |
| ほかの出来事 | `system`（`init`、`api_retry` など）と `user` と、上に無い `stream_event` は読み捨てる。`system` の `api_retry` はログに出す |

- `result` の `subtype`、`is_error`、`errors` の名前は Agent SDK の TypeScript の文書（`SDKResultMessage`）から取った。CLI の出力で同じ名前かは文書で確かめられなかったので、DD-10 で、本番の CLI の出力を1回分記録して、この表の名前で読めることを確かめるテストを置く。CLI の版が変わって名前が変わったときは、このテストが落ちて気付ける。
- `assistant` の `error` の値も同じ文書（`SDKAssistantMessage`）から取った。

## 5. 上流との対応

| operationId | IF・FN・SCR アクション | 呼べるロール | 主な ENT |
|---|---|---|---|
| `getHome` | FN-020、SCR-001-A01 | 本人（端末の鍵） | ENT-001、ENT-002、ENT-003、ENT-004、ENT-005、ENT-006、ENT-008、ENT-009、ENT-010（週報の未読は ENT-001 と ENT-006 で数える） |
| `getGalaxy` | FN-003、SCR-002-A01、SCR-002-A02、SCR-002-A03 | 本人 | ENT-001、ENT-002、ENT-004、ENT-006 |
| `getArticle` | FN-004、SCR-002-A04、SCR-003-A01、SCR-003-A06、SCR-001-A04 | 本人 | ENT-001、ENT-002、ENT-004、ENT-006 |
| `markOpened` | FN-004、FN-009、FN-027、SCR-003-A01、SCR-005-A01、SCR-011-A01 | 本人 | ENT-006 |
| `setRead` | FN-005、SCR-003-A02、SCR-003-A03、SCR-005-A12、SCR-011-A04、SCR-011-A05 | 本人 | ENT-006 |
| `setSaved` | FN-006、SCR-003-A04、SCR-005-A08、SCR-011-A06 | 本人 | ENT-006 |
| `listEnglishSets` | FN-008、SCR-004-A01、SCR-004-A03 | 本人 | ENT-001、ENT-003、ENT-005、ENT-006 |
| `getEnglishSet` | FN-009、SCR-004-A02、SCR-005-A01、SCR-005-A11 | 本人 | ENT-001、ENT-003、ENT-005、ENT-006 |
| `putEnglishAnswer` | FN-012、SCR-005-A07 | 本人 | ENT-005、ENT-006 |
| `listInbox` | FN-017、SCR-007-A01、SCR-007-A03 | 本人 | ENT-001、ENT-006 |
| `searchContents` | FN-018、SCR-008-A01、SCR-008-A02、SCR-008-A04 | 本人 | ENT-001、ENT-002、ENT-003 |
| `listSaved` | FN-019、SCR-009-A01、SCR-009-A03 | 本人 | ENT-001、ENT-006 |
| `listConversations` | FN-014、SCR-006-A01 | 本人 | ENT-007 |
| `createConversation` | FN-014、SCR-006-A03、SCR-001-A05、SCR-003-A05、SCR-005-A09、SCR-011-A07 | 本人 | ENT-001、ENT-007 |
| `getConversation` | FN-014、SCR-006-A02 | 本人 | ENT-007、ENT-008 |
| `postQuestion` | FN-015、SCR-006-A04 | 本人 | ENT-007、ENT-008、ENT-009 |
| `streamReply` | FN-015、FN-016、SCR-006-A04、SCR-006-A05 | 本人 | ENT-008 |
| `retryReply` | FN-016、SCR-006-A05 | 本人 | ENT-008、ENT-009 |
| `stopReply` | FN-016、SCR-006-A06 | 本人 | ENT-008、ENT-009 |
| `dismissReply` | FN-016、SCR-006-A07 | 本人 | ENT-008 |
| `openRegistration` | FN-023 | 本人（登録コード） | ENT-011、ENT-012 |
| `getHealth` | BD-01 6章 監視、BD-11 OP04 | 鍵なし（CR-011） | ENT-009 |
| `postNewsBatch` | IF-001、FN-001 | 配信元 brain-harness | ENT-001、ENT-002、ENT-009、ENT-010、ENT-013 |
| `postEnglishSet` | IF-002、FN-007 | 配信元 sharpen | ENT-001、ENT-003、ENT-010、ENT-013 |
| `getEnglishSetForSender` | IF-003、FN-013 | 配信元 sharpen | ENT-001、ENT-003、ENT-013 |
| `getEnglishResult` | IF-003、FN-013 | 配信元 sharpen | ENT-005、ENT-013 |
| `postResearchReport` | IF-005、FN-025 | 配信元 brain-research | ENT-001、ENT-010、ENT-013、ENT-014、ENT-015 |
| `listResearchTopics` | FN-026、SCR-010-A01 | 本人 | ENT-001、ENT-006、ENT-014、ENT-015 |
| `getResearchReport` | FN-027、SCR-010-A02、SCR-011-A01、SCR-011-A03、SCR-007-A02、SCR-008-A03、SCR-009-A02 | 本人 | ENT-001、ENT-006、ENT-014、ENT-015 |

- BD-06 の API の連携 IF-001〜IF-003、IF-005 は、全てこの表にある。IF-004 は API でないので 4.2 に書いた。
- BD-03 のデータを変えるアクション（SCR-003-A01〜A04、SCR-005-A01、A07、A08、A12、SCR-006-A03〜A07、SCR-011-A01、A04〜A07）は、全てこの表にある。SCR-011-A02 と A08 は画面の中の動きとブラウザで開くだけである（CR-020）。SCR-005-A04〜A06、A10、A11 は答えと採点を画面の中に預けるだけで、API を呼ばない（BD-02 FN-010、FN-011。A11 は `getEnglishSet` の前の答えを初めの値にする）。SCR-001-A02、A03、SCR-003-A07、SCR-005-A02、A03 は画面の中の動きか遷移だけである。
- `getHealth` は BD-01 6章 監視の「状態を返す API」で、FN に対応しない。
- BD-02 の FN-002、FN-021、FN-022、FN-024、FN-028 は API を持たない（AI Runner、定期ジョブ、管理のコマンド、送信のコマンド。DD-01。FN-028 は IF-005 を呼ぶ側）。FN-010、FN-011 は画面の中だけで動く。

## 6. 未決事項

この書類で起こした未決事項は全て決まった（Q-084。答えは X-04）。
