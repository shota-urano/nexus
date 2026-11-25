import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  REGISTRATION_FAILED_LOCATION,
  openRegistration,
} from "../src/app/api/_entry/open-registration";
import { runAdminCommand } from "../src/cli/admin";
import { createDeviceKeyVerifier } from "../src/server/auth/device-key";
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
import { createFakeClock, type FakeClock } from "../src/server/shared/clock";
import { createLogger, type Logger } from "../src/server/shared/logger";
import { formatMessage } from "../src/server/shared/messages";
import { createSecret, hashSecret } from "../src/server/shared/secret";

// 03-auth-and-admin の実装単位3: 管理のコマンドの `device add|list|revoke` と、
// 登録の URL を開く `openRegistration`（FN-023、DD-02 FN-023、DD-05 3章）。
// 受け入れ基準は TC93、TC94、TC95、TC96。

const NOW = "2026-12-01T08:00:00.000+09:00";
// 試験の NEXUS のオリジン（DD-09 2.2）。
const ORIGIN = "http://localhost:48401";
const REGISTERED = "2026-11-20T09:00:00.000+09:00";

let dataDir: string;
let db: Database;
let clock: FakeClock;
let logger: Logger;
let out: string[];
let err: string[];

const openFile = () => openDatabase(databasePath(dataDir));

// D1 の端末（DD-10 3章）を入れる。
function insertDevice(name: string, key: string): void {
  db.prepare(
    "INSERT INTO device (device_name, device_key_hash, registered_at, last_used_at) VALUES (?, ?, ?, ?)",
  ).run(name, hashSecret(key), REGISTERED, REGISTERED);
}

const run = (...argv: string[]) =>
  runAdminCommand(argv, {
    senderKeys: createSenderKeys({ db, clock }),
    device: { devices: createDevices({ db, clock }), origin: ORIGIN },
    output: { out: (line) => out.push(line), err: (line) => err.push(line) },
  });

const open = (code: string | null, target: Database = db) => {
  const url = new URL("/register", ORIGIN);
  if (code !== null) url.searchParams.set("code", code);
  return openRegistration({
    logger,
    devices: createDevices({ db: target, clock }),
  })(new Request(url, { method: "GET" }));
};

const deviceNames = () =>
  db
    .prepare("SELECT device_name FROM device ORDER BY device_name")
    .all()
    .map((row) => String(row.device_name));

const codeRows = () =>
  db
    .prepare(
      "SELECT code_hash, device_name, issued_at, expires_at FROM registration_code",
    )
    .all();

// `device add` が出した URL から登録コードを取り出す。
const codeOf = (url: string) =>
  new URL(url).searchParams.get("code") ?? "(なし)";

const readLogs = () =>
  readdirSync(join(dataDir, "logs"))
    .flatMap((file) =>
      readFileSync(join(dataDir, "logs", file), "utf8").split("\n"),
    )
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as Record<string, unknown>);

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "nexus-device-"));
  clock = createFakeClock(NOW);
  db = openFile();
  applyMigrations(db, readMigrations(MIGRATIONS_DIR), clock);
  // D1: 端末 `ipad`（鍵 K1）、`android`（鍵 K2）。
  insertDevice("ipad", createSecret());
  insertDevice("android", createSecret());
  logger = createLogger({
    process: "web",
    clock,
    dir: join(dataDir, "logs"),
  });
  out = [];
  err = [];
});
afterEach(() => {
  if (db.isOpen) db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

describe("TC93 `device add` で出した URL で `openRegistration` を開くと端末ができる（FN-023）", () => {
  // D1 には `android` があり、DD-02 FN-023 手順 1 では同じ名前を MSG-043 で断るので、
  // この確かめは D1 から `android` の行を除いた状態で行う。
  beforeEach(() => {
    db.prepare("DELETE FROM device WHERE device_name = 'android'").run();
  });

  it("URL は NEXUS_ORIGIN/register?code= で始まり、コードの有効な期限は 10 分後", () => {
    expect(run("device", "add", "android")).toBe(0);
    expect(err).toEqual([]);
    expect(out).toHaveLength(1);
    const url = out[0];
    expect(url.startsWith(`${ORIGIN}/register?code=`)).toBe(true);
    const code = codeOf(url);
    expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(codeRows()).toEqual([
      {
        code_hash: hashSecret(code),
        device_name: "android",
        issued_at: NOW,
        expires_at: "2026-12-01T08:10:00.000+09:00",
      },
    ]);
    // 端末は URL を開くまで作らない。
    expect(deviceNames()).toEqual(["ipad"]);
  });

  it("開くと 303 で / へ移り、P01 の属性の Cookie で鍵を渡し、端末ができてコードの行が消える", async () => {
    run("device", "add", "android");
    clock.advance(60_000);
    const response = await open(codeOf(out[0]));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/");
    const cookies = response.headers.getSetCookie();
    expect(cookies).toHaveLength(1);
    const parts = cookies[0].split(";").map((part) => part.trim());
    const [nameValue, ...attributes] = parts;
    expect(nameValue).toMatch(/^nexus_device=[A-Za-z0-9_-]{43}$/);
    expect(attributes).toEqual(
      expect.arrayContaining([
        "HttpOnly",
        "Secure",
        "SameSite=Strict",
        "Path=/",
        "Max-Age=34560000",
      ]),
    );
    const key = nameValue.slice("nexus_device=".length);

    const at = "2026-12-01T08:01:00.000+09:00";
    expect(
      db
        .prepare(
          "SELECT device_key_hash, registered_at, last_used_at FROM device WHERE device_name = 'android'",
        )
        .all(),
    ).toEqual([
      { device_key_hash: hashSecret(key), registered_at: at, last_used_at: at },
    ]);
    expect(codeRows()).toEqual([]);
    // 渡した鍵は P01 で通る。
    expect(createDeviceKeyVerifier({ db, clock }).verify(key).ok).toBe(true);
  });
});

describe("TC94 使えないコードで `openRegistration` を開く（FN-023 異常系、DD-06 E03）", () => {
  const expectRejected = async (code: string | null) => {
    const before = deviceNames();
    const response = await open(code);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(REGISTRATION_FAILED_LOCATION);
    expect(response.headers.get("location")).toBe("/?notice=MSG-021");
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(deviceNames()).toEqual(before);
  };

  it("10 分を過ぎたコード", async () => {
    run("device", "add", "pixel");
    clock.advance(10 * 60 * 1000);
    await expectRejected(codeOf(out[0]));
  });

  it("10 分の少し前のコードは使える（境界）", async () => {
    run("device", "add", "pixel");
    clock.advance(10 * 60 * 1000 - 1);
    const response = await open(codeOf(out[0]));
    expect(response.headers.get("location")).toBe("/");
    expect(deviceNames()).toEqual(["android", "ipad", "pixel"]);
  });

  it("使ったコード", async () => {
    run("device", "add", "pixel");
    const code = codeOf(out[0]);
    expect((await open(code)).headers.get("location")).toBe("/");
    await expectRejected(code);
    expect(deviceNames()).toEqual(["android", "ipad", "pixel"]);
  });

  it("無いコード、空のコード、コードなし、長すぎるコード", async () => {
    await expectRejected(createSecret());
    await expectRejected("");
    await expectRejected(null);
    await expectRejected("a".repeat(201));
  });

  it("E03 をログに警告で出し、コードと鍵はログに出さない", async () => {
    const code = createSecret();
    await open(code);
    const logs = readLogs();
    expect(logs).toEqual([
      expect.objectContaining({
        level: "warn",
        code: "AUTH_DENIED",
        msg: "MSG-021",
        target: "FN-023",
      }),
    ]);
    const text = JSON.stringify(logs);
    expect(text).not.toContain(code);
    expect(text).not.toContain(hashSecret(code));
  });

  it("コードを出した後に同じ名前の端末ができていたら MSG-021 で、端末と登録コードは変わらない", async () => {
    run("device", "add", "pixel");
    const code = codeOf(out[0]);
    insertDevice("pixel", createSecret());
    const codes = codeRows();

    await expectRejected(code);
    expect(codeRows()).toEqual(codes);
  });
});

// 同時に走らせる確かめは tests/03-auth-and-admin-register-route.test.ts（2つの Worker）で行う。
describe("TC95 同じコードで `openRegistration` を別々の接続から2回（FN-023 同時に操作されたとき、DD-05 3章）", () => {
  it("端末は1台だけで、片方は MSG-021", async () => {
    run("device", "add", "pixel");
    const code = codeOf(out[0]);
    // 2台の端末からの求めを、別々の DB の接続で受ける（ここでは順に処理される）。
    const first = openFile();
    const second = openFile();
    try {
      const responses = await Promise.all([
        open(code, first),
        open(code, second),
      ]);
      const locations = responses.map((r) => r.headers.get("location"));
      expect([...locations].sort()).toEqual(["/", "/?notice=MSG-021"]);
      const cookies = responses.map((r) => r.headers.getSetCookie().length);
      expect([...cookies].sort()).toEqual([0, 1]);
    } finally {
      first.close();
      second.close();
    }
    expect(deviceNames()).toEqual(["android", "ipad", "pixel"]);
    expect(codeRows()).toEqual([]);
  });
});

describe("TC96 `device add` の名前がある、`device revoke` の名前が無い（DD-06 E05・E07）", () => {
  it("`device add ipad` は MSG-043 と終了コード 1 で、コードを作らない", () => {
    expect(run("device", "add", "ipad")).toBe(1);
    expect(err).toEqual([formatMessage("MSG-043", { 端末の名前: "ipad" })]);
    expect(out).toEqual([]);
    expect(codeRows()).toEqual([]);
  });

  it("`device revoke tablet` は MSG-042 と終了コード 1 で、端末は変わらない", () => {
    expect(run("device", "revoke", "tablet")).toBe(1);
    expect(err).toEqual([formatMessage("MSG-042", { 端末の名前: "tablet" })]);
    expect(out).toEqual([]);
    expect(deviceNames()).toEqual(["android", "ipad"]);
  });
});

describe("device list|revoke（DD-02 FN-023 手順 3・4）", () => {
  it("list は名前、登録した日時、最後に使った日時を出し、鍵と照合値を出さない", () => {
    expect(run("device", "list")).toBe(0);
    expect(out).toEqual([
      `android\t${REGISTERED}\t${REGISTERED}`,
      `ipad\t${REGISTERED}\t${REGISTERED}`,
    ]);
  });

  it("revoke は端末を消し、消した端末の鍵は P01 で通らない", async () => {
    db.prepare("DELETE FROM device WHERE device_name = 'android'").run();
    run("device", "add", "android");
    const response = await open(codeOf(out[0]));
    const key = response.headers
      .getSetCookie()[0]
      .split(";")[0]
      .slice("nexus_device=".length);
    const verifier = createDeviceKeyVerifier({ db, clock });
    expect(verifier.verify(key).ok).toBe(true);

    out = [];
    expect(run("device", "revoke", "android")).toBe(0);
    expect(deviceNames()).toEqual(["ipad"]);
    expect(verifier.verify(key).ok).toBe(false);
  });

  it("add は有効な期限を過ぎた登録コードを消す", () => {
    run("device", "add", "pixel");
    clock.advance(10 * 60 * 1000);
    run("device", "add", "tablet");
    expect(codeRows().map((row) => row.device_name)).toEqual(["tablet"]);
  });

  it("引数が足りないときは使い方を出して終了コード 1", () => {
    expect(run("device", "add")).toBe(1);
    expect(run("device", "revoke")).toBe(1);
    expect(run("device")).toBe(1);
    expect(out).toEqual([]);
    expect(codeRows()).toEqual([]);
  });
});

// 管理のコマンドを、プロセスの入口（src/cli/main.ts）から一時のフォルダと一時の DB で動かす（DD-10 1章）。
describe("管理のコマンドのプロセスの入口から `device` を動かす", () => {
  const MAIN = new URL("../src/cli/main.ts", import.meta.url);

  const runMain = (argv: string[]) =>
    new Promise<{ status: number; stdout: string[]; stderr: string[] }>(
      (resolve, reject) => {
        const worker = new Worker(MAIN, {
          argv,
          env: {
            NEXUS_ENV: "test",
            NEXUS_DATA_DIR: dataDir,
            NEXUS_ORIGIN: ORIGIN,
            TZ: "Asia/Tokyo",
          },
          stdout: true,
          stderr: true,
        });
        const stdout: string[] = [];
        const stderr: string[] = [];
        worker.stdout.on("data", (chunk) => stdout.push(String(chunk)));
        worker.stderr.on("data", (chunk) => stderr.push(String(chunk)));
        worker.on("error", reject);
        worker.on("exit", (status) => {
          const lines = (chunks: string[]) =>
            chunks
              .join("")
              .split("\n")
              .filter((line) => line !== "");
          resolve({ status, stdout: lines(stdout), stderr: lines(stderr) });
        });
      },
    );

  beforeEach(() => {
    // 入口のプロセスが同じ DB のファイルを開くので、テストの接続を閉じておく。
    db.close();
  });

  it("TC93 `device add pixel` は NEXUS_ORIGIN/register?code= の URL を1回だけ出し、終了コード 0", async () => {
    const result = await runMain(["device", "add", "pixel"]);
    expect(result.status).toBe(0);
    expect(result.stderr).toEqual([]);
    expect(result.stdout).toHaveLength(1);
    expect(result.stdout[0].startsWith(`${ORIGIN}/register?code=`)).toBe(true);

    db = openFile();
    expect(codeRows()).toEqual([
      expect.objectContaining({
        code_hash: hashSecret(codeOf(result.stdout[0])),
        device_name: "pixel",
      }),
    ]);
  });

  it("TC96 `device add ipad` は MSG-043、`device revoke tablet` は MSG-042 で、どちらも終了コード 1", async () => {
    const add = await runMain(["device", "add", "ipad"]);
    expect(add.status).toBe(1);
    expect(add.stdout).toEqual([]);
    expect(add.stderr).toEqual([
      formatMessage("MSG-043", { 端末の名前: "ipad" }),
    ]);

    const revoke = await runMain(["device", "revoke", "tablet"]);
    expect(revoke.status).toBe(1);
    expect(revoke.stdout).toEqual([]);
    expect(revoke.stderr).toEqual([
      formatMessage("MSG-042", { 端末の名前: "tablet" }),
    ]);
  });
});
