import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runAdminCommand } from "../src/cli/admin";
import { createSenderKeys } from "../src/server/auth/sender-key";
import { type Database, openDatabase } from "../src/server/db/connection";
import {
  MIGRATIONS_DIR,
  applyMigrations,
  readMigrations,
} from "../src/server/db/migrations";
import { createFakeClock, type FakeClock } from "../src/server/shared/clock";
import { formatMessage } from "../src/server/shared/messages";
import { hashSecret } from "../src/server/shared/secret";

// 03-auth-and-admin の実装単位2: 管理のコマンド M30 の `sender-key issue|list|revoke` と、
// 配信元の鍵を M12 で作り照合する処理（FN-024、DD-01 M30・M12、DD-02 FN-024・3章 P05）。
// 受け入れ基準は TC100。

const NOW = "2026-12-01T08:00:00.000+09:00";

let db: Database;
let clock: FakeClock;
let out: string[];
let err: string[];

const run = (...argv: string[]) =>
  runAdminCommand(argv, {
    senderKeys: createSenderKeys({ db, clock }),
    output: { out: (line) => out.push(line), err: (line) => err.push(line) },
  });

const senderKeyRows = () =>
  db
    .prepare(
      "SELECT sender, key_hash, issued_at FROM sender_key ORDER BY sender",
    )
    .all();

beforeEach(() => {
  clock = createFakeClock(NOW);
  db = openDatabase(":memory:");
  applyMigrations(db, readMigrations(MIGRATIONS_DIR), clock);
  out = [];
  err = [];
});
afterEach(() => {
  if (db.isOpen) db.close();
});

describe("TC100 sender-key issue の配信元の名前が値に無い（FN-024 異常系、DD-06 E07）", () => {
  it("`sender-key issue cerebellum` は MSG-044 と終了コード 1 で、鍵を作らない", () => {
    const code = run("sender-key", "issue", "cerebellum");

    expect(code).toBe(1);
    expect(err).toEqual([
      formatMessage("MSG-044", {
        配信元: "cerebellum",
        配信元の一覧: "brain-harness、sharpen",
      }),
    ]);
    expect(out).toEqual([]);
    expect(senderKeyRows()).toEqual([]);
  });

  it("`sender-key revoke cerebellum` も MSG-044 と終了コード 1", () => {
    const code = run("sender-key", "revoke", "cerebellum");
    expect(code).toBe(1);
    expect(err).toEqual([
      formatMessage("MSG-044", {
        配信元: "cerebellum",
        配信元の一覧: "brain-harness、sharpen",
      }),
    ]);
  });
});

describe("sender-key issue|list|revoke（DD-02 FN-024、3章 P05）", () => {
  it("issue は 43 文字の base64url の鍵を1回だけ出し、照合値だけを残す", () => {
    expect(run("sender-key", "issue", "brain-harness")).toBe(0);
    expect(out).toHaveLength(1);
    const key = out[0];
    expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(senderKeyRows()).toEqual([
      { sender: "brain-harness", key_hash: hashSecret(key), issued_at: NOW },
    ]);
    expect(hashSecret(key)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("issue をもう一度打つと鍵を置き換え、前の鍵は通らない", () => {
    run("sender-key", "issue", "brain-harness");
    const first = out[0];
    clock.advance(60_000);
    run("sender-key", "issue", "brain-harness");
    const second = out[1];
    expect(second).not.toBe(first);

    const keys = createSenderKeys({ db, clock });
    expect(keys.verify(first, "IF-001")).toBeNull();
    expect(keys.verify(second, "IF-001")).toBe("brain-harness");
    expect(senderKeyRows()).toEqual([
      {
        sender: "brain-harness",
        key_hash: hashSecret(second),
        issued_at: "2026-12-01T08:01:00.000+09:00",
      },
    ]);
  });

  it("list は配信元と用意した日時だけを出し、鍵と照合値を出さない", () => {
    run("sender-key", "issue", "sharpen");
    run("sender-key", "issue", "brain-harness");
    const keys = [...out];
    out = [];

    expect(run("sender-key", "list")).toBe(0);
    expect(out).toEqual([`brain-harness\t${NOW}`, `sharpen\t${NOW}`]);
    for (const key of keys) {
      expect(out.join("\n")).not.toContain(key);
      expect(out.join("\n")).not.toContain(hashSecret(key));
    }
  });

  it("revoke は鍵を消し、消した鍵は通らない", () => {
    run("sender-key", "issue", "sharpen");
    const key = out[0];
    expect(run("sender-key", "revoke", "sharpen")).toBe(0);
    expect(senderKeyRows()).toEqual([]);
    expect(createSenderKeys({ db, clock }).verify(key, "IF-002")).toBeNull();
  });

  it("引数が足りないときは使い方を出して終了コード 1", () => {
    expect(run("sender-key", "issue")).toBe(1);
    expect(run("sender-key")).toBe(1);
    expect(out).toEqual([]);
    expect(senderKeyRows()).toEqual([]);
  });
});

describe("配信元の鍵の照合（M12。DD-02 3章 P02 手順 1・2）", () => {
  it("鍵の持ち主が使える連携だけを通す（brain-harness は IF-001、sharpen は IF-002 と IF-003）", () => {
    const keys = createSenderKeys({ db, clock });
    const brain = keys.issue("brain-harness").key;
    const sharpen = keys.issue("sharpen").key;

    expect(keys.verify(brain, "IF-001")).toBe("brain-harness");
    expect(keys.verify(brain, "IF-002")).toBeNull();
    expect(keys.verify(brain, "IF-003")).toBeNull();
    expect(keys.verify(sharpen, "IF-002")).toBe("sharpen");
    expect(keys.verify(sharpen, "IF-003")).toBe("sharpen");
    expect(keys.verify(sharpen, "IF-001")).toBeNull();
  });

  it("鍵が無い、空、知らない鍵は通らない", () => {
    const keys = createSenderKeys({ db, clock });
    keys.issue("brain-harness");
    expect(keys.verify(undefined, "IF-001")).toBeNull();
    expect(keys.verify(null, "IF-001")).toBeNull();
    expect(keys.verify("", "IF-001")).toBeNull();
    expect(keys.verify("not-a-key", "IF-001")).toBeNull();
  });
});
