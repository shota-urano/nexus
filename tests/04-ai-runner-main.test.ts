import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnLauncher } from "../src/runner/ai-provider/launcher";
import type { LaunchedProcess } from "../src/runner/ai-provider";
import {
  type Database,
  databasePath,
  openDatabase,
} from "../src/server/db/connection";
import { appliedVersion } from "../src/server/db/migrations";
import { NOW, insertD1News, migrate, queueRelate } from "./fixtures/news";

// 04-ai-runner の実装単位4: AI Runner のプロセスの入口（src/runner/main.ts。DD-01 M24、DD-09 2.6）を
// 子のプロセスとして動かして確かめる。
// - 起動の確かめ（DD-03 5章、DD-06 E17）が通らなければ、終了コード 1 で終わり、マイグレーションを当てない。
// - 通れば、処理中のまま残った実行を失敗にしてから（DD-02 3章 P06 手順 1）拾い始め、SIGTERM で終わる。

const MAIN = join(import.meta.dirname, "../src/runner/main.ts");
const WAIT_MS = 20_000;

// 子のプロセスを起動するのは M26 の起動の口だけなので（DD-01 1.3）、それを使って入口を動かす。
// テストのプロセスの環境変数を引き継がず、渡したものだけにする（偽の AI は試験の既定。DD-09 2.2）。
function startRunner(
  dataDir: string,
  env: Record<string, string> = {
    NEXUS_ENV: "test",
    NEXUS_DATA_DIR: dataDir,
  },
): LaunchedProcess {
  const child = spawnLauncher({
    command: process.execPath,
    args: [MAIN],
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin", ...env },
    cwd: join(dataDir, "cwd"),
  });
  child.writeInput("");
  return child;
}

function withDb<T>(dataDir: string, read: (db: Database) => T): T {
  const db = openDatabase(databasePath(dataDir));
  try {
    return read(db);
  } finally {
    db.close();
  }
}

function readLogLines(dataDir: string) {
  const dir = join(dataDir, "logs");
  return readdirSync(dir)
    .filter((name) => name.startsWith("runner-"))
    .flatMap((name) =>
      readFileSync(join(dir, name), "utf8")
        .split("\n")
        .filter((line) => line !== "")
        .map((line) => JSON.parse(line) as Record<string, unknown>),
    );
}

async function waitUntil(check: () => boolean): Promise<void> {
  const deadline = Date.now() + WAIT_MS;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("待っても条件が成り立たない");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

interface RunRow {
  ai_run_id: number;
  state: string;
  attempt: number;
  relate_delivery_id: number;
  failure_reason: string | null;
  finished_at: string | null;
}

describe("AI Runner のプロセスの入口", () => {
  let dataDir: string;
  let running: LaunchedProcess | null = null;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "nexus-runner-main-"));
  });
  afterEach(async () => {
    if (running !== null) {
      running.kill("SIGKILL");
      await running.ended;
    }
    running = null;
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("TC108 マイグレーションの番号が違うと、当てずに E17 を致命的としてログに残し、終了コード 1 で終わる", async () => {
    running = startRunner(dataDir);
    const result = await running.ended;
    expect(result.code).toBe(1);
    // 当てるのは Web サーバだけ（DD-03 5章）。
    withDb(dataDir, (db) => expect(appliedVersion(db)).toBe(0));
    const fatal = readLogLines(dataDir).filter(
      (line) => line.code === "STARTUP_MISMATCH",
    );
    expect(fatal).toHaveLength(1);
    expect(fatal[0]?.level).toBe("fatal");
  });

  it("設定が読めないと、標準エラーに出して終了コード 1 で終わる", async () => {
    running = startRunner(dataDir, { NEXUS_ENV: "test" });
    const { code } = await running.ended;
    expect(code).toBe(1);
    expect(running.stderr()).toContain("STARTUP_MISMATCH");
  });

  it("起動の確かめが通ると、処理中のまま残った実行を失敗にしてから拾い始め、SIGTERM で終了コード 0 で終わる", async () => {
    const { stale1, stale2, queued, deliveryId } = withDb(dataDir, (db) => {
      migrate(db);
      const news = insertD1News(db);
      const markRunning = (aiRunId: number, attempt: number) =>
        db
          .prepare(
            "UPDATE ai_run SET state = 'running', started_at = ?, attempt = ? WHERE ai_run_id = ?",
          )
          .run(NOW, attempt, aiRunId);
      // 前の AI Runner が処理中のまま止まった実行（1回目と、送り直しの2回目）。
      const stale1 = queueRelate(db, news.todayDeliveryId);
      markRunning(stale1, 1);
      const stale2 = queueRelate(db, news.todayDeliveryId);
      markRunning(stale2, 2);
      const queued = queueRelate(db, news.todayDeliveryId);
      return { stale1, stale2, queued, deliveryId: news.todayDeliveryId };
    });

    const child = startRunner(dataDir);
    running = child;

    const rows = () =>
      withDb(
        dataDir,
        (db) =>
          db
            .prepare(
              "SELECT ai_run_id, state, attempt, relate_delivery_id, failure_reason, finished_at FROM ai_run ORDER BY ai_run_id",
            )
            .all() as unknown as RunRow[],
      );
    await waitUntil(() => {
      const all = rows();
      return (
        all.length === 4 &&
        all.every((row) => row.state !== "queued" && row.state !== "running")
      );
    });

    const all = rows();
    const byId = new Map(all.map((row) => [row.ai_run_id, row]));
    // 手順 1: 処理中のまま残った実行は失敗（E11、途中で止まった）。
    for (const id of [stale1, stale2]) {
      expect(byId.get(id)).toMatchObject({
        state: "failed",
        failure_reason: "AI_INTERRUPTED: 途中で止まった",
      });
      expect(byId.get(id)?.finished_at).not.toBeNull();
    }
    // 手順 5: 1回目は同じ受け取りの記録で2回目を待ちに入れ、それを拾って完了にした。2回目は送り直さない。
    const retried = all.filter(
      (row) => ![stale1, stale2, queued].includes(row.ai_run_id),
    );
    expect(retried).toHaveLength(1);
    expect(retried[0]).toMatchObject({
      state: "done",
      attempt: 2,
      relate_delivery_id: deliveryId,
    });
    // 待っていた実行も拾って完了にした（手順 2）。
    expect(byId.get(queued)?.state).toBe("done");

    const logs = readLogLines(dataDir);
    // 2回目の失敗は MSG-037（記事は残したまま。RD-06 UC-001）。
    expect(
      logs.filter((line) => line.msg === "MSG-037" && line.aiRunId === stale2),
    ).toHaveLength(1);
    // 失敗にしてから拾い始めた（起動のログの前に、手順 1 の失敗のログがある）。
    const started = logs.findIndex(
      (line) =>
        typeof line.detail === "string" &&
        line.detail.startsWith("AI Runner を起動した"),
    );
    expect(started).toBeGreaterThan(0);
    expect(logs[started]?.detail).toContain("2 件");
    const failedIndexes = logs
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => line.aiRunId === stale1 || line.aiRunId === stale2)
      .map(({ index }) => index);
    expect(failedIndexes).toHaveLength(2);
    for (const index of failedIndexes) expect(index).toBeLessThan(started);

    child.kill("SIGTERM");
    const result = await child.ended;
    expect(result.code).toBe(0);
    expect(
      readLogLines(dataDir).some(
        (line) => line.detail === "AI Runner を止めた",
      ),
    ).toBe(true);
  }, 30_000);
});
