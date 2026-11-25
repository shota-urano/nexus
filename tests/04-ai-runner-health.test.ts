import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWebContext } from "../src/app/api/_entry/web-context";
import { GET } from "../src/app/api/health/route";
import { bootAiRunner } from "../src/runner/startup";
import { enqueueRelate } from "../src/server/ai-jobs";
import {
  type Database,
  databasePath,
  openDatabase,
} from "../src/server/db/connection";
import {
  MIGRATIONS_DIR,
  appliedVersion,
  readMigrations,
} from "../src/server/db/migrations";
import { createFakeClock } from "../src/server/shared/clock";
import { NOW, insertDelivery, migrate } from "./fixtures/news";

// 04-ai-runner の実装単位4: 状態を返す API `getHealth`（DD-04、CR-011）と、
// Web サーバの起動のときのマイグレーション、AI Runner の起動のときの番号の確かめ（DD-03 5章、DD-06 E17）。

const ENV_NAMES = ["NEXUS_ENV", "NEXUS_DATA_DIR"] as const;

function testEnv(dataDir: string): Record<string, string> {
  return { NEXUS_ENV: "test", NEXUS_DATA_DIR: dataDir };
}

// 置き場所のログのファイルの行を全て読む（DD-09 2.2 試験は `<データの置き場所>/logs`）。
function readLogLines(dataDir: string, processName: string) {
  const dir = join(dataDir, "logs");
  return readdirSync(dir)
    .filter((name) => name.startsWith(`${processName}-`))
    .flatMap((name) =>
      readFileSync(join(dir, name), "utf8")
        .split("\n")
        .filter((line) => line !== "")
        .map((line) => JSON.parse(line) as Record<string, unknown>),
    );
}

describe("getHealth を HTTP で呼ぶ", () => {
  let dataDir: string;
  let db: Database;
  let server: Server;
  let base: string;
  const savedEnv: Record<string, string | undefined> = {};

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "nexus-health-"));
    for (const name of ENV_NAMES) savedEnv[name] = process.env[name];
    Object.assign(process.env, testEnv(dataDir));
    db = openDatabase(databasePath(dataDir));
    migrate(db);
    server = await new Promise<Server>((resolve) => {
      const httpServer = createServer((req, res) => {
        const response = GET();
        res.statusCode = response.status;
        response.headers.forEach((value, name) => res.setHeader(name, value));
        void response.arrayBuffer().then((body) => res.end(Buffer.from(body)));
      });
      httpServer.listen(0, "127.0.0.1", () => resolve(httpServer));
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    db.close();
    for (const name of ENV_NAMES) {
      if (savedEnv[name] === undefined) delete process.env[name];
      else process.env[name] = savedEnv[name];
    }
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("TC103 待ちが2件のとき、Cookie なしで 200 と status、queuedCount 2、runningCount、oldestQueuedAt だけを返す", async () => {
    const deliveryId = insertDelivery(db, "2026-12-01", NOW, 3);
    const older = "2026-12-01T07:00:00.000+09:00";
    enqueueRelate(db, deliveryId, new Date(NOW));
    enqueueRelate(db, deliveryId, new Date(older));
    // 処理中が1件、終わったものが1件（待ちの数に入らない）。
    const running = enqueueRelate(db, deliveryId, new Date(NOW));
    db.prepare(
      "UPDATE ai_run SET state = 'running', started_at = ? WHERE ai_run_id = ?",
    ).run(NOW, running);
    const done = enqueueRelate(db, deliveryId, new Date(NOW));
    db.prepare(
      "UPDATE ai_run SET state = 'done', started_at = ?, finished_at = ? WHERE ai_run_id = ?",
    ).run(NOW, NOW, done);

    const response = await fetch(`${base}/api/health`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/^application\/json/);
    expect(response.headers.get("set-cookie")).toBeNull();
    const body = (await response.json()) as Record<string, unknown>;
    // ほかの項目（内容、鍵）が無い（CR-011）。
    expect(Object.keys(body).sort()).toEqual(
      ["oldestQueuedAt", "queuedCount", "runningCount", "status"].sort(),
    );
    expect(body).toEqual({
      status: "ok",
      queuedCount: 2,
      runningCount: 1,
      oldestQueuedAt: "2026-12-01T07:00:00.000+09:00",
    });
  });

  it("待ちが無いときは queuedCount 0 と oldestQueuedAt null を返す", async () => {
    db.exec("DELETE FROM ai_run");
    const response = await fetch(`${base}/api/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "ok",
      queuedCount: 0,
      runningCount: 0,
      oldestQueuedAt: null,
    });
  });
});

describe("Web サーバと AI Runner の起動", () => {
  const clock = createFakeClock(NOW);
  let dataDir: string;

  beforeAll(() => {
    dataDir = mkdtempSync(join(tmpdir(), "nexus-startup-"));
  });
  afterAll(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("TC108 空の DB で Web サーバの起動の処理をすると全てのマイグレーションが当たり、番号の違う AI Runner は E17 で終わる", () => {
    const env = testEnv(dataDir);
    const known = readMigrations(MIGRATIONS_DIR);
    expect(known.length).toBeGreaterThan(0);

    // マイグレーションを当てる前の AI Runner は、番号が違うので E17 で終わり、当てない（当てるのは Web サーバだけ）。
    const early = bootAiRunner({ env, clock, stderr: () => {} });
    expect(early).toEqual({ ok: false, exitCode: 1 });
    {
      const db = openDatabase(databasePath(dataDir));
      try {
        expect(appliedVersion(db)).toBe(0);
      } finally {
        db.close();
      }
    }

    // Web サーバの起動の処理。
    const web = createWebContext(env, clock);
    web.aiJobs.close();
    const db = openDatabase(databasePath(dataDir));
    try {
      const rows = db
        .prepare(
          "SELECT version, name, applied_at FROM schema_migration ORDER BY version",
        )
        .all();
      expect(rows).toEqual(
        known.map((migration) => ({
          version: migration.version,
          name: migration.name,
          applied_at: NOW,
        })),
      );
    } finally {
      db.close();
    }

    // 番号の同じ AI Runner は起動できる。
    const same = bootAiRunner({ env, clock, stderr: () => {} });
    expect(same.ok).toBe(true);
    if (same.ok) same.aiJobs.close();

    // 番号の違う AI Runner は E17 で終わり、ログに致命的として残す。
    const other = bootAiRunner({
      env,
      clock,
      knownVersion: known.length + 1,
      stderr: () => {},
    });
    expect(other).toEqual({ ok: false, exitCode: 1 });
    const fatal = readLogLines(dataDir, "runner").filter(
      (line) => line.code === "STARTUP_MISMATCH",
    );
    expect(fatal).toHaveLength(2);
    for (const line of fatal) expect(line.level).toBe("fatal");

    // 2回目の Web サーバの起動は、何も当てない（番号は同じまま）。
    const again = createWebContext(env, clock);
    again.aiJobs.close();
    const check = openDatabase(databasePath(dataDir));
    try {
      expect(appliedVersion(check)).toBe(known.length);
      expect(
        check.prepare("SELECT COUNT(*) AS n FROM schema_migration").get()?.n,
      ).toBe(known.length);
    } finally {
      check.close();
    }
  });

  it("設定が読めない AI Runner は E17 で終わり、標準エラーに出す", () => {
    const lines: string[] = [];
    const result = bootAiRunner({
      env: { NEXUS_ENV: "test" },
      clock,
      stderr: (line) => lines.push(line),
    });
    expect(result).toEqual({ ok: false, exitCode: 1 });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("STARTUP_MISMATCH");
  });
});
