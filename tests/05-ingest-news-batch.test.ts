import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { postNewsBatch } from "../src/app/api/_entry/news-batch";
import { runAdminCommand } from "../src/cli/admin";
import { createSenderKeys } from "../src/server/auth/sender-key";
import { type Database, openDatabase } from "../src/server/db/connection";
import { createIngest } from "../src/server/ingest";
import { NEWS_BATCH_MAX_BYTES } from "../src/server/kinds/news/ingest";
import { createFakeClock } from "../src/server/shared/clock";
import { createLogger } from "../src/server/shared/logger";
import { formatMessage } from "../src/server/shared/messages";
import { hashSecret } from "../src/server/shared/secret";
import { NOW, insertD1News, migrate } from "./fixtures/news";

// 05-ingest の実装単位1: 配信元の鍵の入口 P02 と、ニュースの受け取り `postNewsBatch`
// （M13 の共通の受け取り、M14 の種類の一覧、M15 の形の確かめ、P08 の検索の索引、記事の関係の判定の待ち）。
// FN-001、IF-001、DD-02 FN-001・3章 P02・P08、DD-05 2章。
// 受け入れ基準は TC01〜TC09、TC99、TC120。

const URL_BATCHES = "http://127.0.0.1:48400/api/inbox/batches";
const TODAY = "2026-12-01";

let dir: string;
let dbPath: string;
let logDir: string;
let db: Database;
let KB: string;
let KS: string;
const clock = createFakeClock(NOW);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-ingest-"));
  dbPath = join(dir, "nexus.db");
  logDir = join(dir, "logs");
  clock.set(NOW);
  db = openDatabase(dbPath);
  migrate(db);
  // 共通（D1）: ニュースと配信元の鍵 KB（brain-harness）、KS（sharpen）。
  insertD1News(db);
  const keys = createSenderKeys({ db, clock });
  KB = keys.issue("brain-harness").key;
  KS = keys.issue("sharpen").key;
});

afterEach(() => {
  if (db.isOpen) db.close();
  rmSync(dir, { recursive: true, force: true });
});

function logger() {
  return createLogger({ process: "web", clock, dir: logDir });
}

function handler() {
  const log = logger();
  return postNewsBatch({
    logger: log,
    senderKeys: createSenderKeys({ db, clock }),
    ingest: createIngest({ db, clock, logger: log }),
  });
}

function logLines(): Record<string, unknown>[] {
  const path = join(logDir, "web-2026-12-01.log");
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

interface Item {
  slug: string;
  kind: string;
  title: string;
  bodyMd: string;
  url: string;
  imageUrl?: string | null;
  theme: string;
}

const slugOf = (i: number) => (0xb00000000000 + i).toString(16);

function items(count: number): Item[] {
  return Array.from({ length: count }, (_, i) => ({
    slug: slugOf(i),
    kind: "read",
    title: `記事 ${i + 1}`,
    bodyMd: `記事 ${i + 1} の案内`,
    url: `https://example.com/articles/${i + 1}`,
    imageUrl: i % 2 === 0 ? `https://example.com/images/${i + 1}.png` : null,
    theme: i % 2 === 0 ? "AI" : "半導体",
  }));
}

function batch(list: unknown[], date: string = TODAY) {
  return { source: "brain-collect", date, items: list };
}

async function send(
  body: unknown,
  key: string | null = KB,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (key !== null) headers.authorization = `Bearer ${key}`;
  const response = await handler()(
    new Request(URL_BATCHES, {
      method: "POST",
      headers,
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
  return {
    status: response.status,
    json: (await response.json()) as Record<string, unknown>,
  };
}

const count = (sql: string, ...params: (string | number)[]) =>
  Number(db.prepare(sql).get(...params)?.n);

const counts = () => ({
  news: count("SELECT COUNT(*) AS n FROM content WHERE kind = 'news'"),
  article: count("SELECT COUNT(*) AS n FROM article"),
  delivery: count("SELECT COUNT(*) AS n FROM delivery"),
  aiRun: count("SELECT COUNT(*) AS n FROM ai_run"),
  searchIndex: count("SELECT COUNT(*) AS n FROM search_index"),
});

const rejectedDeliveries = () =>
  db
    .prepare(
      "SELECT sender, target_date, item_count, rejection_reason FROM delivery WHERE result = 'rejected' ORDER BY delivery_id",
    )
    .all();

const errorOf = (json: Record<string, unknown>) =>
  json.error as { code: string; message: string; messageId: string };

describe("TC01 2026-12-01 の記事 10 件を受け取る（FN-001、DD-02 FN-001 手順 7）", () => {
  it("TC01 200、itemCount 10。content と article と search_index が 10 行ずつ増え、delivery と relate の ai_run が1件ずつ。ログに MSG-031", async () => {
    const before = counts();
    const { status, json } = await send(batch(items(10)));

    expect(status).toBe(200);
    expect(json).toEqual({
      source: "brain-collect",
      date: TODAY,
      receivedAt: NOW,
      itemCount: 10,
      rejected: [],
    });

    const after = counts();
    expect(after.news - before.news).toBe(10);
    expect(after.article - before.article).toBe(10);
    expect(after.searchIndex - before.searchIndex).toBe(10);
    expect(after.delivery - before.delivery).toBe(1);

    const delivery = db
      .prepare(
        "SELECT delivery_id, sender, target_date, received_at, item_count, result FROM delivery ORDER BY delivery_id DESC LIMIT 1",
      )
      .get();
    expect(delivery).toMatchObject({
      sender: "brain-harness",
      target_date: TODAY,
      received_at: NOW,
      item_count: 10,
      result: "accepted",
    });

    const runs = db
      .prepare(
        "SELECT purpose, state, attempt, relate_delivery_id, created_at FROM ai_run",
      )
      .all();
    expect(runs).toEqual([
      {
        purpose: "relate",
        state: "queued",
        attempt: 1,
        relate_delivery_id: delivery?.delivery_id,
        created_at: NOW,
      },
    ]);

    // 内容と記事の値（BD-02 FN-001 業務ルール）。
    const first = db
      .prepare(
        `SELECT c.kind, c.title, c.target_date, c.received_at, c.delivery_id,
                a.guide_md, a.source_url, a.image_url, a.theme
         FROM content AS c JOIN article AS a ON a.content_id = c.content_id
         WHERE a.slug = ?`,
      )
      .get(slugOf(0));
    expect(first).toEqual({
      kind: "news",
      title: "記事 1",
      target_date: TODAY,
      received_at: NOW,
      delivery_id: delivery?.delivery_id,
      guide_md: "記事 1 の案内",
      source_url: "https://example.com/articles/1",
      image_url: "https://example.com/images/1.png",
      theme: "AI",
    });

    expect(
      logLines().filter(
        (line) => line.msg === "MSG-031" && line.target === "FN-001",
      ),
    ).toHaveLength(1);
  });

  it("TC01 `today` は日本時間の今日の日付にする（DD-02 FN-001 手順 5）", async () => {
    const { status, json } = await send(batch(items(1), "today"));
    expect(status).toBe(200);
    expect(json.date).toBe(TODAY);
    expect(
      count(
        "SELECT COUNT(*) AS n FROM content AS c JOIN article AS a ON a.content_id = c.content_id WHERE a.slug = ? AND c.target_date = ?",
        slugOf(0),
        TODAY,
      ),
    ).toBe(1);
  });

  it("TC01 検索の索引は見出しと案内を改行でつなぎ、NFKC で正規化して小文字にする（DD-02 3章 P08）", async () => {
    const list = items(1);
    list[0].title = "ＮＥＸＵＳ　の記事";
    list[0].bodyMd = "Ａｉ の案内";
    await send(batch(list));
    const contentId = db
      .prepare("SELECT content_id FROM article WHERE slug = ?")
      .get(slugOf(0))?.content_id;
    const row = db
      .prepare("SELECT body FROM search_index WHERE content_id = ?")
      .get(Number(contentId));
    expect(row?.body).toBe("nexus の記事\nai の案内");
  });
});

describe("TC02 同じ日付で送り直すと置き換える（FN-001 業務ルール、DD-05 3章）", () => {
  it("TC02 content は 10 行のまま。1件目の content_id は変わらず title は新しい値。content_state は残る。delivery は2件", async () => {
    await send(batch(items(10)));
    const firstId = Number(
      db.prepare("SELECT content_id FROM article WHERE slug = ?").get(slugOf(0))
        ?.content_id,
    );
    // 1件目の記事を開き保存した。
    db.prepare(
      "INSERT INTO content_state (content_id, opened_at, is_saved, saved_at) VALUES (?, ?, 1, ?)",
    ).run(firstId, NOW, NOW);
    const before = counts();
    const firstDelivery = Number(
      db.prepare("SELECT MAX(delivery_id) AS n FROM delivery").get()?.n,
    );

    clock.set("2026-12-01T08:10:00.000+09:00");
    const list = items(10);
    list[0].title = "記事 1（直した見出し）";
    const { status, json } = await send(batch(list));

    expect(status).toBe(200);
    expect(json.itemCount).toBe(10);
    const after = counts();
    expect(after.news).toBe(before.news);
    expect(after.article).toBe(before.article);
    expect(after.searchIndex).toBe(before.searchIndex);
    expect(
      count(
        "SELECT COUNT(*) AS n FROM delivery WHERE target_date = ? AND result = 'accepted' AND delivery_id >= ?",
        TODAY,
        firstDelivery,
      ),
    ).toBe(2);

    const replaced = db
      .prepare(
        "SELECT c.content_id, c.title, c.received_at, c.delivery_id FROM content AS c JOIN article AS a ON a.content_id = c.content_id WHERE a.slug = ?",
      )
      .get(slugOf(0));
    expect(replaced).toEqual({
      content_id: firstId,
      title: "記事 1（直した見出し）",
      received_at: "2026-12-01T08:10:00.000+09:00",
      delivery_id: firstDelivery + 1,
    });
    expect(
      db
        .prepare(
          "SELECT opened_at, is_saved, saved_at FROM content_state WHERE content_id = ?",
        )
        .get(firstId),
    ).toEqual({ opened_at: NOW, is_saved: 1, saved_at: NOW });
    // 検索の索引も新しい見出しで作り直す（DD-02 3章 P08）。
    expect(
      db
        .prepare("SELECT body FROM search_index WHERE content_id = ?")
        .all(firstId),
    ).toEqual([{ body: "記事 1(直した見出し)\n記事 1 の案内" }]);
  });
});

describe("TC03 items が 0 件（FN-001 代替の流れ）", () => {
  it("TC03 200、itemCount 0。delivery に item_count 0 の accepted が1件。ai_run は増えない", async () => {
    const before = counts();
    const { status, json } = await send(batch([]));

    expect(status).toBe(200);
    expect(json.itemCount).toBe(0);
    expect(json.rejected).toEqual([]);
    const after = counts();
    expect(after.aiRun).toBe(before.aiRun);
    expect(after.news).toBe(before.news);
    expect(after.delivery - before.delivery).toBe(1);
    expect(
      db
        .prepare(
          "SELECT target_date, item_count, result FROM delivery ORDER BY delivery_id DESC LIMIT 1",
        )
        .get(),
    ).toEqual({ target_date: TODAY, item_count: 0, result: "accepted" });
  });
});

describe("TC04 items の件数の境界（BD-06 IF-001 3.2、DD-02 FN-001 手順 4）", () => {
  it("TC04 100 件は 200", async () => {
    const { status, json } = await send(batch(items(100)));
    expect(status).toBe(200);
    expect(json.itemCount).toBe(100);
  });

  it("TC04 101 件は 400 と MSG-034。content は増えず、delivery に rejected が1件", async () => {
    const before = counts();
    const { status, json } = await send(batch(items(101)));

    expect(status).toBe(400);
    expect(errorOf(json)).toEqual({
      code: "bad_request",
      messageId: "MSG-034",
      message: formatMessage("MSG-034"),
    });
    const after = counts();
    expect(after.news).toBe(before.news);
    expect(after.aiRun).toBe(before.aiRun);
    expect(after.searchIndex).toBe(before.searchIndex);
    expect(rejectedDeliveries()).toEqual([
      {
        sender: "brain-harness",
        target_date: TODAY,
        item_count: 0,
        rejection_reason: "MSG-034",
      },
    ]);
  });
});

// 本文がちょうど bytes バイトになる送信の文（記事ごとの案内は 128 KiB まで）。
function bodyOfBytes(bytes: number): string {
  const list = items(10);
  const base = Buffer.byteLength(JSON.stringify(batch(list)));
  let need = bytes - base;
  for (const item of list) {
    const add = Math.min(
      need,
      128 * 1024 - Buffer.byteLength(item.bodyMd, "utf8"),
    );
    item.bodyMd += "a".repeat(add);
    need -= add;
  }
  if (need !== 0) throw new Error("本文を作れない");
  const text = JSON.stringify(batch(list));
  if (Buffer.byteLength(text) !== bytes) throw new Error("大きさが違う");
  return text;
}

describe("TC05 本文の大きさの境界（BD-06 IF-001 3.2、DD-02 FN-001 手順 1）", () => {
  it("TC05 1 MiB ちょうどは 200", async () => {
    const { status, json } = await send(bodyOfBytes(NEWS_BATCH_MAX_BYTES));
    expect(NEWS_BATCH_MAX_BYTES).toBe(1_048_576);
    expect(status).toBe(200);
    expect(json.itemCount).toBe(10);
  });

  it("TC05 1 MiB + 1 バイトは 413 と MSG-034 で、記事は何も残らない", async () => {
    const before = counts();
    const { status, json } = await send(bodyOfBytes(NEWS_BATCH_MAX_BYTES + 1));

    expect(status).toBe(413);
    expect(errorOf(json)).toEqual({
      code: "payload_too_large",
      messageId: "MSG-034",
      message: formatMessage("MSG-034"),
    });
    const after = counts();
    expect(after.news).toBe(before.news);
    expect(after.article).toBe(before.article);
    expect(after.aiRun).toBe(before.aiRun);
    expect(after.searchIndex).toBe(before.searchIndex);
    expect(rejectedDeliveries()).toEqual([
      {
        sender: "brain-harness",
        target_date: null,
        item_count: 0,
        rejection_reason: "MSG-034",
      },
    ]);
  });
});

describe("TC06 一部の記事の形が正しくない（FN-001 異常系、DD-02 FN-001 手順 6）", () => {
  it("TC06 200、itemCount 7、rejected に3件（slug と MSG-033）。同じ slug は最初の記事が残る", async () => {
    const list = items(10);
    list[2].slug = "b0000000000"; // 11 文字
    list[5].url = "javascript:alert(1)";
    list[8].slug = list[0].slug; // 同じ送信の中の2回目
    list[8].title = "2回目の記事";
    const before = counts();
    const { status, json } = await send(batch(list));

    expect(status).toBe(200);
    expect(json.itemCount).toBe(7);
    expect(json.rejected).toEqual([
      {
        slug: "b0000000000",
        reason: formatMessage("MSG-033", { 項目: "slug" }),
      },
      { slug: slugOf(5), reason: formatMessage("MSG-033", { 項目: "url" }) },
      { slug: slugOf(0), reason: formatMessage("MSG-033", { 項目: "slug" }) },
    ]);
    const after = counts();
    expect(after.news - before.news).toBe(7);
    expect(after.searchIndex - before.searchIndex).toBe(7);
    expect(
      db
        .prepare(
          "SELECT c.title FROM content AS c JOIN article AS a ON a.content_id = c.content_id WHERE a.slug = ?",
        )
        .all(slugOf(0)),
    ).toEqual([{ title: "記事 1" }]);
    expect(
      db
        .prepare(
          "SELECT item_count, result FROM delivery ORDER BY delivery_id DESC LIMIT 1",
        )
        .get(),
    ).toEqual({ item_count: 7, result: "accepted" });
  });
  it("TC06 同じ slug の最初の記事の形が正しくなくても、2回目の記事は断る", async () => {
    const list = items(3);
    list[0].url = "javascript:alert(1)";
    list[1].slug = list[0].slug; // 形は正しいが、同じ送信の中の2回目
    const before = counts();
    const { status, json } = await send(batch(list));

    expect(status).toBe(200);
    expect(json.itemCount).toBe(1);
    expect(json.rejected).toEqual([
      { slug: slugOf(0), reason: formatMessage("MSG-033", { 項目: "url" }) },
      { slug: slugOf(0), reason: formatMessage("MSG-033", { 項目: "slug" }) },
    ]);
    expect(counts().news - before.news).toBe(1);
    expect(
      db
        .prepare("SELECT COUNT(*) AS n FROM article WHERE slug = ?")
        .get(slugOf(0)),
    ).toEqual({ n: 0 });
  });
});

describe("TC07 全体の形が正しくない（FN-001 異常系、DD-06 E01）", () => {
  it("TC07 date の無い本文は 400 と MSG-033。何も残らず、delivery に rejected が1件", async () => {
    const before = counts();
    const { status, json } = await send({
      source: "brain-collect",
      items: items(3),
    });

    expect(status).toBe(400);
    expect(errorOf(json)).toEqual({
      code: "bad_request",
      messageId: "MSG-033",
      message: formatMessage("MSG-033", { 項目: "date" }),
    });
    const after = counts();
    expect(after.news).toBe(before.news);
    expect(after.aiRun).toBe(before.aiRun);
    expect(after.searchIndex).toBe(before.searchIndex);
    expect(rejectedDeliveries()).toEqual([
      {
        sender: "brain-harness",
        target_date: null,
        item_count: 0,
        rejection_reason: "MSG-033（項目: date）",
      },
    ]);
  });

  it("TC07 JSON でない本文は 400 と MSG-033（項目「本文」）。何も残らず、delivery に rejected が1件", async () => {
    const before = counts();
    const { status, json } = await send("{ これは JSON でない");

    expect(status).toBe(400);
    expect(errorOf(json)).toEqual({
      code: "bad_request",
      messageId: "MSG-033",
      message: formatMessage("MSG-033", { 項目: "本文" }),
    });
    const after = counts();
    expect(after.news).toBe(before.news);
    expect(after.aiRun).toBe(before.aiRun);
    expect(rejectedDeliveries()).toEqual([
      {
        sender: "brain-harness",
        target_date: null,
        item_count: 0,
        rejection_reason: "MSG-033（項目: 本文）",
      },
    ]);
  });
  it.each(["2026-13-01", "2026-00-01", "2026-02-30"])(
    "TC07 存在しない日付 %s は 400 と MSG-033（項目「date」）。何も残らない",
    async (date) => {
      const before = counts();
      const { status, json } = await send(batch(items(2), date));

      expect(status).toBe(400);
      expect(errorOf(json)).toEqual({
        code: "bad_request",
        messageId: "MSG-033",
        message: formatMessage("MSG-033", { 項目: "date" }),
      });
      const after = counts();
      expect(after.news).toBe(before.news);
      expect(after.aiRun).toBe(before.aiRun);
      expect(rejectedDeliveries()).toEqual([
        {
          sender: "brain-harness",
          target_date: null,
          item_count: 0,
          rejection_reason: "MSG-033（項目: date）",
        },
      ]);
    },
  );
});

describe("TC08 鍵が通らない（FN-001 異常系、DD-02 3章 P02、DD-06 E03）", () => {
  const expectDenied = async (key: string | null, nth: number) => {
    const before = counts();
    const { status, json } = await send(batch(items(3)), key);
    expect(status).toBe(401);
    expect(errorOf(json)).toEqual({
      code: "unauthorized",
      messageId: "MSG-032",
      message: formatMessage("MSG-032"),
    });
    const after = counts();
    expect(after.news).toBe(before.news);
    expect(after.article).toBe(before.article);
    expect(after.aiRun).toBe(before.aiRun);
    const rows = rejectedDeliveries();
    expect(rows).toHaveLength(nth);
    expect(rows[nth - 1]).toEqual({
      sender: "brain-harness",
      target_date: null,
      item_count: 0,
      rejection_reason: "MSG-032",
    });
  };

  it("TC08 鍵なし、sharpen の鍵 KS、取り消した鍵は、どれも 401 と MSG-032。delivery に brain-harness の rejected が1件ずつ", async () => {
    await expectDenied(null, 1);
    await expectDenied(KS, 2);
    createSenderKeys({ db, clock }).revoke("brain-harness");
    await expectDenied(KB, 3);
    expect(
      logLines().filter(
        (line) => line.code === "AUTH_DENIED" && line.msg === "MSG-032",
      ),
    ).toHaveLength(3);
  });

  it("TC08 `Bearer` の形でない欄も 401 と MSG-032（DD-02 3章 P02 手順 1）", async () => {
    const response = await handler()(
      new Request(URL_BATCHES, {
        method: "POST",
        headers: { authorization: KB },
        body: JSON.stringify(batch(items(1))),
      }),
    );
    expect(response.status).toBe(401);
    expect(rejectedDeliveries()).toHaveLength(1);
  });

  it("TC08 ログに鍵と照合値を残さない（DD-06 5章）", async () => {
    await send(batch(items(1)), KS);
    const text = readFileSync(join(logDir, "web-2026-12-01.log"), "utf8");
    expect(text).not.toContain(KS);
    expect(text).not.toContain(hashSecret(KS));
  });
});

describe("TC09 置き換えの途中で失敗する（FN-001 異常系、DD-05 2章）", () => {
  it("TC09 5件目の article を書くときに DB の失敗が起きると、500 と MSG-045。その送信の content、article、ai_run、search_index は1件も残らない", async () => {
    const base = count("SELECT COUNT(*) AS n FROM article");
    // 5件目の記事を書くときに失敗させる（同じ接続の一時のトリガー）。
    db.exec(
      `CREATE TEMP TRIGGER fail_fifth_article BEFORE INSERT ON main.article
       WHEN (SELECT COUNT(*) FROM main.article) >= ${base + 4}
       BEGIN SELECT RAISE(ABORT, 'injected'); END`,
    );
    const before = counts();
    const { status, json } = await send(batch(items(10)));

    expect(status).toBe(500);
    expect(errorOf(json)).toEqual({
      code: "internal",
      messageId: "MSG-045",
      message: formatMessage("MSG-045", { 理由: "予期しない失敗" }),
    });
    const after = counts();
    expect(after.news).toBe(before.news);
    expect(after.article).toBe(before.article);
    expect(after.aiRun).toBe(before.aiRun);
    expect(after.searchIndex).toBe(before.searchIndex);
    // 受け取った記録は残らず、別のトランザクションで断った記録が1件だけ増える。
    expect(after.delivery - before.delivery).toBe(1);
    expect(rejectedDeliveries()).toEqual([
      {
        sender: "brain-harness",
        target_date: TODAY,
        item_count: 0,
        rejection_reason: "MSG-045（理由: 予期しない失敗）",
      },
    ]);
    expect(
      logLines().filter(
        (line) => line.msg === "MSG-045" && line.level === "error",
      ),
    ).toHaveLength(1);
  });
});

describe("TC99 配信元の鍵を2回用意する（FN-024、DD-02 FN-024）", () => {
  it("TC99 1回目と2回目で違う鍵が1回ずつ出る。1回目の鍵は 401。sender-key list に鍵と照合値が出ない", async () => {
    const out: string[] = [];
    const run = (...argv: string[]) =>
      runAdminCommand(argv, {
        senderKeys: createSenderKeys({ db, clock }),
        output: { out: (line) => out.push(line), err: () => {} },
      });

    expect(run("sender-key", "issue", "brain-harness")).toBe(0);
    expect(run("sender-key", "issue", "brain-harness")).toBe(0);
    expect(out).toHaveLength(2);
    const [first, second] = out;
    expect(first).not.toBe(second);

    const denied = await send(batch(items(1)), first);
    expect(denied.status).toBe(401);
    expect(errorOf(denied.json).messageId).toBe("MSG-032");
    const accepted = await send(batch(items(1)), second);
    expect(accepted.status).toBe(200);

    out.length = 0;
    expect(run("sender-key", "list")).toBe(0);
    const listed = out.join("\n");
    for (const key of [first, second, KB, KS]) {
      expect(listed).not.toContain(key);
      expect(listed).not.toContain(hashSecret(key));
    }
    expect(listed).toContain("brain-harness");
  });
});

describe("TC120 同じ対象日の同じ slug を2つの接続から同時に送る（DD-05 3章 ENT-001・ENT-002）", () => {
  it("TC120 両方 200。その対象日と slug の content は1行だけで、後に確定した送信の値", async () => {
    const WORKER = new URL("./05-ingest-news-worker.ts", import.meta.url);
    const parties = 2;
    const barrier = new SharedArrayBuffer(4);
    const senders = [
      { now: "2026-12-01T08:00:01.000+09:00", title: "接続 1 の見出し" },
      { now: "2026-12-01T08:00:02.000+09:00", title: "接続 2 の見出し" },
    ];
    const results = await Promise.all(
      senders.map(
        ({ now, title }) =>
          new Promise<{ status: number; json: Record<string, unknown> }>(
            (resolve, reject) => {
              const list = items(3);
              list[0].title = title;
              const worker = new Worker(WORKER, {
                workerData: {
                  path: dbPath,
                  logDir,
                  now,
                  key: KB,
                  body: JSON.stringify(batch(list)),
                  barrier,
                  parties,
                },
              });
              worker.once("message", resolve);
              worker.once("error", reject);
              worker.once("exit", (code) => {
                if (code !== 0)
                  reject(new Error(`Worker が ${code} で終わった`));
              });
            },
          ),
      ),
    );

    for (const result of results) {
      expect(result.status).toBe(200);
      expect(result.json.itemCount).toBe(3);
    }
    const rows = db
      .prepare(
        "SELECT c.title, c.received_at, c.delivery_id FROM content AS c JOIN article AS a ON a.content_id = c.content_id WHERE c.kind = 'news' AND c.target_date = ? AND a.slug = ?",
      )
      .all(TODAY, slugOf(0));
    expect(rows).toHaveLength(1);

    // 後に確定した送信は、受け取った記録の ID が大きい方。
    const last = db
      .prepare(
        "SELECT delivery_id, received_at FROM delivery WHERE result = 'accepted' AND target_date = ? ORDER BY delivery_id DESC LIMIT 1",
      )
      .get(TODAY);
    const lastSender = senders.find(({ now }) => now === last?.received_at);
    expect(lastSender).toBeDefined();
    expect(rows[0]).toEqual({
      title: lastSender?.title,
      received_at: last?.received_at,
      delivery_id: last?.delivery_id,
    });
    expect(
      count(
        "SELECT COUNT(*) AS n FROM delivery WHERE result = 'accepted' AND target_date = ?",
        TODAY,
      ),
    ).toBe(3); // D1 の1件と、2つの送信
    expect(
      count(
        "SELECT COUNT(*) AS n FROM content AS c JOIN article AS a ON a.content_id = c.content_id WHERE c.target_date = ? AND a.slug LIKE 'b%'",
        TODAY,
      ),
    ).toBe(3);
  });
});
