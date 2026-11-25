import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GET } from "../src/app/register/route";
import { runAdminCommand } from "../src/cli/admin";
import { createDevices } from "../src/server/auth/devices";
import { createSenderKeys } from "../src/server/auth/sender-key";
import {
  type Database,
  databasePath,
  openDatabase,
} from "../src/server/db/connection";
import {
  MIGRATIONS_DIR,
  applyMigrations,
  readMigrations,
} from "../src/server/db/migrations";
import { systemClock } from "../src/server/shared/clock";
import { formatDateTime } from "../src/server/shared/datetime";
import { createSecret, hashSecret } from "../src/server/shared/secret";

// 03-auth-and-admin の実装単位3: 登録の URL の道 GET `/register`（src/app/register/route.ts）を、
// HTTP で受けて確かめる（TC93、TC94）。TC95 は2つの Worker から同時に呼ぶ。
// 道の部品は、Web サーバと同じく環境変数の設定で DB を開く（DD-09 2.2 試験）。
// 時計は本物の時計（道の部品が使う時計）で、登録コードもその時刻で作る。

// 試験の NEXUS のオリジン（DD-09 2.2）。
const ORIGIN = "http://localhost:48401";
const ENV_NAMES = ["NEXUS_ENV", "NEXUS_DATA_DIR", "NEXUS_ORIGIN"] as const;

let dataDir: string;
let db: Database;
let server: Server;
let base: string;
const savedEnv: Record<string, string | undefined> = {};

// 道の GET を、Node.js の HTTP のサーバで受ける。
function serveRoute(): Promise<Server> {
  const httpServer = createServer((req, res) => {
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) {
      if (typeof value === "string") headers.set(name, value);
    }
    void GET(
      new Request(new URL(req.url ?? "/", base), {
        method: req.method,
        headers,
      }),
    ).then(async (response) => {
      res.statusCode = response.status;
      response.headers.forEach((value, name) => {
        if (name !== "set-cookie") res.setHeader(name, value);
      });
      const cookies = response.headers.getSetCookie();
      if (cookies.length > 0) res.setHeader("set-cookie", cookies);
      res.end(Buffer.from(await response.arrayBuffer()));
    });
  });
  return new Promise((resolve) =>
    httpServer.listen(0, "127.0.0.1", () => resolve(httpServer)),
  );
}

// `device add` を動かし、出た登録の URL を返す。
function deviceAdd(name: string): string {
  const out: string[] = [];
  const err: string[] = [];
  const status = runAdminCommand(["device", "add", name], {
    senderKeys: createSenderKeys({ db, clock: systemClock }),
    device: {
      devices: createDevices({ db, clock: systemClock }),
      origin: ORIGIN,
    },
    output: { out: (line) => out.push(line), err: (line) => err.push(line) },
  });
  expect(status).toBe(0);
  expect(err).toEqual([]);
  return out[0];
}

// 登録の URL の道と問い合わせだけを、この HTTP のサーバに向ける。
const onServer = (registrationUrl: string) => {
  const url = new URL(registrationUrl);
  return new URL(`${url.pathname}${url.search}`, base);
};

const httpGet = (url: URL | string) => fetch(url, { redirect: "manual" });

const deviceNames = () =>
  db
    .prepare("SELECT device_name FROM device ORDER BY device_name")
    .all()
    .map((row) => String(row.device_name));

const codeRows = () =>
  db.prepare("SELECT device_name FROM registration_code").all();

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "nexus-register-"));
  for (const name of ENV_NAMES) savedEnv[name] = process.env[name];
  process.env.NEXUS_ENV = "test";
  process.env.NEXUS_DATA_DIR = dataDir;
  process.env.NEXUS_ORIGIN = ORIGIN;
  db = openDatabase(databasePath(dataDir));
  applyMigrations(db, readMigrations(MIGRATIONS_DIR), systemClock);
  server = await serveRoute();
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
beforeEach(() => {
  db.exec("DELETE FROM device; DELETE FROM registration_code;");
});

describe("GET /register を HTTP で開く", () => {
  it("TC93 `device add android` の URL を開くと、303 で / へ移り、端末の鍵の Cookie が渡り、端末ができてコードの行が消える", async () => {
    const registrationUrl = deviceAdd("android");
    expect(registrationUrl.startsWith(`${ORIGIN}/register?code=`)).toBe(true);

    const response = await httpGet(onServer(registrationUrl));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/");
    const cookies = response.headers.getSetCookie();
    expect(cookies).toHaveLength(1);
    const attributes = cookies[0].split("; ");
    expect(attributes[0]).toMatch(/^nexus_device=[A-Za-z0-9_-]{43}$/);
    expect(attributes).toEqual(
      expect.arrayContaining([
        "HttpOnly",
        "Secure",
        "SameSite=Strict",
        "Path=/",
      ]),
    );
    expect(deviceNames()).toEqual(["android"]);
    expect(codeRows()).toEqual([]);
  });

  it("TC94 期限を過ぎたコード、使ったコード、無いコードは、どれも 303 で /?notice=MSG-021 で、端末は増えず Cookie は渡らない", async () => {
    // 期限を過ぎたコード（有効な期限が今より前の行）。
    const expired = createSecret();
    const past = Date.now() - 60_000;
    db.prepare(
      "INSERT INTO registration_code (code_hash, device_name, issued_at, expires_at) VALUES (?, ?, ?, ?)",
    ).run(
      hashSecret(expired),
      "pixel",
      formatDateTime(new Date(past - 10 * 60 * 1000)),
      formatDateTime(new Date(past)),
    );
    // 使ったコード（一度開いて登録した URL）。
    const used = onServer(deviceAdd("tablet"));
    expect((await httpGet(used)).headers.get("location")).toBe("/");
    expect(deviceNames()).toEqual(["tablet"]);

    const targets = [
      new URL(`/register?code=${expired}`, base),
      used,
      new URL(`/register?code=${createSecret()}`, base),
    ];
    for (const target of targets) {
      const response = await httpGet(target);
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("/?notice=MSG-021");
      expect(response.headers.getSetCookie()).toEqual([]);
    }
    expect(deviceNames()).toEqual(["tablet"]);
  });
});

describe("TC95 同じコードで GET /register を2つの Worker から同時に開く（DD-05 3章）", () => {
  // Worker ごとに道の部品と DB の接続を持ち、待ち合わせてから同時に呼ぶ。
  const WORKER = new URL(
    "./03-auth-and-admin-register-worker.ts",
    import.meta.url,
  );

  interface Outcome {
    status: number;
    location: string | null;
    cookies: number;
  }

  const openAt = (url: string, barrier: SharedArrayBuffer, parties: number) =>
    new Promise<Outcome>((resolve, reject) => {
      const worker = new Worker(WORKER, {
        workerData: { url, barrier, parties },
        env: {
          NEXUS_ENV: "test",
          NEXUS_DATA_DIR: dataDir,
          NEXUS_ORIGIN: ORIGIN,
        },
      });
      worker.once("message", (outcome: Outcome) => resolve(outcome));
      worker.once("error", reject);
      worker.once("exit", (code) => {
        if (code !== 0) reject(new Error(`Worker が ${code} で終わった`));
      });
    });

  it("端末は1台だけで、片方は MSG-021", async () => {
    const registrationUrl = deviceAdd("pixel");
    const barrier = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
    const outcomes = await Promise.all([
      openAt(registrationUrl, barrier, 2),
      openAt(registrationUrl, barrier, 2),
    ]);

    expect(outcomes.map((o) => o.status)).toEqual([303, 303]);
    expect(outcomes.map((o) => o.location).sort()).toEqual([
      "/",
      "/?notice=MSG-021",
    ]);
    const registered = outcomes.find((o) => o.location === "/");
    const rejected = outcomes.find((o) => o.location !== "/");
    expect(registered?.cookies).toBe(1);
    expect(rejected?.cookies).toBe(0);
    expect(deviceNames()).toEqual(["pixel"]);
    expect(codeRows()).toEqual([]);
  });
});
