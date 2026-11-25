import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createDeviceApiContext,
  deviceApi,
  type DeviceApiContext,
} from "../src/app/api/_entry/device-api";
import { toErrorResponse } from "../src/app/api/_entry/errors";
import { createDeviceKeyVerifier } from "../src/server/auth/device-key";
import { type Database, openDatabase } from "../src/server/db/connection";
import {
  MIGRATIONS_DIR,
  applyMigrations,
  readMigrations,
} from "../src/server/db/migrations";
import { createFakeClock, type FakeClock } from "../src/server/shared/clock";
import { formatDateTime } from "../src/server/shared/datetime";
import { NexusError } from "../src/server/shared/errors";
import { createLogger, type Logger } from "../src/server/shared/logger";
import { formatMessage } from "../src/server/shared/messages";
import { createSecret, hashSecret } from "../src/server/shared/secret";

// 03-auth-and-admin の実装単位1: API の入口の土台と、端末の鍵の確かめ P01
// （DD-01 M11・M12、DD-02 3章 P01、DD-04 3.1・3.4、DD-06）。受け入れ基準は TC97、TC98、TC115。

const NOW = "2026-12-01T08:00:00.000+09:00";
const ORIGIN = "http://localhost:48401";
const URL_BASE = `${ORIGIN}/api/app/test`;

let db: Database;
let clock: FakeClock;
let logDir: string;
let logger: Logger;
let context: DeviceApiContext;
// D1 の端末（DD-10 3章）: `ipad`（鍵 K1）、`android`（鍵 K2）。
let K1: string;
let K2: string;

function insertDevice(name: string, key: string, at: string): void {
  db.prepare(
    "INSERT INTO device (device_name, device_key_hash, registered_at, last_used_at) VALUES (?, ?, ?, ?)",
  ).run(name, hashSecret(key), at, at);
}

beforeEach(() => {
  clock = createFakeClock(NOW);
  db = openDatabase(":memory:");
  applyMigrations(db, readMigrations(MIGRATIONS_DIR), clock);
  K1 = createSecret();
  K2 = createSecret();
  const registered = "2026-11-20T09:00:00.000+09:00";
  insertDevice("ipad", K1, registered);
  insertDevice("android", K2, registered);
  logDir = mkdtempSync(join(tmpdir(), "nexus-p01-"));
  logger = createLogger({ process: "web", clock, dir: logDir });
  context = createDeviceApiContext({
    clock,
    logger,
    origin: ORIGIN,
    deviceKeys: createDeviceKeyVerifier({ db, clock }),
  });
});
afterEach(() => {
  if (db.isOpen) db.close();
  rmSync(logDir, { recursive: true, force: true });
});

// P01 を通す試験用の handler（テストの中だけで作る。DD-10 TC97）。
let handlerCalls = 0;
const testHandler = () =>
  deviceApi(context, (_request, info) => {
    handlerCalls += 1;
    return Response.json({ deviceName: info.device.deviceName });
  });
beforeEach(() => {
  handlerCalls = 0;
});

function request(
  init: { key?: string; method?: string; origin?: string | null } = {},
): Request {
  const headers = new Headers();
  if (init.key !== undefined) headers.set("cookie", `nexus_device=${init.key}`);
  const origin = init.origin === undefined ? ORIGIN : init.origin;
  if (origin !== null) headers.set("origin", origin);
  return new Request(URL_BASE, { method: init.method ?? "GET", headers });
}

function logLines(): Record<string, unknown>[] {
  return readdirSync(logDir).flatMap((name) =>
    readFileSync(join(logDir, name), "utf8")
      .trim()
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => JSON.parse(line) as Record<string, unknown>),
  );
}

function deleteIpad(): void {
  // 取り消しと同じ状態（DD-02 FN-023 手順 4）。
  db.prepare("DELETE FROM device WHERE device_name = 'ipad'").run();
}

async function expectUnauthorized(response: Response): Promise<void> {
  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({
    error: {
      code: "unauthorized",
      message: formatMessage("MSG-020"),
      messageId: "MSG-020",
    },
  });
  expect(response.headers.get("set-cookie")).toBeNull();
}

describe("TC97 端末の鍵が通らない（DD-02 3章 P01、BD-10 T01）", () => {
  it("取り消した端末の鍵 K1 の Cookie と、Cookie なしは、どちらも 401 と MSG-020", async () => {
    deleteIpad();
    const handler = testHandler();
    await expectUnauthorized(await handler(request({ key: K1 }), undefined));
    await expectUnauthorized(await handler(request(), undefined));
    expect(handlerCalls).toBe(0);
  });

  it("無い鍵と空の Cookie も 401 と MSG-020（応答で分けない。DD-04 3.1）", async () => {
    const handler = testHandler();
    await expectUnauthorized(
      await handler(request({ key: createSecret() }), undefined),
    );
    await expectUnauthorized(await handler(request({ key: "" }), undefined));
    expect(handlerCalls).toBe(0);
  });
});

describe("TC98 鍵が通ったとき（DD-02 3章 P01 手順 2、4）", () => {
  it("device.last_used_at が今になり、応答に Max-Age=34560000 の Cookie が付く", async () => {
    clock.advance(3 * 60 * 60 * 1000);
    const response = await testHandler()(request({ key: K1 }), undefined);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deviceName: "ipad" });
    const row = db
      .prepare("SELECT last_used_at FROM device WHERE device_name = 'ipad'")
      .get();
    expect(row?.last_used_at).toBe(formatDateTime(clock.now()));
    expect(row?.last_used_at).toBe("2026-12-01T11:00:00.000+09:00");
    // ほかの端末は変わらない。
    const other = db
      .prepare("SELECT last_used_at FROM device WHERE device_name = 'android'")
      .get();
    expect(other?.last_used_at).toBe("2026-11-20T09:00:00.000+09:00");

    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`nexus_device=${K1}`);
    expect(cookie).toContain("Max-Age=34560000");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Path=/");
  });
});

describe("TC115 E03 のログの抑え（DD-06 2章）", () => {
  function deniedLogs() {
    return logLines().filter((line) => line.code === "AUTH_DENIED");
  }

  it("1 分の間に3回、取り消した K1 で呼んでも、E03 のログは1回だけ", async () => {
    deleteIpad();
    const handler = testHandler();
    for (let i = 0; i < 3; i += 1) {
      await expectUnauthorized(await handler(request({ key: K1 }), undefined));
      clock.advance(20_000);
    }
    const logs = deniedLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      level: "warn",
      code: "AUTH_DENIED",
      msg: "MSG-020",
    });
    expect(logs[0].requestId).toMatch(/^[0-9a-f]{8}$/);
    // 鍵も照合値もログに残さない（DD-06 5章）。
    const text = readdirSync(logDir)
      .map((name) => readFileSync(join(logDir, name), "utf8"))
      .join("");
    expect(text).not.toContain(K1);
    expect(text).not.toContain(hashSecret(K1));
  });

  it("1 分を過ぎるともう一度出し、別の鍵は別に数える", async () => {
    deleteIpad();
    const handler = testHandler();
    await handler(request({ key: K1 }), undefined);
    await handler(request({ key: createSecret() }), undefined);
    expect(deniedLogs()).toHaveLength(2);
    clock.advance(60_000);
    await handler(request({ key: K1 }), undefined);
    expect(deniedLogs()).toHaveLength(3);
  });
});

describe("P01 手順 3 オリジン（DD-04 3.1、DD-06 E04）", () => {
  it("POST と PUT は Origin が違うか無いと 403 forbidden_origin と MSG-019 で、handler を呼ばない", async () => {
    const handler = testHandler();
    for (const init of [
      { method: "POST", origin: "https://evil.example" },
      { method: "PUT", origin: "https://evil.example" },
      { method: "POST", origin: null },
    ]) {
      const response = await handler(request({ key: K1, ...init }), undefined);
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({
        error: {
          code: "forbidden_origin",
          message: formatMessage("MSG-019"),
          messageId: "MSG-019",
        },
      });
    }
    expect(handlerCalls).toBe(0);
    expect(
      logLines().filter((line) => line.code === "ORIGIN_DENIED"),
    ).toHaveLength(3);
  });

  it("POST は同じオリジンなら通り、GET は Origin を見ない", async () => {
    const handler = testHandler();
    expect(
      (await handler(request({ key: K1, method: "POST" }), undefined)).status,
    ).toBe(200);
    expect(
      (await handler(request({ key: K1, origin: null }), undefined)).status,
    ).toBe(200);
    expect(handlerCalls).toBe(2);
  });
});

describe("DD-04 3.4 エラーから状態の番号と MSG への変換", () => {
  const cases = [
    ["INPUT_INVALID", 400, "bad_request"],
    ["RULE_VIOLATION", 400, "bad_request"],
    ["AUTH_DENIED", 401, "unauthorized"],
    ["ORIGIN_DENIED", 403, "forbidden_origin"],
    ["NOT_FOUND", 404, "not_found"],
    ["STATE_CONFLICT", 409, "reply_in_progress"],
    ["INPUT_TOO_LARGE", 413, "payload_too_large"],
    ["DB_UNAVAILABLE", 500, "internal"],
    ["INTERNAL", 500, "internal"],
  ] as const;

  it.each(cases)("%s は %i %s", async (errorCode, status, code) => {
    const response = toErrorResponse(new NexusError(errorCode, "理由"), {
      logger,
      requestId: "0a1b2c3d",
    });
    expect(response.status).toBe(status);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe(code);
  });

  it("handler の例外は、操作ごとの MSG で返し、内部の理由を応答に出さず、ログに分類を残す", async () => {
    const handler = deviceApi(
      context,
      () => {
        throw new NexusError("DB_UNAVAILABLE", "SQLITE_BUSY の秘密の理由");
      },
      {
        target: "FN-005",
        messages: { 500: { id: "MSG-003", values: { 操作: "既読に" } } },
      },
    );
    const response = await handler(
      request({ key: K1, method: "PUT" }),
      undefined,
    );
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({
      error: {
        code: "internal",
        message: formatMessage("MSG-003", { 操作: "既読に" }),
        messageId: "MSG-003",
      },
    });
    expect(text).not.toContain("SQLITE_BUSY");
    // 鍵は通っているので Cookie は付け直す。
    expect(response.headers.get("set-cookie")).toContain("Max-Age=34560000");
    const log = logLines().find((line) => line.code === "DB_UNAVAILABLE");
    expect(log).toMatchObject({
      level: "error",
      msg: "MSG-003",
      target: "FN-005",
    });
  });

  it("NexusError でない例外は E16 の 500 internal と MSG-019（読むだけの操作）", async () => {
    const handler = deviceApi(context, () => {
      throw new TypeError("予期しない");
    });
    const response = await handler(request({ key: K1 }), undefined);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: {
        code: "internal",
        message: formatMessage("MSG-019"),
        messageId: "MSG-019",
      },
    });
    expect(logLines().find((line) => line.code === "INTERNAL")).toMatchObject({
      level: "error",
    });
  });

  it("NexusError の msg は操作ごとの MSG より先に使う（getArticle の 404 は MSG-002）", async () => {
    const handler = deviceApi(context, () => {
      throw new NexusError("NOT_FOUND", "記事が無い", { msg: "MSG-002" });
    });
    const response = await handler(request({ key: K1 }), undefined);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: {
        code: "not_found",
        message: formatMessage("MSG-002"),
        messageId: "MSG-002",
      },
    });
  });

  it("最後に使った日時を変えられなくても処理を続け、分類を決めてログに出す（DD-06 1章）", async () => {
    db.exec(
      "CREATE TRIGGER device_no_update BEFORE UPDATE ON device BEGIN SELECT RAISE(ABORT, 'no'); END",
    );
    const response = await testHandler()(request({ key: K1 }), undefined);
    expect(response.status).toBe(200);
    expect(handlerCalls).toBe(1);
    const log = logLines().find(
      (line) =>
        typeof line.detail === "string" &&
        line.detail.includes("最後に使った日時"),
    );
    expect(log).toMatchObject({ code: "INTERNAL", level: "error" });
    expect(typeof log?.deviceId).toBe("number");
  });
});
