---
id: DD-03
name: DB 物理設計書
phase: 詳細設計
version: 1.1
updated: 2026-11-27
---

# DD-03 DB 物理設計書（NEXUS）

- 読んだもの: BD-07 1.1、BD-01 1.2、BD-02 1.1（FN-001、FN-002、FN-018、5章）、BD-06 1.1（3.2）、BD-10 1.1（4章）、X-02 1.3、X-03 1.1、X-04 1.1（CR-010 まで）、X-07 1.2、DD-01 0.1。X-06 で BD-12 と BD-14 を省いたので読まない。
- node:sqlite で使える機能と、検索の索引の大きさは、この Mac mini の Node.js 26.12.1（SQLite 3.54.1）で確かめた（2026-11-24。ADR-020、4章）。
- 0.1: 初めて書いた（2026-11-24）。
- 0.2: X-05 RV16 の指摘で直した（2026-11-25）。`content.kind` の値の検査制約を外し（RV16-05）、多重起動の印の `job_lock` を足した（RV16-03）。
- 1.0: 詳細設計の完了判定（X-05 PG03。2026-11-25 RD-01 SH01。進める）で承認した。
- 1.1: X-04 CR-020（2026-11-27 RD-01 SH01 が承認）で、`research_topic`（ENT-014）と `research_report`（ENT-015）と索引を足し、`delivery` と `sender_key` の `sender` の検査制約に `brain-research` を足した。外部キーの検査を止めて当てるマイグレーションの決まりと、`0002-research-report.sql` の中身を5章に足した（Q-088、Q-090、Q-096 の答え）。
- 書いた AI: Claude（Opus 5.5）。人の承認の前の案である。

## 1. 物理設計の前提

| 項目 | 決まり |
|---|---|
| データベースの製品と版 | SQLite（ADR-007）。Node.js に入っている `node:sqlite` から使う（ADR-020）。SQLite の版は Node.js の版で決まり、Node.js の版は DD-09 で決める。この書類は、FTS5 の trigram、部分の索引、式の索引、STRICT の表、`json_valid` が使える版を前提にする（2026-11-24 に SQLite 3.54.1 で確かめた） |
| 物理名の付け方 | X-07 2章（CR-010 で直した）。テーブル名とカラム名は snake_case の単数形にする。テーブル名は X-03 のエンティティの英語名を使う。カラム名は 2.2 の「対応する属性」の表を正とする。主キーの通し番号は `<テーブル名>_id`、日時は `_at`、日付は `_date`、真偽は `is_` で始める。Markdown の文は `_md`、JSON の構造は `_json` で終える |
| 共通のカラム | 置かない。全てのエンティティは BD-07 で自分の日時の属性（届いた日時、作った日時など）を持ち、利用者は本人1人で作った人を分ける必要が無く（BD-08 を省いた）、操作の記録も残さない（Q-059 の答え）ためである |
| 文字コードと照合順序 | UTF-8（BD-01 6章）。比較と並べ替えは SQLite の既定（BINARY）にする。大文字と小文字、全角と半角を区別しない検索（FN-018。Q-081 の答え）は、3章の検索の索引で行う |
| 型の決まり | 全てのテーブルを STRICT にし、型は INTEGER と TEXT だけを使う。通し番号の主キーは `INTEGER PRIMARY KEY AUTOINCREMENT` にし、消した番号を使い回さない（BD-07 4.1 通し番号） |
| 日付の検査 | TEXT の `YYYY-MM-DD`（日本時間の日付）。検査制約で `GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'` に合うものだけを入れる |
| 日時の検査 | TEXT の `YYYY-MM-DDTHH:MM:SS.sss+09:00`（日本時間で、時差を付ける。BD-01 6章）。全ての日時を同じ時差で書くので、文字の順で並べると時刻の順になる。検査制約で、この形の GLOB に合うものだけを入れる |
| 真偽の検査 | INTEGER の 0（偽）か 1（真）。検査制約で 0 と 1 のほかを入れない |
| JSON の検査 | 構造の属性（問題、読む教材、答え、質問の対象）は TEXT の JSON にし、検査制約で `json_valid` が真のものだけを入れる。中の項目の形は、入れる前に業務層が zod で確かめる（ADR-019、DD-01 M15・M16） |
| 外部キー | 接続のたびに外部キーの検査を有効にする（DD-01 M21）。削除と更新の動きは、全て拒否にする（2.2 の制約の列）。消してよい順は業務層が守る（2.3） |

## 2. テーブル定義

### 2.1 テーブル概要

| テーブル名 | 対応するエンティティ | 論理と違う形にした理由 | 件数と増え方 |
|---|---|---|---|
| `content` | ENT-001 内容 | なし | BD-07 2章 ENT-001 |
| `article` | ENT-002 記事 | なし | BD-07 2章 ENT-002 |
| `english_set` | ENT-003 英語のセット | なし | BD-07 2章 ENT-003 |
| `article_relation` | ENT-004 記事の関係 | なし | BD-07 2章 ENT-004 |
| `english_answer` | ENT-005 英語の答え | なし | BD-07 2章 ENT-005 |
| `content_state` | ENT-006 内容の状態 | なし | BD-07 2章 ENT-006 |
| `conversation` | ENT-007 会話 | なし | BD-07 2章 ENT-007 |
| `message` | ENT-008 発言 | なし | BD-07 2章 ENT-008 |
| `ai_run` | ENT-009 AI の実行 | なし | BD-07 2章 ENT-009 |
| `delivery` | ENT-010 受け取りの記録 | なし | BD-07 2章 ENT-010 |
| `device` | ENT-011 端末 | なし | BD-07 2章 ENT-011 |
| `registration_code` | ENT-012 登録コード | なし | BD-07 2章 ENT-012 |
| `sender_key` | ENT-013 配信元の鍵 | なし | BD-07 2章 ENT-013 |
| `research_topic` | ENT-014 研究課題（CR-020） | なし | BD-07 2章 ENT-014 |
| `research_report` | ENT-015 週報（CR-020） | なし | BD-07 2章 ENT-015 |
| `search_index` | 物理のみ（ENT-001、ENT-002、ENT-003、ENT-015 の検索の写し） | FN-018 の検索（大文字と小文字、全角と半角を区別せず、空白で区切った言葉を全て含む。Q-081 の答え）を、NFR-001 の時間に収めるため。FTS5 の仮想のテーブルにする（3章） | `content` と同じ数 |
| `schema_migration` | 物理のみ | 当てたマイグレーションを残すため（5章） | マイグレーションの数 |
| `job_lock` | 物理のみ | 定期ジョブの多重起動を防ぐ印（DD-05 4章。RV16-03） | 動いているジョブの数（0〜2 行） |

### 2.2 カラム定義

#### `content`（ENT-001）

| カラム名 | 対応する属性 | 型と桁 | NULL | 既定値 | 制約 |
|---|---|---|---|---|---|
| `content_id` | 内容ID | INTEGER | 不可 | なし | 主キー（AUTOINCREMENT） |
| `kind` | 種類 | TEXT | 不可 | なし | 検査制約 空でない。値（BD-07 4.2 の情報の種類）は DD-01 M14 の種類の一覧で確かめる。種類を足すときに表を作り直さずに済むよう、値の検査制約を置かない（NFR-004。RV16-05） |
| `title` | 見出し | TEXT | 不可 | なし | 検査制約 空でなく、改行を含まない。上限の文字数は受け取りで確かめる（BD-06、DD-04） |
| `target_date` | 対象日 | TEXT | 不可 | なし | 日付の検査（1章） |
| `received_at` | 届いた日時 | TEXT | 不可 | なし | 日時の検査（1章） |
| `delivery_id` | 受け取りの記録ID | INTEGER | 可 | なし | 外部キー `delivery`。削除と更新は拒否する。BAT-002 が先に空にする（2.3） |

#### `article`（ENT-002）

| カラム名 | 対応する属性 | 型と桁 | NULL | 既定値 | 制約 |
|---|---|---|---|---|---|
| `content_id` | 内容ID | INTEGER | 不可 | なし | 主キー。外部キー `content`。削除と更新は拒否する |
| `slug` | slug | TEXT | 不可 | なし | 検査制約 12文字で、0〜9 と a〜f だけ（BD-07 4.1） |
| `guide_md` | 案内 | TEXT | 不可 | なし | なし |
| `source_url` | 元の記事の URL | TEXT | 不可 | なし | 検査制約 `http://` か `https://` で始まる（BD-07 4.1 URL、NFR-018） |
| `image_url` | 画像の URL | TEXT | 可 | なし | 検査制約 空でなければ `http://` か `https://` で始まる |
| `theme` | テーマ | TEXT | 不可 | なし | 検査制約 空でない |

#### `english_set`（ENT-003）

| カラム名 | 対応する属性 | 型と桁 | NULL | 既定値 | 制約 |
|---|---|---|---|---|---|
| `content_id` | 内容ID | INTEGER | 不可 | なし | 主キー。外部キー `content`。削除と更新は拒否する |
| `learning_theme` | 学習テーマ | TEXT | 不可 | なし | 検査制約 空でない |
| `lesson_body_md` | 教材の本文 | TEXT | 不可 | なし | 検査制約 空でない |
| `closing_md` | 締めの一言 | TEXT | 可 | なし | なし |
| `problems_json` | 問題の一覧 | TEXT | 不可 | なし | JSON の検査（1章）。検査制約 JSON の配列で、1〜60件 |
| `reading_json` | 読む教材 | TEXT | 可 | なし | 空でなければ JSON の検査 |
| `raw_payload_json` | 届いたセットの原文 | TEXT | 不可 | なし | JSON の検査 |

#### `article_relation`（ENT-004）

| カラム名 | 対応する属性 | 型と桁 | NULL | 既定値 | 制約 |
|---|---|---|---|---|---|
| `from_content_id` | 関係の元 | INTEGER | 不可 | なし | 主キー（`from_content_id`、`to_content_id` の組）。外部キー `article`。削除と更新は拒否する |
| `to_content_id` | 関係の先 | INTEGER | 不可 | なし | 主キー（同上）。外部キー `article`。削除と更新は拒否する。検査制約 `from_content_id` と違う |
| `relation_type` | 関係の種類 | TEXT | 不可 | なし | 検査制約 `follow_up`、`background`、`same_actor`、`related_topic` のどれか（BD-07 4.2） |
| `reason` | 関係の根拠 | TEXT | 不可 | なし | 検査制約 空でない |
| `judged_at` | 判定した日時 | TEXT | 不可 | なし | 日時の検査 |
| `is_active` | 有効 | INTEGER | 不可 | 1 | 真偽の検査 |

- 同じ2つの記事の関係を向きを問わず1件にする規則（BD-07 ENT-004）は、3章の一意の式の索引で守る。

#### `english_answer`（ENT-005）

| カラム名 | 対応する属性 | 型と桁 | NULL | 既定値 | 制約 |
|---|---|---|---|---|---|
| `content_id` | 内容ID | INTEGER | 不可 | なし | 主キー。外部キー `english_set`。削除と更新は拒否する |
| `answers_json` | 答えの一覧 | TEXT | 不可 | なし | JSON の検査。検査制約 JSON の配列 |
| `completed_at` | 完了した日時 | TEXT | 不可 | なし | 日時の検査 |

#### `content_state`（ENT-006）

| カラム名 | 対応する属性 | 型と桁 | NULL | 既定値 | 制約 |
|---|---|---|---|---|---|
| `content_id` | 内容ID | INTEGER | 不可 | なし | 主キー。外部キー `content`。削除と更新は拒否する |
| `opened_at` | 開いた日時 | TEXT | 可 | なし | 空でなければ日時の検査 |
| `is_read` | 既読 | INTEGER | 不可 | 0 | 真偽の検査 |
| `read_at` | 既読にした日時 | TEXT | 可 | なし | 空でなければ日時の検査。検査制約 `is_read` が 1 なら空でない |
| `is_saved` | 保存 | INTEGER | 不可 | 0 | 真偽の検査 |
| `saved_at` | 保存した日時 | TEXT | 可 | なし | 空でなければ日時の検査。検査制約 `is_saved` が 1 なら空でない |

#### `conversation`（ENT-007）

| カラム名 | 対応する属性 | 型と桁 | NULL | 既定値 | 制約 |
|---|---|---|---|---|---|
| `conversation_id` | 会話ID | INTEGER | 不可 | なし | 主キー（AUTOINCREMENT） |
| `target_content_id` | 対象の内容 | INTEGER | 可 | なし | 外部キー `content`。削除と更新は拒否する |
| `question_target_json` | 対象の箇所 | TEXT | 可 | なし | 空でなければ JSON の検査。検査制約 `target_content_id` が空でなければ空でない |
| `started_at` | 始めた日時 | TEXT | 不可 | なし | 日時の検査 |
| `last_spoken_at` | 最後に話した日時 | TEXT | 不可 | なし | 日時の検査 |
| `summary_md` | 会話の要約 | TEXT | 可 | なし | なし |
| `summary_last_message_id` | 要約に含めた最後の発言 | INTEGER | 可 | なし | 外部キー `message`。削除と更新は拒否する。検査制約 `summary_md` が空でなければ空でない |

#### `message`（ENT-008）

| カラム名 | 対応する属性 | 型と桁 | NULL | 既定値 | 制約 |
|---|---|---|---|---|---|
| `message_id` | 発言ID | INTEGER | 不可 | なし | 主キー（AUTOINCREMENT） |
| `conversation_id` | 会話ID | INTEGER | 不可 | なし | 外部キー `conversation`。削除と更新は拒否する |
| `speaker` | 話し手 | TEXT | 不可 | なし | 検査制約 `owner` か `ai`（BD-07 4.2） |
| `body_md` | 本文 | TEXT | 不可 | `''` | 検査制約 `speaker` が `owner` なら空でない（作成中の応答だけが空でよい） |
| `sent_at` | 送った日時 | TEXT | 不可 | なし | 日時の検査 |
| `reply_state` | 応答の状態 | TEXT | 可 | なし | 検査制約 空か、`writing`、`done`、`failed`、`cancelled` のどれか（BD-07 4.2） |
| `reply_to_message_id` | 答える質問 | INTEGER | 可 | なし | 外部キー `message`。削除と更新は拒否する。一意 |
| `ai_input_copy` | AI に渡した内容の写し | TEXT | 可 | なし | なし（必須の条件は 2.3） |

- 検査制約（話し手ごとの持ち方。BD-07 ENT-008 の一貫性の規則）: `speaker` が `owner` なら `reply_state`、`reply_to_message_id`、`ai_input_copy` は全て空。`speaker` が `ai` なら `reply_state` と `reply_to_message_id` は空でない。

#### `ai_run`（ENT-009）

| カラム名 | 対応する属性 | 型と桁 | NULL | 既定値 | 制約 |
|---|---|---|---|---|---|
| `ai_run_id` | 実行ID | INTEGER | 不可 | なし | 主キー（AUTOINCREMENT） |
| `purpose` | 目的 | TEXT | 不可 | なし | 検査制約 `answer`、`relate`、`summarize` のどれか（BD-07 4.2） |
| `state` | 状態 | TEXT | 不可 | `queued` | 検査制約 `queued`、`running`、`done`、`failed`、`cancelled` のどれか |
| `reply_message_id` | 応答の発言 | INTEGER | 可 | なし | 外部キー `message`。削除と更新は拒否する |
| `summary_conversation_id` | 要約する会話 | INTEGER | 可 | なし | 外部キー `conversation`。削除と更新は拒否する |
| `relate_delivery_id` | 判定する受け取り | INTEGER | 可 | なし | 外部キー `delivery`。削除と更新は拒否する |
| `attempt` | 回目 | INTEGER | 不可 | 1 | 検査制約 1以上 |
| `created_at` | 作った日時 | TEXT | 不可 | なし | 日時の検査 |
| `started_at` | 始めた日時 | TEXT | 可 | なし | 空でなければ日時の検査。検査制約 `state` が `running`、`done`、`failed` なら空でない |
| `finished_at` | 終わった日時 | TEXT | 可 | なし | 空でなければ日時の検査。検査制約 `state` が `done`、`failed`、`cancelled` なら空でない |
| `failure_reason` | 失敗の理由 | TEXT | 可 | なし | 検査制約 `state` が `failed` なら空でない |
| `stop_requested` | 止める求め | INTEGER | 不可 | 0 | 真偽の検査 |
| `web_search_count` | ウェブの検索の回数 | INTEGER | 不可 | 0 | 検査制約 0以上 |
| `web_fetch_count` | ページの読み取りの回数 | INTEGER | 不可 | 0 | 検査制約 0以上 |
| `folder_read_count` | フォルダの読み取りの回数 | INTEGER | 不可 | 0 | 検査制約 0以上 |

- 検査制約（目的に合う1つだけを持つ。BD-07 ENT-009 の一貫性の規則）: `purpose` が `answer` なら `reply_message_id` だけ、`summarize` なら `summary_conversation_id` だけ、`relate` なら `relate_delivery_id` だけが空でない。

#### `delivery`（ENT-010）

| カラム名 | 対応する属性 | 型と桁 | NULL | 既定値 | 制約 |
|---|---|---|---|---|---|
| `delivery_id` | 記録ID | INTEGER | 不可 | なし | 主キー（AUTOINCREMENT） |
| `sender` | 配信元 | TEXT | 不可 | なし | 検査制約 `brain-harness`、`sharpen`、`brain-research` のどれか（BD-07 4.2。`brain-research` は CR-020） |
| `target_date` | 対象日 | TEXT | 可 | なし | 空でなければ日付の検査。検査制約 `result` が `accepted` なら空でない |
| `received_at` | 受け取った日時 | TEXT | 不可 | なし | 日時の検査 |
| `item_count` | 件数 | INTEGER | 不可 | なし | 検査制約 0以上 |
| `result` | 結果 | TEXT | 不可 | なし | 検査制約 `accepted` か `rejected` |
| `rejection_reason` | 断った理由 | TEXT | 可 | なし | 検査制約 `result` が `rejected` なら空でない |

#### `device`（ENT-011）

| カラム名 | 対応する属性 | 型と桁 | NULL | 既定値 | 制約 |
|---|---|---|---|---|---|
| `device_id` | 端末ID | INTEGER | 不可 | なし | 主キー（AUTOINCREMENT） |
| `device_name` | 端末の名前 | TEXT | 不可 | なし | 一意。検査制約 空でない |
| `device_key_hash` | 端末の鍵の照合値 | TEXT | 不可 | なし | 一意。検査制約 空でない。作り方は DD-02 |
| `registered_at` | 登録した日時 | TEXT | 不可 | なし | 日時の検査 |
| `last_used_at` | 最後に使った日時 | TEXT | 不可 | なし | 日時の検査 |

#### `registration_code`（ENT-012）

| カラム名 | 対応する属性 | 型と桁 | NULL | 既定値 | 制約 |
|---|---|---|---|---|---|
| `code_hash` | コードの照合値 | TEXT | 不可 | なし | 主キー。検査制約 空でない |
| `device_name` | 端末の名前 | TEXT | 不可 | なし | 検査制約 空でない |
| `issued_at` | 出した日時 | TEXT | 不可 | なし | 日時の検査 |
| `expires_at` | 有効な期限 | TEXT | 不可 | なし | 日時の検査。検査制約 `issued_at` より後 |

#### `sender_key`（ENT-013）

| カラム名 | 対応する属性 | 型と桁 | NULL | 既定値 | 制約 |
|---|---|---|---|---|---|
| `sender` | 配信元 | TEXT | 不可 | なし | 主キー。検査制約 `brain-harness`、`sharpen`、`brain-research` のどれか（`brain-research` は CR-020） |
| `key_hash` | 鍵の照合値 | TEXT | 不可 | なし | 一意。検査制約 空でない。作り方は DD-02 |
| `issued_at` | 用意した日時 | TEXT | 不可 | なし | 日時の検査 |

#### `research_topic`（ENT-014。CR-020）

| カラム名 | 対応する属性 | 型と桁 | NULL | 既定値 | 制約 |
|---|---|---|---|---|---|
| `topic_id` | 課題番号 | INTEGER | 不可 | なし | 主キー（AUTOINCREMENT） |
| `topic_key` | 課題の ID | TEXT | 不可 | なし | 一意。検査制約 1〜64文字で、a〜z、0〜9、`-` だけ（Q-096 の答え） |
| `title` | 課題名 | TEXT | 不可 | なし | 検査制約 空でなく、改行を含まない。200文字までは受け取りで確かめる |
| `status` | 状態 | TEXT | 不可 | なし | 検査制約 `active` か `ended`（BD-07 4.2 課題の状態） |
| `last_week` | 最後に届いた週 | INTEGER | 不可 | なし | 検査制約 1以上 |
| `last_received_at` | 最後に届いた日時 | TEXT | 不可 | なし | 日時の検査 |

#### `research_report`（ENT-015。CR-020）

| カラム名 | 対応する属性 | 型と桁 | NULL | 既定値 | 制約 |
|---|---|---|---|---|---|
| `content_id` | 内容ID | INTEGER | 不可 | なし | 主キー。外部キー `content`。削除と更新は拒否する |
| `topic_id` | 課題番号 | INTEGER | 不可 | なし | 外部キー `research_topic`。削除と更新は拒否する。`topic_id` と `week` の組で一意（3章 `research_report_week_uq`。RD-03 R23） |
| `week` | 何週目か | INTEGER | 不可 | なし | 検査制約 1以上 |
| `sent_on` | 送った日 | TEXT | 不可 | なし | 日付の検査 |
| `status` | 状態 | TEXT | 不可 | なし | 検査制約 `active` か `ended` |
| `answer_md` | 現時点の答え | TEXT | 不可 | なし | 検査制約 空でない |
| `approaches_json` | 方法の一覧 | TEXT | 不可 | なし | JSON の検査（1章）。検査制約 JSON の配列で、0〜15件（Q-088 の答え） |
| `unknowns_md` | まだ分かっていないこと | TEXT | 不可 | `''` | なし（空の文字を許す） |
| `changes_md` | 今週の変化 | TEXT | 不可 | なし | 検査制約 空でない |

- `approaches_json` の1件は `{ "title", "howToMd", "sourceUrls", "marks", "counterMd" }`（BD-06 IF-005 3.2 の名前のまま）。出典の数は持たず、読むときに `sourceUrls` の数で数える（Q-088 の答え）。

#### `search_index`（物理のみ）

FTS5 の仮想のテーブルで、分け方は `trigram`（大文字と小文字を区別しない設定）にする。

| カラム名 | 対応する属性 | 型と桁 | NULL | 既定値 | 制約 |
|---|---|---|---|---|---|
| `content_id` | 物理のみ（`content` の内容ID。索引にしない列） | 文字か数（FTS5 は型を持たない） | - | なし | なし（外部キーは FTS5 に付けられない。2.3） |
| `body` | 物理のみ（ENT-001 見出し、ENT-002 案内、ENT-003 教材の本文、ENT-015 現時点の答えと方法の見出し（CR-020）を、改行でつないで NFKC で正規化し、小文字にした文） | 同上 | - | なし | なし |

- NFKC の正規化は、全角と半角を区別しないため（Q-081 の答え）に、業務層が入れる前に行う。SQLite の関数では行えないので、トリガーにしない（3章）。

#### `schema_migration`（物理のみ）

| カラム名 | 対応する属性 | 型と桁 | NULL | 既定値 | 制約 |
|---|---|---|---|---|---|
| `version` | 物理のみ（マイグレーションの番号） | INTEGER | 不可 | なし | 主キー |
| `name` | 物理のみ（マイグレーションのファイルの名前） | TEXT | 不可 | なし | なし |
| `applied_at` | 物理のみ（当てた日時） | TEXT | 不可 | なし | 日時の検査 |

#### `job_lock`（物理のみ）

| カラム名 | 対応する属性 | 型と桁 | NULL | 既定値 | 制約 |
|---|---|---|---|---|---|
| `job_name` | 物理のみ（`backup` か `purge`） | TEXT | 不可 | なし | 主キー |
| `pid` | 物理のみ（動いているプロセスの番号） | INTEGER | 不可 | なし | 検査制約 1以上 |
| `started_at` | 物理のみ（始めた日時） | TEXT | 不可 | なし | 日時の検査 |

### 2.3 制約で守らない規則

| 規則 | どこで守るか | 制約で表さない理由 |
|---|---|---|
| `content` の種類がニュースなら `article` が1件、英語なら `english_set` が1件、週報なら `research_report` が1件あり、2つ以上は無い（BD-07 ENT-001、ENT-002、ENT-003、ENT-015） | DD-02 の FN-001、FN-007、FN-025 の手順（M13、M15、M16。内容と中身を1つのトランザクションで作る。DD-05） | 別のテーブルの行の有無は、検査制約で書けないため |
| 同じ対象日の同じ slug の記事は1つ（BD-07 ENT-002 の一意。RD-03 R01） | DD-02 の FN-001 の手順（置き換えるか作るかを、トランザクションの中で対象日と slug で探して決める）と、DD-05 の書き込みの排他 | 対象日は `content`、slug は `article` にあり、テーブルをまたぐ一意は制約で書けないため。対象日を `article` にも写すと、2か所の値がずれ得るので写さない |
| 問題の一覧の問題番号が重ならない。答えの形が「選ぶ」なら、正解が選択肢のどれかと同じ（BD-07 ENT-003） | M16 の受け取りの形の確かめ（zod。ADR-019） | JSON の中の項目どうしの関係は、検査制約で書くと読めなくなるため |
| 完了したときに、答えの問題番号は問題の一覧にある番号だけで、全ての問題に採点がある（BD-07 ENT-005） | DD-02 の FN-012 の手順 | 別のテーブルの JSON との比べは、検査制約で書けないため |
| 開いた日時は一度入れたら変えない（BD-07 ENT-006） | DD-02 の FN-004、FN-009 の手順（空のときだけ入れる更新にする） | 前の値と比べる制約は、トリガーでしか書けないため（トリガーは使わない。3章） |
| AI の発言で、応答の状態が完了か失敗なら、渡した内容の写しがある（BD-07 ENT-008） | M25 の手順（渡す内容を組み立てて写しを残してから AI を呼ぶ。DD-02） | AI Runner が写しを残す前に止まり、そのまま失敗にすることがある（BD-02 FN-015 異常系）。制約にすると、その失敗を残せなくなる。写しの無い失敗は DD-06 の記録で見分ける |
| AI の実行の状態は、BD-02 3章の遷移の順にだけ進む | M20（遷移前の状態を条件にした更新。DD-05） | 前の値と比べる制約は、トリガーでしか書けないため |
| `search_index` は、`content` と `article`、`english_set` の今の値と同じ | M13 が、内容を作るか置き換えるのと同じトランザクションで、`search_index` の行を消して入れ直す（DD-05） | FTS5 の仮想のテーブルは外部キーを持てず、NFKC の正規化は SQLite の関数で行えないため |
| BAT-002 で消す順: 1年より前の `ai_run` を消し、1年より前の `delivery` を指す `content` の受け取りの記録ID を空にし、残った `ai_run` から指されていない1年より前の `delivery` を消す | DD-02 の FN-022 の手順（M29） | 外部キーの削除を拒否にしているので、順を違えると消せずに止まる。記事の関係の判定は受け取りの数分後に作るので、その判定がまだ1年に満たないあいだは受け取りを残し、次の月に消す（BD-02 5.3 の「消すのが遅れても影響しない」に収まる） |

## 3. 索引とビュー

| 索引 | テーブル | カラムの並び | 一意 | 使う処理 |
|---|---|---|---|---|
| 主キー | 2.2 の各テーブル | 2.2 の主キー | 一意 | - |
| `content_english_date_uq` | `content` | `kind`、`target_date`（`kind` が `english` の行だけの部分の索引） | 一意 | BD-07 ENT-001 の一意（英語は種類と対象日で1つ）。FN-007 の置き換え |
| `content_kind_date_ix` | `content` | `kind`、`target_date` | - | FN-002（7日前までの記事）、FN-003（日付の図）、FN-008（教材の一覧） |
| `content_received_ix` | `content` | `received_at` | - | FN-017、FN-018 の新しい順の並び、FN-020 |
| `content_delivery_ix` | `content` | `delivery_id` | - | FN-022（受け取りの記録ID を空にする） |
| `article_slug_ix` | `article` | `slug` | - | FN-001（同じ対象日の同じ slug を探す） |
| `article_relation_pair_uq` | `article_relation` | `min(from_content_id, to_content_id)`、`max(from_content_id, to_content_id)`（式の索引） | 一意 | BD-07 ENT-004 の「向きを問わず1件」。FN-002 の置き換え |
| `article_relation_to_ix` | `article_relation` | `to_content_id` | - | FN-003、FN-004（関係の先から引く） |
| `content_state_saved_ix` | `content_state` | `saved_at`（`is_saved` が 1 の行だけの部分の索引） | - | FN-019 |
| `content_state_unread_ix` | `content_state` | `content_id`（`is_read` が 0 の行だけの部分の索引） | - | FN-017 |
| `conversation_target_ix` | `conversation` | `target_content_id`、`last_spoken_at` | - | FN-014（前の会話の一覧） |
| `conversation_last_ix` | `conversation` | `last_spoken_at` | - | FN-014（ホームから開いたときの一覧） |
| `message_conversation_ix` | `message` | `conversation_id`、`message_id` | - | FN-014、FN-015（直近の発言） |
| `message_reply_to_uq` | `message` | `reply_to_message_id` | 一意 | BD-07 ENT-008 の一意（1つの質問に応答は1つ） |
| `ai_run_queue_ix` | `ai_run` | `state`、`purpose`、`created_at` | - | M20 の次を拾う（FN-002、FN-015）、状態を返す API の待ちの数 |
| `ai_run_reply_ix` | `ai_run` | `reply_message_id` | - | FN-016 |
| `ai_run_summary_ix` | `ai_run` | `summary_conversation_id` | - | FN-015（同じ会話の要約が動いているか） |
| `ai_run_delivery_ix` | `ai_run` | `relate_delivery_id` | - | FN-022（指されている受け取りを残す） |
| `ai_run_finished_ix` | `ai_run` | `state`、`finished_at` | - | FN-020（直近24時間の失敗。BD-11 M02） |
| `ai_run_created_ix` | `ai_run` | `created_at` | - | FN-022 |
| `delivery_date_ix` | `delivery` | `target_date`、`sender`、`result` | - | FN-020（未着。BD-11 M01） |
| `delivery_received_ix` | `delivery` | `received_at` | - | FN-022 |
| `registration_code_expires_ix` | `registration_code` | `expires_at` | - | FN-023（有効な期限を過ぎたコードを消す） |
| `research_report_week_uq` | `research_report` | `topic_id`、`week` | 一意 | BD-07 ENT-015 の一意（RD-03 R23）。FN-025 の置き換え、FN-027 の週の一覧（CR-020） |
| `research_topic_received_ix` | `research_topic` | `last_received_at` | - | FN-026 の新しい順（CR-020） |
| FTS5 の索引 | `search_index` | `body`（trigram） | - | FN-018 |

- 検索の言葉の扱い（FN-018）: 業務層は、言葉を `body` と同じく NFKC で正規化して小文字にし、空白で区切る。3文字以上の言葉は FTS5 の一致で、2文字以下の言葉は `body` の部分の一致（`LIKE`）で探し、全ての言葉を AND でつなぐ。trigram は3文字より短い言葉を索引で探せないためである。2文字以下の言葉は表の全体を読むので、件数が増えると遅くなる。4章の量では1年目は NFR-001 の時間に収まる見込みだが、確かめていない。DD-10 の性能の試験で確かめる。
- ビュー: 使わない。一覧の組み立ては業務層の SQL に書く（DD-01 M22 の外に SQL を書かないため、1か所に集まる）。
- トリガーとプロシージャ: 使わない。SQLite にプロシージャは無い。トリガーで書ける規則（2.3 の前の値と比べる規則）も、業務層の更新の条件で守り、規則を書く場所を DD-02 の1か所にそろえる。
- パーティション: 使わない。SQLite に区画の機能は無く、期間で消す `ai_run` と `delivery` は年に数千件で、`created_at` と `received_at` の索引で消せる（4章）。

## 4. 容量の見積り

1行の大きさは BD-01 7章 量の見積りの値を使う。保存期間の終わりの件数は、消さないテーブルは1年分で数え、年ごとに同じだけ増えるとする。

テーブルごとの容量:

| テーブル | 1年の件数 | 1行の大きさ | 1年の容量 | 根拠 |
|---|---|---|---|---|
| `content` | 最大 約18,000 | 約0.3 KB | 約5 MB | BD-07 2章、1行は見出しと日時 |
| `article` | 最大 約18,000（ふだんは約3,650） | 約2 KB | 最大 約36 MB | BD-01 7章（1件 2 KB は確かめていない見積り） |
| `english_set` | 約365 | 約60 KB | 約22 MB | BD-01 7章の1日約30 KB に、届いた原文の写しを足した（同じ中身を2回持つ） |
| `article_relation` | 約18,000 | 約0.3 KB | 約5 MB | 1件の記事に関係が5件までと置いた（確かめていない見積り。BD-07 2章は見込めないとした） |
| `english_answer` | 約365 | 約5 KB | 約2 MB | 60問の答えと採点 |
| `content_state` | 最大 約18,000 | 約0.1 KB | 約2 MB | 日時と真偽だけ |
| `conversation` | 約3,650 | 約2.5 KB | 約9 MB | 要約を2 KB と置いた（確かめていない見積り） |
| `message` | 約7,300 | 約20 KB | 約146 MB | BD-01 7章（渡した内容の写しを含む。確かめていない見積り） |
| `ai_run` | 約4,500（1年で消す） | 約0.3 KB | 約1.4 MB（増えない） | BD-07 2章 ENT-009 |
| `delivery` | 約730（1年で消す） | 約0.2 KB | 約0.2 MB（増えない） | BD-07 2章 ENT-010 |
| `device`、`registration_code`、`sender_key` | 数件 | 約0.2 KB | 1 MB 未満 | BD-07 2章 |
| `research_topic` | 年に十数件 | 約0.3 KB | 1 MB 未満 | BD-07 2章 ENT-014（CR-020） |
| `research_report` | 年に最大 約160 | 最大 256 KiB（ふだんは約30 KB と置いた。確かめていない見積り） | 最大 約40 MB（ふだんは約5 MB） | BD-07 2章 ENT-015、BD-06 IF-005（CR-020） |
| `search_index` | 最大 約18,000 | 元の文の約3.7倍 | 最大 約150 MB | 元の文は `article` と `english_set` の文で約40 MB。倍率は、日本語と英語の混じった文 2,000件（約2.9 MB）を trigram で入れて測った（2026-11-24。DB は約10.9 MB で約3.7倍） |
| 索引（主キー以外） | - | - | 約10 MB | 上の表の合計の数%と置いた |

全体の容量と余裕:

- 全体: 1年に最大で約390 MB 増える（ふだんの1日10件なら約250 MB）。BD-01 7章の約200 MB と検索の索引の「数倍」を合わせた見積りと食い違わない。
- 余裕: 5年で約2 GB、バックアップ7日分（BD-02 5.3）で約14 GB。2026-11-23 の Mac mini の空き約400 GB（BD-01 7章）と別のディスクに対し、見込みの2倍の余裕を見ても足りる。DD-09 のストレージのパラメータは、この表を根拠にする。

## 5. スキーマの変更の手順（マイグレーション）

| 項目 | 決まり |
|---|---|
| 変更の道具と置き場所 | 外の道具は使わない。M21（DD-01）に、番号の順にファイルを当てる小さな仕組みを置く。ファイルは `src/server/db/migrations/` に `NNNN-<kebab-case の名前>.sql`（4桁の番号。0001 から）で置く。1つのファイルを1つのトランザクションで当て、当てたら `schema_migration` に番号を書く。一度当てたファイルは直さず、直すときは新しい番号のファイルを足す |
| 当てる時機 | Web サーバが起動したときに、まだ当てていないファイルを全て当ててから要求を受け付ける。AI Runner、定期ジョブ、管理のコマンドは、起動したときに `schema_migration` の最後の番号が自分の知る番号と同じかを確かめ、違えば何もせずに終わり、ログに残す（AI Runner は launchd が起動し直す。BD-01 4章）。2つのプロセスが同時に当てないよう、当てるのは Web サーバだけにする |
| 全ての環境で同じ手順 | 本番、試験、開発（BD-01 4章）で、同じファイルを同じ仕組みで当てる。試験の DB は空から全てのファイルを当てて作る |
| 稼働中に変えるときの手順 | 止めて変える。利用者は本人1人で、短い時間止めてよい（BD-11 6章 リリース）。順は、OP08 でバックアップを取る → OP02 で Web サーバと AI Runner を止める → 新しいコードに替える → Web サーバを起動する（ファイルが当たる）→ AI Runner を起動する。列を足すときは、既定値を付けるか空を許して足す。型を変える、列を消す、制約を変えるときは、SQLite が表を直接変えられないので、同じファイルの中で新しい表を作り、行を写し、古い表を消して名前を替える。そのあいだは外部キーの検査を止め、終わりに `PRAGMA foreign_key_check` で確かめる |
| 外部キーの検査を止めて当てるファイル（CR-020） | 検査制約を変えるために表を作り直すファイル（`0002-research-report.sql` の `delivery`、`sender_key`）は、1行目に `-- nexus:foreign-keys-off` と書く。M21 は、その印のあるファイルだけ、トランザクションの外で `PRAGMA foreign_keys = OFF` にしてから、トランザクションの中で当て、確定の前に `PRAGMA foreign_key_check` を読み、1行でも返れば戻して E17 で止める。終わったら（失敗しても）`PRAGMA foreign_keys = ON` に戻す。`PRAGMA foreign_keys` はトランザクションの中では変えられない（SQLite の文書）ため、トランザクションの外で変える |
| `0002-research-report.sql` の中身（CR-020） | (1) `delivery` と `sender_key` を、`sender` の検査制約に `brain-research` を足した形で作り直す（新しい表を作り、行を写し、古い表を消し、名前を替える。索引 `delivery_date_ix`、`delivery_received_ix` も作り直す）。(2) `research_topic`、`research_report` と、3章の索引を作る。既存の行の値は変えない。件数は `delivery` が最大で約730件、`sender_key` が2件で、当てる時間は1秒未満の見込み（ファイルの先頭のコメントに書く） |
| 戻すとき | 戻すためのファイルは書かない。変える前に取ったバックアップを OP07 で戻す（利用者が1人で、戻す時点のデータの差を本人が判断できるため） |
| 既存データの変換 | `0002-research-report.sql`（CR-020）は表を作り直して行を写すだけで、値は変えない。それより前は該当なし（最初の版）。これまでのニュースと教材は取り込まない（Q-011 の答え）。後の版でデータの値を変えるときは、そのマイグレーションの中に変換の SQL を書き、件数と時間の見込みをそのファイルの先頭のコメントに書く |

## 6. 上流との対応

| ENT（BD-07） | テーブル | 論理と違う形 |
|---|---|---|
| ENT-001 | `content` | なし |
| ENT-002 | `article` | なし |
| ENT-003 | `english_set` | なし |
| ENT-004 | `article_relation` | なし |
| ENT-005 | `english_answer` | なし |
| ENT-006 | `content_state` | なし |
| ENT-007 | `conversation` | なし |
| ENT-008 | `message` | なし |
| ENT-009 | `ai_run` | なし |
| ENT-010 | `delivery` | なし |
| ENT-011 | `device` | なし |
| ENT-012 | `registration_code` | なし |
| ENT-013 | `sender_key` | なし |
| ENT-014 | `research_topic` | なし（CR-020） |
| ENT-015 | `research_report` | なし（CR-020） |
| 物理のみ | `search_index` | FN-018 の検索のための写し（2.1） |
| 物理のみ | `schema_migration` | マイグレーションの記録（5章。NFR-005、NFR-023） |
| 物理のみ | `job_lock` | 多重起動を防ぐ印（NFR-023、NFR-024。DD-05 4章） |

- BD-07 の ENT-001〜ENT-015 は、全てこの表にある。
- BD-07 3章の全ての属性は、2.2 の「対応する属性」の列にある。
- BD-07 の一貫性の規則（ENT-001、ENT-002、ENT-003、ENT-004、ENT-005、ENT-006、ENT-008、ENT-009）と BD-02 3章の状態の遷移は、2.2 の制約か 2.3 にある。
- エンティティに対応しないテーブル（`search_index`、`schema_migration`、`job_lock`）は、2.1 に理由を書いた。

## 7. 未決事項

この書類で起こした未決事項は無い。
