import {
  accessSync,
  chmodSync,
  constants,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { type CopyDatabaseOptions, copyDatabase } from "../../server/db/backup";
import type { Database } from "../../server/db/connection";
import type { Clock } from "../../server/shared/clock";
import { daysBetween, formatDate } from "../../server/shared/datetime";
import type { ErrorCode } from "../../server/shared/errors";

// BAT-001 データのバックアップ（DD-01 M28。DD-02 FN-021 手順 2〜7、BD-02 5.3）。
// 置き場所に `nexus-YYYY-MM-DD.db.partial` として写しを作り、権限を `0600` にしてから
// `nexus-YYYY-MM-DD.db` に名前を替える（作りかけの写しを決まった名前で残さない。DD-05 5章）。
// その後、今日を含めて7日分を残し、それより古い写しを消す。
// 終了コードとログは呼ぶ側の M27 が結果から決める（DD-06 E14、E15）。

// 残す日数（今日を含める。BD-02 5.3、NFR-023）。
export const BACKUP_KEEP_DAYS = 7;
// 写しの権限（本人のユーザだけが読み書きできる。NFR-028）。
export const BACKUP_FILE_MODE = 0o600;

const BACKUP_NAME = /^nexus-(\d{4}-\d{2}-\d{2})\.db$/;

export function backupFileName(date: string): string {
  return `nexus-${date}.db`;
}

export interface RunBackupDeps {
  db: Database;
  clock: Clock;
  // 置き場所（DD-09 2.3 `NEXUS_BACKUP_DIR`）。
  backupDir: string;
  // 写し方。試験で写している間を作るときに渡す（DD-10 TC89）。
  copy?: CopyDatabaseOptions;
}

export type BackupResult =
  // 写しを作り、古い写しを消した。
  | { kind: "done"; path: string; size: number; removed: number }
  // 写しを作ったが、古い写しを消せなかった（DD-06 E15）。`failed` は消せなかったファイルの名前。
  | {
      kind: "cleanup_failed";
      path: string;
      size: number;
      removed: number;
      failed: string[];
      error: unknown;
    }
  // 写しを作れなかった（DD-06 E14）。`reason` は MSG-039 の理由。
  | { kind: "failed"; code: ErrorCode; reason: string; error: unknown };

export async function runBackup(deps: RunBackupDeps): Promise<BackupResult> {
  const { db, clock, backupDir } = deps;
  const today = formatDate(clock.now());

  // 手順 2: 置き場所のフォルダがあって書けるか。
  try {
    if (!statSync(backupDir).isDirectory()) {
      throw new Error("置き場所がフォルダでない");
    }
    accessSync(backupDir, constants.W_OK | constants.X_OK);
  } catch (error) {
    return targetUnavailable("別のディスクが無いか書けない", error);
  }

  // 手順 3〜4: 作りかけの名前で写し、権限を変えてから決まった名前にする。
  const finalPath = join(backupDir, backupFileName(today));
  const partialPath = `${finalPath}.partial`;
  let size: number;
  try {
    // 前の回の作りかけが残っていれば先に消す。
    rmSync(partialPath, { force: true });
    // 写す前から本人のユーザだけが読める権限のファイルにしておく（作っている間も他人に読ませない）。
    writeFileSync(partialPath, "", { mode: BACKUP_FILE_MODE, flag: "wx" });
    await copyDatabase(db, partialPath, deps.copy);
    chmodSync(partialPath, BACKUP_FILE_MODE);
    // 同じ日の写しがあれば置き換える。作り終えてから名前を替えるので、前の写しが途中で消えることは無い。
    renameSync(partialPath, finalPath);
    size = statSync(finalPath).size;
  } catch (error) {
    // 手順 6: 作りかけの写しを消す。消せなくても、失敗の知らせは続ける。
    let cleanupError: unknown = undefined;
    try {
      rmSync(partialPath, { force: true });
    } catch (rmError) {
      cleanupError = rmError;
    }
    return targetUnavailable(
      cleanupError === undefined
        ? "写しを作れない"
        : "写しを作れない。作りかけの写しも消せない",
      error,
    );
  }

  // 手順 5: 今日の7日前以前の写しを消す（今日を含めて7日分を残す）。
  const removedOrFailed = removeOldBackups(backupDir, today);
  if (
    removedOrFailed.failed.length > 0 ||
    removedOrFailed.error !== undefined
  ) {
    return {
      kind: "cleanup_failed",
      path: finalPath,
      size,
      removed: removedOrFailed.removed,
      failed: removedOrFailed.failed,
      error: removedOrFailed.error,
    };
  }
  return {
    kind: "done",
    path: finalPath,
    size,
    removed: removedOrFailed.removed,
  };
}

function removeOldBackups(
  backupDir: string,
  today: string,
): { removed: number; failed: string[]; error: unknown } {
  let names: string[];
  try {
    names = readdirSync(backupDir);
  } catch (error) {
    return { removed: 0, failed: [], error };
  }
  let removed = 0;
  const failed: string[] = [];
  let firstError: unknown = undefined;
  for (const name of names.sort()) {
    const date = BACKUP_NAME.exec(name)?.[1];
    if (date === undefined) continue;
    const age = daysBetween(date, today);
    if (age === null || age < BACKUP_KEEP_DAYS) continue;
    try {
      unlinkSync(join(backupDir, name));
      removed += 1;
    } catch (error) {
      // 消せなくても、ほかの古い写しは消し続ける（DD-06 E15 は続ける）。
      failed.push(name);
      firstError ??= error;
    }
  }
  return { removed, failed, error: firstError };
}

function targetUnavailable(reason: string, error: unknown): BackupResult {
  return {
    kind: "failed",
    code: "BACKUP_TARGET_UNAVAILABLE",
    reason,
    // 原因の例外はそのまま返す（ログの関数が種類と符号だけを残す。DD-06 5章）。
    error,
  };
}
