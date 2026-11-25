-- テストだけの3つ目の種類「メモ」の中身のテーブル（DD-10 TC110。DD-01 M14 の、種類ごとの中身のテーブルとマイグレーション）。
-- 本番のマイグレーション（src/server/db/migrations/）の後に、テストだけで当てる。番号はテストが本番の最後の番号の次にする。
CREATE TABLE memo (
  content_id INTEGER NOT NULL PRIMARY KEY REFERENCES content (content_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  memo_key TEXT NOT NULL CHECK (memo_key <> ''),
  body_md TEXT NOT NULL CHECK (body_md <> '')
) STRICT;
