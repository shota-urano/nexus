import type { Database } from "../db/connection";

// 検索の索引（DD-03 `search_index`。物理のみ）の書き込み（DD-01 M22）。

// 内容ID の行を消し、正規化した検索の本文で入れ直す（DD-02 3章 P08 手順 1）。
// 内容を作るか置き換えるのと同じトランザクションの中で呼ぶ。
export function replaceSearchIndexRow(
  db: Database,
  contentId: number,
  body: string,
): void {
  db.prepare("DELETE FROM search_index WHERE content_id = ?").run(contentId);
  db.prepare("INSERT INTO search_index (content_id, body) VALUES (?, ?)").run(
    contentId,
    body,
  );
}
