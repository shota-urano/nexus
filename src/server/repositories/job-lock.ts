import type { Database } from "../db/connection";

// 定期ジョブの多重起動の印（DD-03 `job_lock`）の読み書き（DD-01 M22）。
// 取る、置き換える、消すの組み立ては M31 が1つの書き込みの権利の中で行う（DD-05 4章）。

export type JobName = "backup" | "purge";

// バッチの名前の印を持つプロセスの番号。印が無ければ null。
export function findJobLockPid(db: Database, jobName: JobName): number | null {
  const row = db
    .prepare("SELECT pid FROM job_lock WHERE job_name = ?")
    .get(jobName);
  return row === undefined ? null : Number(row.pid);
}

// 印を作る。行を作るのと番号を書くのは同じ文で行う（番号の無い印を作らない。DD-05 4章）。
export function insertJobLock(
  db: Database,
  jobName: JobName,
  pid: number,
  startedAt: string,
): void {
  db.prepare(
    "INSERT INTO job_lock (job_name, pid, started_at) VALUES (?, ?, ?)",
  ).run(jobName, pid, startedAt);
}

// 古い印を自分の番号に置き換える。置き換えた行の数を返す。
export function replaceJobLock(
  db: Database,
  jobName: JobName,
  pid: number,
  startedAt: string,
): number {
  return Number(
    db
      .prepare("UPDATE job_lock SET pid = ?, started_at = ? WHERE job_name = ?")
      .run(pid, startedAt, jobName).changes,
  );
}

// バッチの名前と番号が両方合う行だけを消す。消した行の数を返す。
export function deleteJobLock(
  db: Database,
  jobName: JobName,
  pid: number,
): number {
  return Number(
    db
      .prepare("DELETE FROM job_lock WHERE job_name = ? AND pid = ?")
      .run(jobName, pid).changes,
  );
}
