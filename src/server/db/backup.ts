import { backup } from "node:sqlite";
import type { Database } from "./connection";

// 動かしたままの写し（DD-01 M21。BD-02 5.3 BAT-001、ADR-020）。
// `node:sqlite` の `backup` で、読む側の一貫した時点の写しを作る（DD-05 2章 FN-021）。
// DB を読むだけで、ほかの接続の書き込みを止めない（DD-05 3章 DB の全体）。
// 写している間にほかの接続が書けば、SQLite が写しを最初からやり直すので、写しは書いた後の時点になる。

export interface CopyProgress {
  totalPages: number;
  remainingPages: number;
}

export interface CopyDatabaseOptions {
  // 1回に写す頁の数。省くと `node:sqlite` の既定（100）。試験で写している間を作るときに小さくする（DD-10 TC89）。
  pagesPerStep?: number;
  // 頁を写すたびに呼ぶ（残りが0の回は呼ばない）。
  onProgress?: (progress: CopyProgress) => void;
}

// `path` に写しを作る。写した頁の数を返す。失敗したら `node:sqlite` の例外をそのまま投げる
// （写す先の失敗か DB の失敗かは、呼ぶ側の M28 が DD-06 E14 として扱う）。
export async function copyDatabase(
  db: Database,
  path: string,
  options: CopyDatabaseOptions = {},
): Promise<number> {
  return backup(db, path, {
    ...(options.pagesPerStep === undefined
      ? {}
      : { rate: options.pagesPerStep }),
    ...(options.onProgress === undefined
      ? {}
      : { progress: options.onProgress }),
  });
}
