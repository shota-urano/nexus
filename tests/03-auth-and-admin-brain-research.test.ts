import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { postNewsBatch } from "../src/app/api/_entry/news-batch";
import { senderApi } from "../src/app/api/_entry/sender-api";
import { runAdminCommand } from "../src/cli/admin";
import { createSenderKeys } from "../src/server/auth/sender-key";
import { type Database, openDatabase } from "../src/server/db/connection";
import { createIngest } from "../src/server/ingest";
import { createFakeClock } from "../src/server/shared/clock";
import { createLogger } from "../src/server/shared/logger";
import { formatMessage } from "../src/server/shared/messages";
import { hashSecret } from "../src/server/shared/secret";
import { NOW, migrate } from "./fixtures/news";

// 03-auth-and-admin の実装単位4: 管理のコマンドの `sender-key issue|list|revoke` と M12 の配信元の鍵の確かめに、
// 配信元 brain-research（使える連携は IF-005 だけ）を足す
// （FN-024、DD-01 M12・M30、DD-02 FN-024・3章 P02、BD-07 4.2、CR-020）。
// 受け入れ基準は TC99、TC100、TC150。
//
// TC150 の `postResearchReport` の 200 は、05-ingest の4行目で作る操作なので、ここでは
// 配信元の入口 P02（senderApi）に usedInterface "IF-005" と試験用の handler を付けて確かめる
// （2026-11-27 コーディネーターの判断。本物の 200 は 05 の4行目の TC130、TC133 で確かめる）。
// `postNewsBatch` は本物を使う。

const URL_BATCHES = "http://127.0.0.1:48400/api/inbox/batches";
const URL_RESEARCH = "http://127.0.0.1:48400/api/inbox/research-reports";
const TODAY = "2026-12-01";
const ALL_SENDERS = "brain-harness、sharpen、brain-research";

let dir: string;
let logDir: string;
let db: Database;
let out: string[];
let err: string[];
const clock = createFakeClock(NOW);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-brain-research-"));
  logDir = join(dir, "logs");
  clock.set(NOW);
  db = openDatabase(join(dir, "nexus.db"));
  migrate(db);
  out = [];
  err = [];
});

afterEach(() => {
  if (db.isOpen) db.close();
  rmSync(dir, { recursive: true, force: true });
});

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

function logger() {
  return createLogger({ process: "web", clock, dir: logDir });
}

// 本物の `postNewsBatch`（IF-001）。
function newsBatchHandler() {
  const log = logger();
  return postNewsBatch({
    logger: log,
    senderKeys: createSenderKeys({ db, clock }),
    ingest: createIngest({ db, clock, logger: log }),
  });
}

// P02 に usedInterface "IF-005" を付けた試験用の handler（`postResearchReport` の入口の代わり）。
let researchHandlerCalls: string[] = [];
function researchHandler() {
  return senderApi(
    { logger: logger(), senderKeys: createSenderKeys({ db, clock }) },
    (_request, info) => {
      researchHandlerCalls.push(info.sender);
      return Response.json({ sender: info.sender });
    },
    { usedInterface: "IF-005", target: "FN-025" },
  );
}
beforeEach(() => {
  researchHandlerCalls = [];
});

function newsBatch() {
  return {
    source: "brain-collect",
    date: TODAY,
    items: [
      {
        slug: "b00000000000",
        kind: "read",
        title: "記事 1",
        bodyMd: "記事 1 の案内",
        url: "https://example.com/articles/1",
        imageUrl: null,
        theme: "AI",
      },
    ],
  };
}

async function post(
  handler: (request: Request) => Promise<Response>,
  url: string,
  key: string,
  body: unknown,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const response = await handler(
    new Request(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(body),
    }),
  );
  return {
    status: response.status,
    json: (await response.json()) as Record<string, unknown>,
  };
}

const sendNews = (key: string) =>
  post(newsBatchHandler(), URL_BATCHES, key, newsBatch());
const sendResearch = (key: string) =>
  post((request) => researchHandler()(request, undefined), URL_RESEARCH, key, {
    topicId: "t1",
  });

const UNAUTHORIZED = {
  error: {
    code: "unauthorized",
    message: formatMessage("MSG-032"),
    messageId: "MSG-032",
  },
};

describe("TC99 配信元の鍵を2回用意する（FN-024、DD-02 FN-024）", () => {
  it("TC99 1回目と2回目で違う鍵が1回ずつ出る。1回目の鍵は 401。sender-key list に鍵と照合値が出ない", async () => {
    expect(run("sender-key", "issue", "brain-harness")).toBe(0);
    expect(run("sender-key", "issue", "brain-harness")).toBe(0);
    expect(out).toHaveLength(2);
    const [first, second] = out;
    expect(first).not.toBe(second);

    const denied = await sendNews(first);
    expect(denied.status).toBe(401);
    expect(denied.json).toEqual(UNAUTHORIZED);
    expect((await sendNews(second)).status).toBe(200);

    out = [];
    expect(run("sender-key", "list")).toBe(0);
    const listed = out.join("\n");
    for (const key of [first, second]) {
      expect(listed).not.toContain(key);
      expect(listed).not.toContain(hashSecret(key));
    }
    expect(listed).toContain("brain-harness");
  });

  it("TC99 brain-research の鍵も、2回用意すると違う鍵が1回ずつ出て、1回目の鍵は IF-005 で 401。list に鍵と照合値が出ない", async () => {
    expect(run("sender-key", "issue", "brain-research")).toBe(0);
    clock.advance(60_000);
    expect(run("sender-key", "issue", "brain-research")).toBe(0);
    expect(out).toHaveLength(2);
    const [first, second] = out;
    expect(first).not.toBe(second);

    const denied = await sendResearch(first);
    expect(denied.status).toBe(401);
    expect(denied.json).toEqual(UNAUTHORIZED);
    const accepted = await sendResearch(second);
    expect(accepted.status).toBe(200);
    expect(accepted.json).toEqual({ sender: "brain-research" });
    expect(researchHandlerCalls).toEqual(["brain-research"]);

    expect(senderKeyRows()).toEqual([
      {
        sender: "brain-research",
        key_hash: hashSecret(second),
        issued_at: "2026-12-01T08:01:00.000+09:00",
      },
    ]);

    out = [];
    expect(run("sender-key", "list")).toBe(0);
    expect(out).toEqual([`brain-research\t2026-12-01T08:01:00.000+09:00`]);
    const listed = out.join("\n");
    for (const key of [first, second]) {
      expect(listed).not.toContain(key);
      expect(listed).not.toContain(hashSecret(key));
    }
  });
});

describe("TC100 sender-key issue の配信元の名前が値に無い（FN-024 異常系、DD-06 E07）", () => {
  it("TC100 `sender-key issue cerebellum` は MSG-044（配信元の一覧に brain-research を含む）と終了コード 1", () => {
    expect(run("sender-key", "issue", "cerebellum")).toBe(1);
    expect(err).toEqual([
      formatMessage("MSG-044", {
        配信元: "cerebellum",
        配信元の一覧: ALL_SENDERS,
      }),
    ]);
    expect(out).toEqual([]);
    expect(senderKeyRows()).toEqual([]);
  });

  it("`sender-key revoke cerebellum` も MSG-044（配信元の一覧に brain-research を含む）と終了コード 1", () => {
    expect(run("sender-key", "revoke", "cerebellum")).toBe(1);
    expect(err).toEqual([
      formatMessage("MSG-044", {
        配信元: "cerebellum",
        配信元の一覧: ALL_SENDERS,
      }),
    ]);
  });
});

describe("TC150 brain-research の鍵（FN-024、CR-020）", () => {
  it("TC150 `sender-key issue brain-research` で鍵が1回出る。その鍵で IF-005 は 200、`postNewsBatch` は 401 と MSG-032", async () => {
    expect(run("sender-key", "issue", "brain-research")).toBe(0);
    expect(err).toEqual([]);
    expect(out).toHaveLength(1);
    const key = out[0];
    expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(senderKeyRows()).toEqual([
      { sender: "brain-research", key_hash: hashSecret(key), issued_at: NOW },
    ]);

    const research = await sendResearch(key);
    expect(research.status).toBe(200);
    expect(research.json).toEqual({ sender: "brain-research" });
    expect(researchHandlerCalls).toEqual(["brain-research"]);

    const news = await sendNews(key);
    expect(news.status).toBe(401);
    expect(news.json).toEqual(UNAUTHORIZED);
    expect(
      Number(
        db
          .prepare("SELECT COUNT(*) AS n FROM content WHERE kind = 'news'")
          .get()?.n,
      ),
    ).toBe(0);
  });

  it("brain-harness と sharpen の鍵は IF-005 で 401 と MSG-032（BD-10 T02、DD-04 3.1）", async () => {
    run("sender-key", "issue", "brain-harness");
    run("sender-key", "issue", "sharpen");
    const [harness, sharpen] = out;
    for (const key of [harness, sharpen]) {
      const response = await sendResearch(key);
      expect(response.status).toBe(401);
      expect(response.json).toEqual(UNAUTHORIZED);
    }
    expect(researchHandlerCalls).toEqual([]);
  });

  it("M12 の照合: brain-research の鍵は IF-005 だけを通す。ほかの鍵は IF-005 を通らない（DD-02 3章 P02 手順 2、BD-07 4.2）", () => {
    const keys = createSenderKeys({ db, clock });
    const research = keys.issue("brain-research").key;
    const harness = keys.issue("brain-harness").key;
    const sharpen = keys.issue("sharpen").key;

    expect(keys.verify(research, "IF-005")).toBe("brain-research");
    expect(keys.verify(research, "IF-001")).toBeNull();
    expect(keys.verify(research, "IF-002")).toBeNull();
    expect(keys.verify(research, "IF-003")).toBeNull();
    expect(keys.verify(harness, "IF-005")).toBeNull();
    expect(keys.verify(sharpen, "IF-005")).toBeNull();
    expect(keys.verify(harness, "IF-001")).toBe("brain-harness");
  });

  it("`sender-key list` は brain-research と用意した日時を出し、鍵と照合値を出さない", () => {
    run("sender-key", "issue", "brain-research");
    const key = out[0];
    out = [];
    expect(run("sender-key", "list")).toBe(0);
    expect(out).toEqual([`brain-research\t${NOW}`]);
    expect(out.join("\n")).not.toContain(key);
    expect(out.join("\n")).not.toContain(hashSecret(key));
  });

  it("`sender-key revoke brain-research` は鍵を消し、消した鍵は IF-005 で 401", async () => {
    run("sender-key", "issue", "brain-research");
    const key = out[0];
    expect(run("sender-key", "revoke", "brain-research")).toBe(0);
    expect(err).toEqual([]);
    expect(senderKeyRows()).toEqual([]);
    const response = await sendResearch(key);
    expect(response.status).toBe(401);
    expect(response.json).toEqual(UNAUTHORIZED);
  });
});
