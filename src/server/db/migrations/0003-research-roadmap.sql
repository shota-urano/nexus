-- nexus:foreign-keys-off
-- 0003: 週報の道のり（CR-024。ENT-006 の確かめた方法、ENT-015 の段の一覧と段の変更の案）のための変更
-- （DD-03 2.1、2.2、3章、5章）。
-- 1行目の印で、M21 は外部キーの検査を止めて当て、確定の前に `PRAGMA foreign_key_check` で確かめる（DD-03 5章）。
-- (1) `research_report` を、`approaches_json` の件数の検査制約（0〜15件）を外し、`steps_json` と
--     `step_changes_md`（どちらも空を許す）を足した形で作り直す（新しい表を作り、行を写し、古い表を消し、
--     名前を替える。`research_report_week_uq` も作り直す）。写した行の `steps_json` と `step_changes_md` は空にする。
-- (2) `research_approach_seen` を作る。
-- 既存データの変換: 表を作り直して行を写すだけで、値は変えない。
-- 件数は `research_report` が数十件で、当てる時間は1秒未満の見込み。

-- (1) ENT-015 週報
CREATE TABLE research_report_new (
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
  -- 方法の一覧は JSON の配列。件数の上限は持たない（Q-099 の答え。CR-024）。
  approaches_json TEXT NOT NULL CHECK (
    json_valid(approaches_json)
    AND json_type(approaches_json) = 'array'
  ),
  unknowns_md TEXT NOT NULL DEFAULT '',
  changes_md TEXT NOT NULL CHECK (changes_md <> ''),
  -- 段の一覧は JSON の配列で、0〜30件。段の欄の無い週報は空（Q-098 の答え。CR-024）。
  steps_json TEXT CHECK (
    steps_json IS NULL
    OR (
      json_valid(steps_json)
      AND json_type(steps_json) = 'array'
      AND json_array_length(steps_json) BETWEEN 0 AND 30
    )
  ),
  -- 段の変更の案（Q-100 の答え。CR-024）。
  step_changes_md TEXT
) STRICT;

INSERT INTO research_report_new (
  content_id, topic_id, week, sent_on, status, answer_md, approaches_json, unknowns_md, changes_md
)
SELECT
  content_id, topic_id, week, sent_on, status, answer_md, approaches_json, unknowns_md, changes_md
FROM research_report;

DROP TABLE research_report;
ALTER TABLE research_report_new RENAME TO research_report;

CREATE UNIQUE INDEX research_report_week_uq ON research_report (topic_id, week);

-- (2) ENT-006 内容の状態の「確かめた方法」（RD-03 R26。Q-101 の答え）
CREATE TABLE research_approach_seen (
  content_id INTEGER NOT NULL
    REFERENCES research_report (content_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  approach_no INTEGER NOT NULL CHECK (approach_no >= 1),
  seen_at TEXT NOT NULL CHECK (
    seen_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]+09:00'
  ),
  PRIMARY KEY (content_id, approach_no)
) STRICT;
