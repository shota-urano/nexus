import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type ContentStateApiContext,
  markOpened,
  setRead,
  setSaved,
} from "../src/app/api/_entry/content-state";
import { createDeviceApiContext } from "../src/app/api/_entry/device-api";
import { createDeviceKeyVerifier } from "../src/server/auth/device-key";
import { createContents } from "../src/server/contents";
import {
  type Database,
  databasePath,
  openDatabase,
} from "../src/server/db/connection";
import { createFakeClock, type FakeClock } from "../src/server/shared/clock";
import { NexusError } from "../src/server/shared/errors";
import { createLogger } from "../src/server/shared/logger";
import { formatMessage } from "../src/server/shared/messages";
import { createSecret, hashSecret } from "../src/server/shared/secret";
import { NOW, insertD1News, migrate } from "./fixtures/news";

// 07-contents の実装単位1: 内容の状態 M17（DD-02 3章 P04）と `markOpened`、`setRead`、`setSaved`。
// FN-004、FN-005、FN-006、DD-05 3章。受け入れ基準は TC24、TC26、TC126。

const ORIGIN = "http://localhost:48401";
const BASE = `${ORIGIN}/api/app/contents`;

let dir: string;
let logDir: string;
let db: Database;
let clock: FakeClock;
let K1: string;
let A1: number;
let context: ContentStateApiContext;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-07-state-"));
  logDir = join(dir, "logs");
  clock = createFakeClock(NOW);
  db = openDatabase(databasePath(dir));
  migrate(db);
  ({ A1 } = insertD1News(db));
  K1 = createSecret();
  db.prepare(
    "INSERT INTO device (device_name, device_key_hash, registered_at, last_used_at) VALUES ('ipad', ?, ?, ?)",
  ).run(hashSecret(K1), "2026-11-20T09:00:00.000+09:00", NOW);
  const logger = createLogger({ process: "web", clock, dir: logDir });
  context = {
    deviceApi: createDeviceApiContext({
      clock,
      logger,
      origin: ORIGIN,
      deviceKeys: createDeviceKeyVerifier({ db, clock }),
    }),
    contents: createContents({ db, clock }),
  };
});
afterEach(() => {
  if (db.isOpen) db.close();
  rmSync(dir, { recursive: true, force: true });
});

function request(
  contentId: number | string,
  segment: "opened" | "read" | "saved",
  body?: unknown,
  init: { origin?: string } = {},
): Request {
  const headers = new Headers({
    cookie: `nexus_device=${K1}`,
    origin: init.origin ?? ORIGIN,
  });
  if (body !== undefined) headers.set("content-type", "application/json");
  return new Request(`${BASE}/${contentId}/${segment}`, {
    method: segment === "opened" ? "POST" : "PUT",
    headers,
    body:
      body === undefined
        ? undefined
        : typeof body === "string"
          ? body
          : JSON.stringify(body),
  });
}

const route = (contentId: number | string) => ({
  params: Promise.resolve({ contentId: String(contentId) }),
});

function callOpened(contentId: number | string): Promise<Response> {
  return markOpened(context)(request(contentId, "opened"), route(contentId));
}
function callRead(
  contentId: number | string,
  body: unknown,
  init?: { origin?: string },
): Promise<Response> {
  return setRead(context)(
    request(contentId, "read", body, init),
    route(contentId),
  );
}
function callSaved(
  contentId: number | string,
  body: unknown,
  init?: { origin?: string },
): Promise<Response> {
  return setSaved(context)(
    request(contentId, "saved", body, init),
    route(contentId),
  );
}

interface StateRow {
  opened_at: string | null;
  is_read: number;
  read_at: string | null;
  is_saved: number;
  saved_at: string | null;
}

function stateRow(contentId: number): StateRow | undefined {
  return db
    .prepare(
      "SELECT opened_at, is_read, read_at, is_saved, saved_at FROM content_state WHERE content_id = ?",
    )
    .get(contentId) as StateRow | undefined;
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

describe("TC24 時計を変えて markOpened を2回（FN-004 同時に操作されたとき、DD-05 3章）", () => {
  it("opened_at は1回目の日時のまま", async () => {
    expect(stateRow(A1)).toBeUndefined();

    const first = await callOpened(A1);
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({
      contentId: A1,
      isNew: false,
      isRead: false,
      isSaved: false,
      savedAt: null,
    });
    expect(stateRow(A1)).toEqual({
      opened_at: NOW,
      is_read: 0,
      read_at: null,
      is_saved: 0,
      saved_at: null,
    });

    clock.set("2026-12-01T09:30:00.000+09:00");
    const second = await callOpened(A1);
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ contentId: A1, isNew: false });
    expect(stateRow(A1)?.opened_at).toBe(NOW);
  });

  it("既読と保存の行があっても、開いた日時だけを入れ、ほかの値を変えない", async () => {
    await callSaved(A1, { isSaved: true });
    clock.set("2026-12-01T09:00:00.000+09:00");
    await callOpened(A1);
    expect(stateRow(A1)).toEqual({
      opened_at: "2026-12-01T09:00:00.000+09:00",
      is_read: 0,
      read_at: null,
      is_saved: 1,
      saved_at: NOW,
    });
  });

  it("無い内容 ID は 404 と MSG-019 で、行を作らない", async () => {
    const response = await callOpened(9999);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: {
        code: "not_found",
        message: formatMessage("MSG-019"),
        messageId: "MSG-019",
      },
    });
    expect(stateRow(9999)).toBeUndefined();
  });
});

describe("TC26 既読の A1 に setRead true をもう一度（FN-005、DD-06 E06）", () => {
  it("200 で今の状態（既読）を返し、read_at は変わらない", async () => {
    const first = await callRead(A1, { isRead: true });
    expect(first.status).toBe(200);
    expect(stateRow(A1)).toMatchObject({ is_read: 1, read_at: NOW });

    clock.set("2026-12-01T10:00:00.000+09:00");
    const again = await callRead(A1, { isRead: true });
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({
      contentId: A1,
      isNew: true,
      isRead: true,
      isSaved: false,
      savedAt: null,
    });
    expect(stateRow(A1)).toMatchObject({ is_read: 1, read_at: NOW });
    expect(
      logLines().find((line) => line.code === "STATE_CONFLICT"),
    ).toMatchObject({ level: "info", target: "FN-005", contentId: A1 });
  });

  it("未読に戻すと read_at を空にし、もう一度既読にすると今の日時を入れる", async () => {
    await callRead(A1, { isRead: true });
    clock.set("2026-12-01T09:00:00.000+09:00");
    const back = await callRead(A1, { isRead: false });
    expect(back.status).toBe(200);
    expect(await back.json()).toMatchObject({ isRead: false });
    expect(stateRow(A1)).toMatchObject({ is_read: 0, read_at: null });

    clock.set("2026-12-01T10:00:00.000+09:00");
    await callRead(A1, { isRead: true });
    expect(stateRow(A1)).toMatchObject({
      is_read: 1,
      read_at: "2026-12-01T10:00:00.000+09:00",
    });
  });

  it("setSaved も同じ値のもう一度は saved_at を変えず、外すと saved_at を空にする", async () => {
    const saved = await callSaved(A1, { isSaved: true });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual({
      contentId: A1,
      isNew: true,
      isRead: false,
      isSaved: true,
      savedAt: NOW,
    });

    clock.set("2026-12-01T10:00:00.000+09:00");
    const again = await callSaved(A1, { isSaved: true });
    expect(await again.json()).toMatchObject({ isSaved: true, savedAt: NOW });
    expect(stateRow(A1)).toMatchObject({ is_saved: 1, saved_at: NOW });

    const off = await callSaved(A1, { isSaved: false });
    expect(await off.json()).toMatchObject({ isSaved: false, savedAt: null });
    expect(stateRow(A1)).toMatchObject({ is_saved: 0, saved_at: null });
  });

  it("本文の形が違うか内容 ID の形が違えば 400 と MSG-019、無い内容 ID は 404 で、行を作らない", async () => {
    for (const body of [
      { isRead: "true" },
      { isRead: true, extra: 1 },
      {},
      "JSON でない",
    ]) {
      const response = await callRead(A1, body);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: { code: "bad_request", messageId: "MSG-019" },
      });
    }
    expect((await callSaved("abc", { isSaved: true })).status).toBe(400);
    expect((await callSaved(A1, { isRead: true })).status).toBe(400);
    expect(stateRow(A1)).toBeUndefined();

    const missing = await callRead(9999, { isRead: true });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({
      error: { code: "not_found", messageId: "MSG-019" },
    });
  });

  it("Origin が違えば 403 で、データは変わらない（P01）", async () => {
    const response = await callSaved(
      A1,
      { isSaved: true },
      { origin: "https://example.com" },
    );
    expect(response.status).toBe(403);
    expect(stateRow(A1)).toBeUndefined();
  });
});

describe("TC126 別の接続が書き込みの権利を持つあいだに setRead（DD-05 1章、DD-06 E08）", () => {
  it("約 5 秒待った後に 500 internal を返し、ログの code が DB_UNAVAILABLE", async () => {
    const other = openDatabase(databasePath(dir));
    try {
      other.exec("BEGIN IMMEDIATE");
      const started = Date.now();
      const response = await callRead(A1, { isRead: true });
      const elapsed = Date.now() - started;
      other.exec("ROLLBACK");

      expect(response.status).toBe(500);
      expect(await response.json()).toMatchObject({
        error: { code: "internal", messageId: "MSG-003" },
      });
      // P01 の last_used_at の更新は待たないので、待つのは setRead の 5 秒の1回だけ。
      expect(elapsed).toBeGreaterThanOrEqual(4_500);
      expect(elapsed).toBeLessThan(7_000);
      const lines = logLines();
      expect(
        lines.find(
          (line) =>
            line.code === "DB_UNAVAILABLE" &&
            line.target === "FN-005" &&
            line.msg === "MSG-003",
        ),
      ).toBeDefined();
      // last_used_at を変えられなかったことも、続けてよい失敗としてログに出る。
      expect(
        lines.find(
          (line) =>
            line.code === "DB_UNAVAILABLE" &&
            String(line.detail).startsWith(
              "端末の鍵の最後に使った日時を変えられない",
            ),
        ),
      ).toBeDefined();
      expect(stateRow(A1)).toBeUndefined();
      // last_used_at の更新のあとは、接続のロックを待つ時間が 5 秒に戻っている。
      const timeout = db.prepare("PRAGMA busy_timeout").get() as Record<
        string,
        unknown
      >;
      expect(Object.values(timeout)[0]).toBe(5_000);
    } finally {
      if (other.isOpen) other.close();
    }
  }, 15_000);
});

describe("P01 で鍵を確かめる途中に DB が使えないとき（DD-04 3.4、DD-06 E08）", () => {
  function failingContext(): ContentStateApiContext {
    return {
      ...context,
      deviceApi: {
        ...context.deviceApi,
        deviceKeys: {
          verify() {
            throw new NexusError("DB_UNAVAILABLE", "database is locked");
          },
        },
      },
    };
  }

  it("setRead は 500 と MSG-003（操作は押した操作）を返し、データは変わらない", async () => {
    const failing = failingContext();
    for (const [isRead, operation] of [
      [true, "既読に"],
      [false, "未読に戻す"],
    ] as const) {
      const response = await setRead(failing)(
        request(A1, "read", { isRead }),
        route(A1),
      );
      expect(response.status).toBe(500);
      expect(response.headers.get("set-cookie")).toBeNull();
      expect(await response.json()).toEqual({
        error: {
          code: "internal",
          messageId: "MSG-003",
          message: formatMessage("MSG-003", { 操作: operation }),
        },
      });
    }
    expect(
      logLines().find(
        (line) =>
          line.code === "DB_UNAVAILABLE" &&
          line.target === "FN-005" &&
          line.msg === "MSG-003",
      ),
    ).toBeDefined();
    expect(stateRow(A1)).toBeUndefined();
  });

  it("setSaved は 500 と MSG-003（操作は押した操作）を返し、データは変わらない", async () => {
    const failing = failingContext();
    for (const [isSaved, operation] of [
      [true, "保存"],
      [false, "保存を外す"],
    ] as const) {
      const response = await setSaved(failing)(
        request(A1, "saved", { isSaved }),
        route(A1),
      );
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({
        error: {
          code: "internal",
          messageId: "MSG-003",
          message: formatMessage("MSG-003", { 操作: operation }),
        },
      });
    }
    expect(
      logLines().find(
        (line) =>
          line.code === "DB_UNAVAILABLE" &&
          line.target === "FN-006" &&
          line.msg === "MSG-003",
      ),
    ).toBeDefined();
    expect(stateRow(A1)).toBeUndefined();
  });
});
