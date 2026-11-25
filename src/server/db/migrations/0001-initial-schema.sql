-- 0001: DD-03 2.2 の全てのテーブルと、3章の全ての索引を作る（02-data-model。ENT-001〜ENT-013）。
-- 全てのテーブルを STRICT にし、外部キーの削除と更新は全て拒否にする（DD-03 1章）。
-- 日時は `YYYY-MM-DDTHH:MM:SS.sss+09:00`、日付は `YYYY-MM-DD` の GLOB で確かめる（DD-03 1章）。
-- 一意の規則のうち3章に名前のあるもの（`message.reply_to_message_id`）は、3章の索引で守る。
-- 既存データの変換: 該当なし（最初の版。DD-03 5章）。

-- ENT-010 受け取りの記録
CREATE TABLE delivery (
  delivery_id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  sender TEXT NOT NULL CHECK (sender IN ('brain-harness', 'sharpen')),
  target_date TEXT CHECK (
    target_date IS NULL
    OR target_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
  ),
  received_at TEXT NOT NULL CHECK (
    received_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]+09:00'
  ),
  item_count INTEGER NOT NULL CHECK (item_count >= 0),
  result TEXT NOT NULL CHECK (result IN ('accepted', 'rejected')),
  rejection_reason TEXT,
  CHECK (result <> 'accepted' OR target_date IS NOT NULL),
  CHECK (
    result <> 'rejected'
    OR (rejection_reason IS NOT NULL AND rejection_reason <> '')
  )
) STRICT;

-- ENT-001 内容
CREATE TABLE content (
  content_id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  -- 値の検査制約は置かない（NFR-004。RV16-05）。値は DD-01 M14 で確かめる。
  kind TEXT NOT NULL CHECK (kind <> ''),
  title TEXT NOT NULL CHECK (
    title <> ''
    AND instr(title, char(10)) = 0
    AND instr(title, char(13)) = 0
  ),
  target_date TEXT NOT NULL CHECK (
    target_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
  ),
  received_at TEXT NOT NULL CHECK (
    received_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]+09:00'
  ),
  delivery_id INTEGER
    REFERENCES delivery (delivery_id) ON DELETE RESTRICT ON UPDATE RESTRICT
) STRICT;

-- ENT-002 記事
CREATE TABLE article (
  content_id INTEGER NOT NULL PRIMARY KEY
    REFERENCES content (content_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  slug TEXT NOT NULL CHECK (
    length(slug) = 12 AND slug NOT GLOB '*[^0-9a-f]*'
  ),
  guide_md TEXT NOT NULL,
  source_url TEXT NOT NULL CHECK (
    source_url GLOB 'http://*' OR source_url GLOB 'https://*'
  ),
  image_url TEXT CHECK (
    image_url IS NULL
    OR image_url GLOB 'http://*'
    OR image_url GLOB 'https://*'
  ),
  theme TEXT NOT NULL CHECK (theme <> '')
) STRICT;

-- ENT-003 英語のセット
CREATE TABLE english_set (
  content_id INTEGER NOT NULL PRIMARY KEY
    REFERENCES content (content_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  learning_theme TEXT NOT NULL CHECK (learning_theme <> ''),
  lesson_body_md TEXT NOT NULL CHECK (lesson_body_md <> ''),
  closing_md TEXT,
  problems_json TEXT NOT NULL CHECK (
    json_valid(problems_json)
    AND json_type(problems_json) = 'array'
    AND json_array_length(problems_json) BETWEEN 1 AND 60
  ),
  reading_json TEXT CHECK (reading_json IS NULL OR json_valid(reading_json)),
  raw_payload_json TEXT NOT NULL CHECK (json_valid(raw_payload_json))
) STRICT;

-- ENT-004 記事の関係
CREATE TABLE article_relation (
  from_content_id INTEGER NOT NULL
    REFERENCES article (content_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  to_content_id INTEGER NOT NULL
    REFERENCES article (content_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  relation_type TEXT NOT NULL CHECK (
    relation_type IN ('follow_up', 'background', 'same_actor', 'related_topic')
  ),
  reason TEXT NOT NULL CHECK (reason <> ''),
  judged_at TEXT NOT NULL CHECK (
    judged_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]+09:00'
  ),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  PRIMARY KEY (from_content_id, to_content_id),
  CHECK (from_content_id <> to_content_id)
) STRICT;

-- ENT-005 英語の答え
CREATE TABLE english_answer (
  content_id INTEGER NOT NULL PRIMARY KEY
    REFERENCES english_set (content_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  answers_json TEXT NOT NULL CHECK (
    json_valid(answers_json) AND json_type(answers_json) = 'array'
  ),
  completed_at TEXT NOT NULL CHECK (
    completed_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]+09:00'
  )
) STRICT;

-- ENT-006 内容の状態
CREATE TABLE content_state (
  content_id INTEGER NOT NULL PRIMARY KEY
    REFERENCES content (content_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  opened_at TEXT CHECK (
    opened_at IS NULL
    OR opened_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]+09:00'
  ),
  is_read INTEGER NOT NULL DEFAULT 0 CHECK (is_read IN (0, 1)),
  read_at TEXT CHECK (
    read_at IS NULL
    OR read_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]+09:00'
  ),
  is_saved INTEGER NOT NULL DEFAULT 0 CHECK (is_saved IN (0, 1)),
  saved_at TEXT CHECK (
    saved_at IS NULL
    OR saved_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]+09:00'
  ),
  CHECK (is_read = 0 OR read_at IS NOT NULL),
  CHECK (is_saved = 0 OR saved_at IS NOT NULL)
) STRICT;

-- ENT-007 会話（`summary_last_message_id` は後で作る `message` を指す）
CREATE TABLE conversation (
  conversation_id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  target_content_id INTEGER
    REFERENCES content (content_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  question_target_json TEXT CHECK (
    question_target_json IS NULL OR json_valid(question_target_json)
  ),
  started_at TEXT NOT NULL CHECK (
    started_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]+09:00'
  ),
  last_spoken_at TEXT NOT NULL CHECK (
    last_spoken_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]+09:00'
  ),
  summary_md TEXT,
  summary_last_message_id INTEGER
    REFERENCES message (message_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CHECK (target_content_id IS NULL OR question_target_json IS NOT NULL),
  CHECK (summary_md IS NULL OR summary_last_message_id IS NOT NULL)
) STRICT;

-- ENT-008 発言
CREATE TABLE message (
  message_id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL
    REFERENCES conversation (conversation_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  speaker TEXT NOT NULL CHECK (speaker IN ('owner', 'ai')),
  body_md TEXT NOT NULL DEFAULT '',
  sent_at TEXT NOT NULL CHECK (
    sent_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]+09:00'
  ),
  reply_state TEXT CHECK (
    reply_state IS NULL
    OR reply_state IN ('writing', 'done', 'failed', 'cancelled')
  ),
  -- 一意は3章の `message_reply_to_uq` で守る。
  reply_to_message_id INTEGER
    REFERENCES message (message_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ai_input_copy TEXT,
  -- 作成中の応答だけが空でよい。
  CHECK (speaker <> 'owner' OR body_md <> ''),
  -- 話し手ごとの持ち方（BD-07 ENT-008 の一貫性の規則）。
  CHECK (
    (
      speaker = 'owner'
      AND reply_state IS NULL
      AND reply_to_message_id IS NULL
      AND ai_input_copy IS NULL
    )
    OR (
      speaker = 'ai'
      AND reply_state IS NOT NULL
      AND reply_to_message_id IS NOT NULL
    )
  )
) STRICT;

-- ENT-009 AI の実行
CREATE TABLE ai_run (
  ai_run_id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  purpose TEXT NOT NULL CHECK (purpose IN ('answer', 'relate', 'summarize')),
  state TEXT NOT NULL DEFAULT 'queued' CHECK (
    state IN ('queued', 'running', 'done', 'failed', 'cancelled')
  ),
  reply_message_id INTEGER
    REFERENCES message (message_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  summary_conversation_id INTEGER
    REFERENCES conversation (conversation_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  relate_delivery_id INTEGER
    REFERENCES delivery (delivery_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  attempt INTEGER NOT NULL DEFAULT 1 CHECK (attempt >= 1),
  created_at TEXT NOT NULL CHECK (
    created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]+09:00'
  ),
  started_at TEXT CHECK (
    started_at IS NULL
    OR started_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]+09:00'
  ),
  finished_at TEXT CHECK (
    finished_at IS NULL
    OR finished_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]+09:00'
  ),
  failure_reason TEXT,
  stop_requested INTEGER NOT NULL DEFAULT 0 CHECK (stop_requested IN (0, 1)),
  web_search_count INTEGER NOT NULL DEFAULT 0 CHECK (web_search_count >= 0),
  web_fetch_count INTEGER NOT NULL DEFAULT 0 CHECK (web_fetch_count >= 0),
  folder_read_count INTEGER NOT NULL DEFAULT 0 CHECK (folder_read_count >= 0),
  CHECK (
    state NOT IN ('running', 'done', 'failed') OR started_at IS NOT NULL
  ),
  CHECK (
    state NOT IN ('done', 'failed', 'cancelled') OR finished_at IS NOT NULL
  ),
  CHECK (
    state <> 'failed'
    OR (failure_reason IS NOT NULL AND failure_reason <> '')
  ),
  -- 目的に合う1つだけを持つ（BD-07 ENT-009 の一貫性の規則）。
  CHECK (
    (
      purpose = 'answer'
      AND reply_message_id IS NOT NULL
      AND summary_conversation_id IS NULL
      AND relate_delivery_id IS NULL
    )
    OR (
      purpose = 'summarize'
      AND reply_message_id IS NULL
      AND summary_conversation_id IS NOT NULL
      AND relate_delivery_id IS NULL
    )
    OR (
      purpose = 'relate'
      AND reply_message_id IS NULL
      AND summary_conversation_id IS NULL
      AND relate_delivery_id IS NOT NULL
    )
  )
) STRICT;

-- ENT-011 端末
CREATE TABLE device (
  device_id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  device_name TEXT NOT NULL UNIQUE CHECK (device_name <> ''),
  device_key_hash TEXT NOT NULL UNIQUE CHECK (device_key_hash <> ''),
  registered_at TEXT NOT NULL CHECK (
    registered_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]+09:00'
  ),
  last_used_at TEXT NOT NULL CHECK (
    last_used_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]+09:00'
  )
) STRICT;

-- ENT-012 登録コード
CREATE TABLE registration_code (
  code_hash TEXT NOT NULL PRIMARY KEY CHECK (code_hash <> ''),
  device_name TEXT NOT NULL CHECK (device_name <> ''),
  issued_at TEXT NOT NULL CHECK (
    issued_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]+09:00'
  ),
  -- 同じ時差の形なので、文字の順が時刻の順になる（DD-03 1章）。
  expires_at TEXT NOT NULL CHECK (
    expires_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]+09:00'
  ),
  CHECK (expires_at > issued_at)
) STRICT;

-- ENT-013 配信元の鍵
CREATE TABLE sender_key (
  sender TEXT NOT NULL PRIMARY KEY CHECK (sender IN ('brain-harness', 'sharpen')),
  key_hash TEXT NOT NULL UNIQUE CHECK (key_hash <> ''),
  issued_at TEXT NOT NULL CHECK (
    issued_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]+09:00'
  )
) STRICT;

-- 物理のみ: 検索の索引（FN-018。trigram で、大文字と小文字を区別しない）。
-- `body` は業務層が NFKC で正規化して小文字にしてから入れる（DD-03 2.2、2.3）。
CREATE VIRTUAL TABLE search_index USING fts5(
  content_id UNINDEXED,
  body,
  tokenize = 'trigram case_sensitive 0'
);

-- 物理のみ: 当てたマイグレーションの記録（DD-03 5章）
CREATE TABLE schema_migration (
  version INTEGER NOT NULL PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL CHECK (
    applied_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]+09:00'
  )
) STRICT;

-- 物理のみ: 定期ジョブの多重起動を防ぐ印（DD-05 4章。RV16-03）
CREATE TABLE job_lock (
  job_name TEXT NOT NULL PRIMARY KEY,
  pid INTEGER NOT NULL CHECK (pid >= 1),
  started_at TEXT NOT NULL CHECK (
    started_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]+09:00'
  )
) STRICT;

-- 3章の索引（主キーと FTS5 の索引を除く22）
CREATE UNIQUE INDEX content_english_date_uq ON content (kind, target_date)
  WHERE kind = 'english';
CREATE INDEX content_kind_date_ix ON content (kind, target_date);
CREATE INDEX content_received_ix ON content (received_at);
CREATE INDEX content_delivery_ix ON content (delivery_id);
CREATE INDEX article_slug_ix ON article (slug);
CREATE UNIQUE INDEX article_relation_pair_uq ON article_relation (
  min(from_content_id, to_content_id),
  max(from_content_id, to_content_id)
);
CREATE INDEX article_relation_to_ix ON article_relation (to_content_id);
CREATE INDEX content_state_saved_ix ON content_state (saved_at)
  WHERE is_saved = 1;
CREATE INDEX content_state_unread_ix ON content_state (content_id)
  WHERE is_read = 0;
CREATE INDEX conversation_target_ix ON conversation (
  target_content_id,
  last_spoken_at
);
CREATE INDEX conversation_last_ix ON conversation (last_spoken_at);
CREATE INDEX message_conversation_ix ON message (conversation_id, message_id);
CREATE UNIQUE INDEX message_reply_to_uq ON message (reply_to_message_id);
CREATE INDEX ai_run_queue_ix ON ai_run (state, purpose, created_at);
CREATE INDEX ai_run_reply_ix ON ai_run (reply_message_id);
CREATE INDEX ai_run_summary_ix ON ai_run (summary_conversation_id);
CREATE INDEX ai_run_delivery_ix ON ai_run (relate_delivery_id);
CREATE INDEX ai_run_finished_ix ON ai_run (state, finished_at);
CREATE INDEX ai_run_created_ix ON ai_run (created_at);
CREATE INDEX delivery_date_ix ON delivery (target_date, sender, result);
CREATE INDEX delivery_received_ix ON delivery (received_at);
CREATE INDEX registration_code_expires_ix ON registration_code (expires_at);
