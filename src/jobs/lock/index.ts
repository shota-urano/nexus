import {
  type Database,
  databasePath,
  openDatabase,
} from "../../server/db/connection";
import { toDbError } from "../../server/db/errors";
import { assertMigrationsApplied } from "../../server/db/migrations";
import { inWriteTransaction } from "../../server/db/transaction";
import {
  type JobName,
  deleteJobLock,
  findJobLockPid,
  insertJobLock,
  replaceJobLock,
} from "../../server/repositories/job-lock";
import type { Clock } from "../../server/shared/clock";
import { formatDateTime } from "../../server/shared/datetime";

// 定期ジョブの多重起動の印（DD-01 M31。DD-05 4章、DD-03 `job_lock`）。
// 取るときは1つの `BEGIN IMMEDIATE` のトランザクションの中で、印を読み、無ければ作り、
// 印のプロセスが生きていれば何もせずに戻し、生きていなければ自分の番号に置き換える。
// 書き込みの権利は同時に1つなので、2つのプロセスが同時に古い印を見ても、置き換えられるのは片方だけになる。
// 消すときは、バッチの名前と自分の番号が両方合う行だけを消す。

export type { JobName } from "../../server/repositories/job-lock";

export type AcquireResult =
  | { acquired: true }
  // 同じバッチが動いている。`holderPid` はその印のプロセスの番号。
  | { acquired: false; holderPid: number };

export interface JobLockDeps {
  db: Database;
  clock: Clock;
  // プロセスが生きているか。省くと isProcessAlive。
  isAlive?: (pid: number) => boolean;
}

export interface JobLock {
  acquire(jobName: JobName, pid: number): AcquireResult;
  // 消した行があったか。
  release(jobName: JobName, pid: number): boolean;
}

export function createJobLock(deps: JobLockDeps): JobLock {
  const { db, clock } = deps;
  const isAlive = deps.isAlive ?? isProcessAlive;
  return {
    acquire(jobName, pid) {
      return inWriteTransaction(db, (): AcquireResult => {
        const startedAt = formatDateTime(clock.now());
        const holderPid = findJobLockPid(db, jobName);
        if (holderPid === null) {
          insertJobLock(db, jobName, pid, startedAt);
          return { acquired: true };
        }
        // 自分と同じ番号の印は、前に同じ番号で動いたプロセスが残したもの（自分はまだ取っていない）。
        if (holderPid !== pid && isAlive(holderPid)) {
          return { acquired: false, holderPid };
        }
        // 前の起動が異常で終わって残った印とみなし、同じトランザクションの中で置き換える。
        replaceJobLock(db, jobName, pid, startedAt);
        return { acquired: true };
      });
    },
    release(jobName, pid) {
      return inWriteTransaction(db, () => deleteJobLock(db, jobName, pid) > 0);
    },
  };
}

// その番号のプロセスが生きているか。シグナル 0 は送らずに、送れるかだけを確かめる。
// ESRCH（そのプロセスが無い）なら死んでいる。EPERM（ほかのユーザのプロセス）は生きている。
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    if (code === "ESRCH") return false;
    if (code === "EPERM") return true;
    throw error;
  }
}

// 定期ジョブのプロセスの DB を開く（DD-03 5章。接続はプロセスごとに1つ。DD-01 2.1 M21）。
// `schema_migration` の最後の番号がこのプロセスの知る番号と違えば、E17（STARTUP_MISMATCH）を投げる。
// マイグレーションは当てない（当てるのは Web サーバだけ）。失敗したら DB を閉じて投げる。
export interface OpenJobDatabaseDeps {
  dataDir: string;
  // 比べる番号。試験で、番号の違うプロセスの代わりに渡す（DD-10 TC108 と同じ）。
  knownVersion?: number;
}

export function openJobDatabase(deps: OpenJobDatabaseDeps): Database {
  const db = openDatabase(databasePath(deps.dataDir));
  try {
    assertMigrationsApplied(db, deps.knownVersion);
  } catch (error) {
    db.close();
    throw toDbError(error);
  }
  return db;
}
