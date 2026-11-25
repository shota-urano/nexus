import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runJobProcess } from "../src/jobs/process";
import { oneYearBefore } from "../src/jobs/purge";
import {
  type Database,
  databasePath,
  openDatabase,
} from "../src/server/db/connection";
import { createFakeClock } from "../src/server/shared/clock";
import { formatMessage } from "../src/server/shared/messages";
import {
  NOW,
  insertArticle,
  insertD1News,
  insertDelivery,
  migrate,
} from "./fixtures/news";

// 12-batch の実装単位2: BAT-002 古い記録の削除 M29（FN-022、DD-02 FN-022、DD-03 2.3）。
// 受け入れ基準は TC90、TC91、TC92、TC125。
// 入口（M27）から一時のフォルダと一時の DB で動かす（DD-10 1章）。今は 2026-12-01 08:00（日本時間）で、
// 境の日時は 2025-12-01 08:00（日本時間）。

const TODAY = "2026-12-01";
const BOUNDARY = "2025-12-01T08:00:00.000+09:00";

let dir: string;
let dataDir: string;
let db: Database;
const clock = createFakeClock(NOW);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-purge-"));
  dataDir = join(dir, "data");
  clock.set(NOW);
  db = openDatabase(databasePath(dataDir));
  migrate(db);
  // 1年に満たない記事と受け取りの記録（消さない側）。
  insertD1News(db);
});

afterEach(() => {
  if (db.isOpen) db.close();
  rmSync(dir, { recursive: true, force: true });
});

function runPurgeJob(
  options: Partial<Parameters<typeof runJobProcess>[1]> = {},
): Promise<number> {
  return runJobProcess(["purge"], {
    env: {
      NEXUS_ENV: "test",
      NEXUS_DATA_DIR: dataDir,
      NEXUS_BACKUP_DIR: join(dir, "backup"),
    },
    clock,
    stderr: () => undefined,
    ...options,
  });
}

function logLines(date = TODAY): Record<string, unknown>[] {
  const path = join(dataDir, "logs", `job-${date}.log`);
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

// 記事の関係の判定の実行（終わったもの）を、作った日時を決めて入れる。
function insertRelateRun(
  deliveryId: number,
  createdAt: string,
  attempt = 1,
): number {
  const result = db
    .prepare(
      "INSERT INTO ai_run (purpose, state, relate_delivery_id, attempt, created_at, started_at, finished_at) VALUES ('relate', 'done', ?, ?, ?, ?, ?)",
    )
    .run(deliveryId, attempt, createdAt, createdAt, createdAt);
  return Number(result.lastInsertRowid);
}

function insertOldArticle(deliveryId: number, receivedAt: string): number {
  return insertArticle(db, {
    title: `古い記事 ${deliveryId}`,
    theme: "AI",
    guideMd: "古い記事の案内",
    targetDate: receivedAt.slice(0, 10),
    receivedAt,
    deliveryId,
  });
}

function ids(table: "ai_run" | "delivery"): number[] {
  const column = table === "ai_run" ? "ai_run_id" : "delivery_id";
  return db
    .prepare(`SELECT ${column} AS id FROM ${table} ORDER BY ${column}`)
    .all()
    .map((row) => Number(row.id));
}

function contentDeliveryIds(): [number, number | null][] {
  return db
    .prepare("SELECT content_id, delivery_id FROM content ORDER BY content_id")
    .all()
    .map((row) => [
      Number(row.content_id),
      row.delivery_id === null ? null : Number(row.delivery_id),
    ]);
}

function deliveryIdOf(contentId: number): number | null {
  const row = db
    .prepare("SELECT delivery_id FROM content WHERE content_id = ?")
    .get(contentId);
  return row?.delivery_id === null ? null : Number(row?.delivery_id);
}

function lockRows(): unknown[] {
  return db.prepare("SELECT job_name, pid FROM job_lock").all();
}

// TC90 の前提: 1年より前の `ai_run` 3件と `delivery` 2件。その `delivery` を指す `content`。
function insertTc90(): {
  oldRuns: number[];
  oldDeliveries: number[];
  oldContents: number[];
} {
  const d1 = insertDelivery(
    db,
    "2025-11-01",
    "2025-11-01T07:00:00.000+09:00",
    1,
  );
  const d2 = insertDelivery(
    db,
    "2025-11-15",
    "2025-11-15T07:00:00.000+09:00",
    1,
  );
  const oldContents = [
    insertOldArticle(d1, "2025-11-01T07:00:00.000+09:00"),
    insertOldArticle(d2, "2025-11-15T07:00:00.000+09:00"),
  ];
  const oldRuns = [
    insertRelateRun(d1, "2025-11-01T07:05:00.000+09:00", 1),
    insertRelateRun(d1, "2025-11-01T07:10:00.000+09:00", 2),
    insertRelateRun(d2, "2025-11-15T07:05:00.000+09:00", 1),
  ];
  return { oldRuns, oldDeliveries: [d1, d2], oldContents };
}

describe("TC90 BAT-002 の正常", () => {
  it("1年より前の ai_run 3件と delivery 2件を消し、content は残して delivery_id を空にし、MSG-040（3件、2件）を出して終了コード 0", async () => {
    const { oldRuns, oldDeliveries, oldContents } = insertTc90();
    // 1年に満たない実行（消さない側）。
    const recentDelivery = ids("delivery").find(
      (id) => !oldDeliveries.includes(id),
    );
    const recentRun = insertRelateRun(
      recentDelivery as number,
      "2026-11-28T07:05:00.000+09:00",
    );
    const runsBefore = ids("ai_run");
    const deliveriesBefore = ids("delivery");
    const contentsBefore = contentDeliveryIds();

    const code = await runPurgeJob();

    expect(code).toBe(0);
    expect(ids("ai_run")).toEqual(
      runsBefore.filter((id) => !oldRuns.includes(id)),
    );
    expect(ids("ai_run")).toContain(recentRun);
    expect(ids("delivery")).toEqual(
      deliveriesBefore.filter((id) => !oldDeliveries.includes(id)),
    );
    // content は消さず、古い受け取りを指していた行だけ delivery_id が空になる。
    expect(contentDeliveryIds()).toEqual(
      contentsBefore.map(([contentId, deliveryId]) => [
        contentId,
        oldContents.includes(contentId) ? null : deliveryId,
      ]),
    );

    const lines = logLines();
    const done = lines.filter((line) => line.msg === "MSG-040");
    expect(done).toHaveLength(1);
    expect(done[0]?.level).toBe("info");
    expect(done[0]?.target).toBe("BAT-002");
    expect(String(done[0]?.detail)).toContain(
      formatMessage("MSG-040", { 件数1: 3, 件数2: 2 }),
    );
    // 開始と終了をログに出す（BD-02 5.4 ログ）。
    const details = lines.map((line) => String(line.detail));
    expect(details[0]).toContain("BAT-002 古い記録の削除を始めた");
    expect(details.at(-1)).toContain(
      "BAT-002 古い記録の削除を終えた（終了コード 0）",
    );
    expect(lockRows()).toEqual([]);
  });

  it("境の日時ちょうどに作った実行と受け取った記録は残し、その1ミリ秒前は消す", async () => {
    const before = "2025-12-01T07:59:59.999+09:00";
    const atBoundary = insertDelivery(db, "2025-12-01", BOUNDARY, 1);
    const justBefore = insertDelivery(db, "2025-12-01", before, 1);
    const keptRun = insertRelateRun(atBoundary, BOUNDARY);
    const removedRun = insertRelateRun(justBefore, before);

    const code = await runPurgeJob();

    expect(code).toBe(0);
    expect(ids("ai_run")).toContain(keptRun);
    expect(ids("ai_run")).not.toContain(removedRun);
    expect(ids("delivery")).toContain(atBoundary);
    expect(ids("delivery")).not.toContain(justBefore);
  });
});

describe("TC91 BAT-002 で消す順（DD-03 2.3）", () => {
  it("1年と1日前の delivery を1年に満たない relate の ai_run が指していれば、delivery も ai_run も残す", async () => {
    const delivery = insertDelivery(
      db,
      "2025-11-30",
      "2025-11-30T08:00:00.000+09:00",
      1,
    );
    const content = insertOldArticle(delivery, "2025-11-30T08:00:00.000+09:00");
    const run = insertRelateRun(delivery, "2025-12-02T08:00:00.000+09:00");

    const code = await runPurgeJob();

    expect(code).toBe(0);
    expect(ids("delivery")).toContain(delivery);
    expect(ids("ai_run")).toContain(run);
    // 手順 3.2 は境より前の受け取りを指す全ての content を空にする（DD-02 FN-022）。
    expect(deliveryIdOf(content)).toBeNull();
    const done = logLines().filter((line) => line.msg === "MSG-040");
    expect(String(done[0]?.detail)).toContain(
      formatMessage("MSG-040", { 件数1: 0, 件数2: 0 }),
    );
  });
});

describe("TC92 BAT-002 の失敗（DD-06 E08）", () => {
  it("delivery を消すときに失敗すると、全てを元のままにし、MSG-041 を出して終了コード 2", async () => {
    insertTc90();
    const runsBefore = ids("ai_run");
    const deliveriesBefore = ids("delivery");
    const contentsBefore = contentDeliveryIds();

    const code = await runPurgeJob({
      purgeBeforeDeleteDeliveries: () => {
        // SQLite の SQLITE_IOERR（E08）を差し込む。
        throw Object.assign(new Error("disk I/O error"), {
          code: "ERR_SQLITE_ERROR",
          errcode: 10,
        });
      },
    });

    expect(code).toBe(2);
    expect(ids("ai_run")).toEqual(runsBefore);
    expect(ids("delivery")).toEqual(deliveriesBefore);
    expect(contentDeliveryIds()).toEqual(contentsBefore);

    const lines = logLines();
    const failed = lines.filter((line) => line.msg === "MSG-041");
    expect(failed).toHaveLength(1);
    expect(failed[0]?.level).toBe("error");
    expect(failed[0]?.code).toBe("DB_UNAVAILABLE");
    expect(failed[0]?.target).toBe("BAT-002");
    expect(String(failed[0]?.detail)).toContain(
      formatMessage("MSG-041", { 理由: "DB が使えない" }),
    );
    expect(lines.filter((line) => line.msg === "MSG-040")).toEqual([]);
    expect(String(lines.at(-1)?.detail)).toContain("終了コード 2");
    // 異常で終わるときも印を消す（DD-05 4章）。
    expect(lockRows()).toEqual([]);
  });
});

describe("TC125 BAT-002 の再処理（DD-05 4章）", () => {
  it("続けて2回動かすと、2回目は消した件数が 0 で MSG-040（0 件、0 件）を出して終了コード 0", async () => {
    insertTc90();

    expect(await runPurgeJob()).toBe(0);
    const runsAfterFirst = ids("ai_run");
    const deliveriesAfterFirst = ids("delivery");
    const contentsAfterFirst = contentDeliveryIds();

    expect(await runPurgeJob()).toBe(0);

    expect(ids("ai_run")).toEqual(runsAfterFirst);
    expect(ids("delivery")).toEqual(deliveriesAfterFirst);
    expect(contentDeliveryIds()).toEqual(contentsAfterFirst);
    const done = logLines()
      .filter((line) => line.msg === "MSG-040")
      .map((line) => String(line.detail));
    expect(done).toHaveLength(2);
    expect(done[0]).toContain(formatMessage("MSG-040", { 件数1: 3, 件数2: 2 }));
    expect(done[1]).toContain(formatMessage("MSG-040", { 件数1: 0, 件数2: 0 }));
    expect(lockRows()).toEqual([]);
  });
});

describe("境の日時（DD-02 FN-022 手順 2）", () => {
  it("日本時間の今の1年前の同じ日時にする", () => {
    expect(oneYearBefore(NOW)).toBe(BOUNDARY);
    // 2月29日は前の年の2月28日の同じ時刻にする。DD-02 FN-022 に定めが無いため、
    // 本人の決定（2026-11-25、DD-02 への追記は別の CR で行う）に合わせる。
    expect(oneYearBefore("2028-02-29T03:30:00.000+09:00")).toBe(
      "2027-02-28T03:30:00.000+09:00",
    );
    expect(oneYearBefore("2029-02-28T03:30:00.000+09:00")).toBe(
      "2028-02-28T03:30:00.000+09:00",
    );
  });
});
