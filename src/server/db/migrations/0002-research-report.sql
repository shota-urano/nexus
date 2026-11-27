-- nexus:foreign-keys-off
-- 0002: 調査の週報（CR-020。ENT-014、ENT-015）のための変更（DD-03 2.2、3章、5章）。
-- 1行目の印で、M21 は外部キーの検査を止めて当て、確定の前に `PRAGMA foreign_key_check` で確かめる（DD-03 5章）。
-- (1) `delivery` と `sender_key` を、`sender` の検査制約に `brain-research` を足した形で作り直す
--     （新しい表を作り、行を写し、古い表を消し、名前を替える。`delivery` の索引も作り直す）。
-- (2) `research_topic`、`research_report` と、3章の索引を作る。
-- 既存データの変換: 表を作り直して行を写すだけで、値は変えない。
-- 件数は `delivery` が最大で約730件、`sender_key` が2件で、当てる時間は1秒未満の見込み。

-- (1) ENT-010 受け取りの記録
CREATE TABLE delivery_new (
  delivery_id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  sender TEXT NOT NULL CHECK (
    sender IN ('brain-harness', 'sharpen', 'brain-research')
  ),
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

INSERT INTO delivery_new (
  delivery_id, sender, target_date, received_at, item_count, result, rejection_reason
)
SELECT
  delivery_id, sender, target_date, received_at, item_count, result, rejection_reason
FROM delivery;

DROP TABLE delivery;
ALTER TABLE delivery_new RENAME TO delivery;

CREATE INDEX delivery_date_ix ON delivery (target_date, sender, result);
CREATE INDEX delivery_received_ix ON delivery (received_at);

-- (1) ENT-013 配信元の鍵
CREATE TABLE sender_key_new (
  sender TEXT NOT NULL PRIMARY KEY CHECK (
    sender IN ('brain-harness', 'sharpen', 'brain-research')
  ),
  key_hash TEXT NOT NULL UNIQUE CHECK (key_hash <> ''),
  issued_at TEXT NOT NULL CHECK (
    issued_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]+09:00'
  )
) STRICT;

INSERT INTO sender_key_new (sender, key_hash, issued_at)
SELECT sender, key_hash, issued_at FROM sender_key;

DROP TABLE sender_key;
ALTER TABLE sender_key_new RENAME TO sender_key;

-- (2) ENT-014 研究課題
CREATE TABLE research_topic (
  topic_id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  -- 1〜64文字で、a〜z、0〜9、`-` だけ（Q-096 の答え）。
  topic_key TEXT NOT NULL UNIQUE CHECK (
    length(topic_key) BETWEEN 1 AND 64
    AND topic_key NOT GLOB '*[^a-z0-9-]*'
  ),
  -- 200文字までは受け取りで確かめる。
  title TEXT NOT NULL CHECK (
    title <> ''
    AND instr(title, char(10)) = 0
    AND instr(title, char(13)) = 0
  ),
  status TEXT NOT NULL CHECK (status IN ('active', 'ended')),
  last_week INTEGER NOT NULL CHECK (last_week >= 1),
  last_received_at TEXT NOT NULL CHECK (
    last_received_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]+09:00'
  )
) STRICT;

-- (2) ENT-015 週報
CREATE TABLE research_report (
  content_id INTEGER NOT NULL PRIMARY KEY
    REFERENCES content (content_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  -- `topic_id` と `week` の組の一意は3章の `research_report_week_uq` で守る。
  topic_id INTEGER NOT NULL
    REFERENCES research_topic (topic_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  week INTEGER NOT NULL CHECK (week >= 1),
  sent_on TEXT NOT NULL CHECK (
    sent_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
  ),
  status TEXT NOT NULL CHECK (status IN ('active', 'ended')),
  answer_md TEXT NOT NULL CHECK (answer_md <> ''),
  -- 方法の一覧は JSON の配列で、0〜15件（Q-088 の答え）。
  approaches_json TEXT NOT NULL CHECK (
    json_valid(approaches_json)
    AND json_type(approaches_json) = 'array'
    AND json_array_length(approaches_json) BETWEEN 0 AND 15
  ),
  unknowns_md TEXT NOT NULL DEFAULT '',
  changes_md TEXT NOT NULL CHECK (changes_md <> '')
) STRICT;

-- (2) 3章の索引
CREATE UNIQUE INDEX research_report_week_uq ON research_report (topic_id, week);
CREATE INDEX research_topic_received_ix ON research_topic (last_received_at);
