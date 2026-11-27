import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { parse as parseYaml } from "yaml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { postNewsBatch } from "../src/app/api/_entry/news-batch";
import { postResearchReport } from "../src/app/api/_entry/research-report";
import { createSenderKeys } from "../src/server/auth/sender-key";
import { type Database, openDatabase } from "../src/server/db/connection";
import { createIngest } from "../src/server/ingest";
import { isKind } from "../src/server/kinds";
import { createFakeClock } from "../src/server/shared/clock";
import { createLogger } from "../src/server/shared/logger";
import { formatMessage } from "../src/server/shared/messages";
import { NOW, insertD1News, migrate } from "./fixtures/news";

// 05-ingest の実装単位4: 週報の受け取り `postResearchReport`（POST `/api/research/reports`）と、
// `docs/api/openapi.yaml` の `postResearchReport` と schema（DD-04 の定義どおり。CR-021）、
// M10 の `ResearchReportPayload`、M14 への research（M33）の登録、M33 の形の確かめ、
// 研究課題と週報の作成と置き換え、検索の本文
// （FN-025、IF-005、DD-01 M10・M13・M14・M33、DD-02 FN-025・3章 P02・P08、DD-05 3章、CR-020）。
// 受け入れ基準は TC130〜TC137、TC102。
//
// TC130 の「`getResearchReport` の方法の `sourceCount`」は、`getResearchReport` が 14-research の
// 実装単位で作る操作なので、ここでは `sourceCount` の数え方の元（DD-03 2章: 出典の数は持たず、
// 読むときに `approaches_json` の `sourceUrls` の数で数える。Q-088 の答え）を DB で確かめる。

const URL_REPORTS = "http://127.0.0.1:48400/api/research/reports";
const URL_BATCHES = "http://127.0.0.1:48400/api/inbox/batches";
const TODAY = "2026-12-01";
const KIB = 1024;
const REPORT_MAX_BYTES = 256 * KIB;

let dir: string;
let dbPath: string;
let logDir: string;
let db: Database;
let KB: string;
let KS: string;
let KR: string;
const clock = createFakeClock(NOW);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-research-"));
  dbPath = join(dir, "nexus.db");
  logDir = join(dir, "logs");
  clock.set(NOW);
  db = openDatabase(dbPath);
  migrate(db);
  // 共通（D1）と、配信元の鍵 KB（brain-harness）、KS（sharpen）、KR（brain-research）。
  insertD1News(db);
  const keys = createSenderKeys({ db, clock });
  KB = keys.issue("brain-harness").key;
  KS = keys.issue("sharpen").key;
  KR = keys.issue("brain-research").key;
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
  return postResearchReport({
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

// ---- 週報の本文 ----

interface Approach {
  title: string;
  howToMd: string;
  sourceUrls: string[];
  marks: string[];
  counterMd?: string | null;
}

interface Report {
  source: string;
  topicId: string;
  topicTitle: string;
  week: number;
  sentOn: string;
  status: string;
  answerMd: string;
  approaches: Approach[];
  unknownsMd: string;
  changesMd: string;
}

// 課題 `second-brain` の1週目（方法3件。出典の URL が 2、1、0 件）。TC130 の入力。
function approaches(): Approach[] {
  return [
    {
      title: "評価の軸を決める",
      howToMd: "正しさと網羅の2つの軸を先に決める。",
      sourceUrls: [
        "https://example.com/research/axis-1",
        "https://example.com/research/axis-2",
      ],
      marks: ["added"],
      counterMd: null,
    },
    {
      title: "Ragas で測る",
      howToMd: "Ragas の指標で自動で測る。",
      sourceUrls: ["https://example.com/research/ragas"],
      marks: ["more_sources", "disputed"],
      counterMd: "自動の指標は人の評価と合わないことがある。",
    },
    {
      title: "人が読む",
      howToMd: "週に 20 件を人が読んで確かめる。",
      sourceUrls: [],
      marks: [],
      counterMd: null,
    },
  ];
}

function report(patch: Partial<Report> = {}): Report {
  return {
    source: "brain-research",
    topicId: "second-brain",
    topicTitle: "RAG の評価",
    week: 1,
    sentOn: TODAY,
    status: "active",
    answerMd: "ＲＡＧ は評価の軸を先に決める。",
    approaches: approaches(),
    unknownsMd: "人の評価との差はまだ分からない。",
    changesMd: "変化なし",
    ...patch,
  };
}

// 方法 n 件（見出しと URL が重ならない）。
function manyApproaches(n: number): Approach[] {
  return Array.from({ length: n }, (_, i) => ({
    title: `方法 ${i + 1}`,
    howToMd: `方法 ${i + 1} のやり方`,
    sourceUrls: [`https://example.com/research/many-${i + 1}`],
    marks: [],
    counterMd: null,
  }));
}

// UTF-8 でちょうど bytes バイトの文字（ほとんどを3バイトの文字にする。文字の数で数えると上限に届かない）。
function textOfBytes(bytes: number): string {
  const text = "あ".repeat(Math.floor(bytes / 3)) + "a".repeat(bytes % 3);
  if (Buffer.byteLength(text, "utf8") !== bytes) throw new Error("大きさ");
  return text;
}

// ちょうど length 文字の http の URL（i で重ならないようにする）。
function urlOfLength(length: number, i = 0): string {
  const head = `https://example.com/${i}/`;
  const url = head + "a".repeat(length - head.length);
  if (url.length !== length) throw new Error("URL の長さ");
  return url;
}

// ---- 送る ----

async function send(
  body: unknown,
  key: string | null = KR,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (key !== null) headers.authorization = `Bearer ${key}`;
  const response = await handler()(
    new Request(URL_REPORTS, {
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
  topic: count("SELECT COUNT(*) AS n FROM research_topic"),
  report: count("SELECT COUNT(*) AS n FROM research_report"),
  content: count("SELECT COUNT(*) AS n FROM content"),
  research: count("SELECT COUNT(*) AS n FROM content WHERE kind = 'research'"),
  delivery: count("SELECT COUNT(*) AS n FROM delivery"),
  accepted: count(
    "SELECT COUNT(*) AS n FROM delivery WHERE result = 'accepted'",
  ),
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

// 週報の内容ID（課題の ID と週から）。
const reportContentId = (topicKey: string, week: number) =>
  Number(
    db
      .prepare(
        "SELECT r.content_id FROM research_report AS r JOIN research_topic AS t ON t.topic_id = r.topic_id WHERE t.topic_key = ? AND r.week = ?",
      )
      .get(topicKey, week)?.content_id,
  );

const storedApproaches = (contentId: number): Approach[] =>
  JSON.parse(
    String(
      db
        .prepare(
          "SELECT approaches_json FROM research_report WHERE content_id = ?",
        )
        .get(contentId)?.approaches_json,
    ),
  ) as Approach[];

// 断ったときに何も残らないこと（研究課題、週報、内容、検索の索引、AI の実行が増えない。
// 受け取りの記録は、断った記録が1件だけ増える）。
function expectNothingKept(before: ReturnType<typeof counts>): void {
  const after = counts();
  expect(after.topic).toBe(before.topic);
  expect(after.report).toBe(before.report);
  expect(after.content).toBe(before.content);
  expect(after.searchIndex).toBe(before.searchIndex);
  expect(after.aiRun).toBe(before.aiRun);
  expect(after.accepted).toBe(before.accepted);
  expect(after.delivery - before.delivery).toBe(1);
}

describe("TC130 課題 second-brain の1週目を受け取る（FN-025、DD-02 FN-025 手順 6）", () => {
  it("TC130 200、replaced 偽。research_topic と research_report と content（research）が1行ずつ増え、delivery に accepted（item_count 1）。search_index が1行増え、ai_run は増えない。ログに MSG-031", async () => {
    const before = counts();
    const { status, json } = await send(report());

    expect(status).toBe(200);
    expect(json).toEqual({
      source: "brain-research",
      topicId: "second-brain",
      week: 1,
      receivedAt: NOW,
      replaced: false,
    });

    const after = counts();
    expect(after.topic - before.topic).toBe(1);
    expect(after.report - before.report).toBe(1);
    expect(after.research - before.research).toBe(1);
    expect(after.content - before.content).toBe(1);
    expect(after.searchIndex - before.searchIndex).toBe(1);
    expect(after.delivery - before.delivery).toBe(1);
    expect(after.aiRun).toBe(before.aiRun);

    const delivery = db
      .prepare(
        "SELECT delivery_id, sender, target_date, received_at, item_count, result, rejection_reason FROM delivery ORDER BY delivery_id DESC LIMIT 1",
      )
      .get();
    expect(delivery).toMatchObject({
      sender: "brain-research",
      target_date: TODAY,
      received_at: NOW,
      item_count: 1,
      result: "accepted",
      rejection_reason: null,
    });

    expect(
      db
        .prepare(
          "SELECT topic_key, title, status, last_week, last_received_at FROM research_topic",
        )
        .all(),
    ).toEqual([
      {
        topic_key: "second-brain",
        title: "RAG の評価",
        status: "active",
        last_week: 1,
        last_received_at: NOW,
      },
    ]);

    const contentId = reportContentId("second-brain", 1);
    expect(
      db
        .prepare(
          "SELECT kind, title, target_date, received_at, delivery_id FROM content WHERE content_id = ?",
        )
        .get(contentId),
    ).toEqual({
      kind: "research",
      title: "RAG の評価（1週目）",
      target_date: TODAY,
      received_at: NOW,
      delivery_id: delivery?.delivery_id,
    });
    expect(
      db
        .prepare(
          "SELECT week, sent_on, status, answer_md, unknowns_md, changes_md FROM research_report WHERE content_id = ?",
        )
        .get(contentId),
    ).toEqual({
      week: 1,
      sent_on: TODAY,
      status: "active",
      answer_md: "ＲＡＧ は評価の軸を先に決める。",
      unknowns_md: "人の評価との差はまだ分からない。",
      changes_md: "変化なし",
    });

    // 方法は送られた順に、BD-06 IF-005 3.2 の名前のまま残す（DD-03 2章）。
    const stored = storedApproaches(contentId);
    expect(stored).toEqual(approaches());
    // `sourceCount` の元（出典の URL の数）が 2、1、0（Q-088 の答え）。
    expect(stored.map((a) => a.sourceUrls.length)).toEqual([2, 1, 0]);

    expect(
      logLines().filter(
        (line) => line.msg === "MSG-031" && line.target === "FN-025",
      ),
    ).toHaveLength(1);
  });

  it("TC130 検索の本文は見出し「{課題名}（1週目）」、現時点の答え、方法の見出しを改行でつなぎ、NFKC で正規化して小文字にする（DD-02 FN-025 手順 6.4、3章 P08）", async () => {
    await send(report());
    const contentId = reportContentId("second-brain", 1);
    expect(
      db
        .prepare("SELECT body FROM search_index WHERE content_id = ?")
        .all(contentId),
    ).toEqual([
      {
        body: "rag の評価(1週目)\nrag は評価の軸を先に決める。\n評価の軸を決める\nragas で測る\n人が読む",
      },
    ]);
  });

  it("TC130 M14 の種類の一覧に research がある（DD-01 M14）", () => {
    expect(isKind("research")).toBe(true);
  });

  it("TC130 counterMd を省いた方法も受け取る（BD-06 IF-005 3.2。任意）", async () => {
    const list = approaches();
    delete list[0].counterMd;
    const { status } = await send(report({ approaches: list }));
    expect(status).toBe(200);
  });

  it("TC130 方法が 0 件の週報も受け取る（BD-06 IF-005 3.2）", async () => {
    const { status } = await send(report({ approaches: [] }));
    expect(status).toBe(200);
    const contentId = reportContentId("second-brain", 1);
    expect(storedApproaches(contentId)).toEqual([]);
  });
});

describe("TC131 同じ課題の同じ週を送り直すと置き換える（FN-025 業務ルール、RD-03 R23）", () => {
  it("TC131 200、replaced 真。content の内容ID は変わらず、方法が4件。content_state の既読と保存は残る。delivery は2件", async () => {
    await send(report());
    const contentId = reportContentId("second-brain", 1);
    // その週報を既読にし、保存した。
    db.prepare(
      "INSERT INTO content_state (content_id, opened_at, is_read, read_at, is_saved, saved_at) VALUES (?, ?, 1, ?, 1, ?)",
    ).run(contentId, NOW, NOW, NOW);
    const before = counts();

    const LATER = "2026-12-01T08:10:00.000+09:00";
    clock.set(LATER);
    const list = [
      ...approaches(),
      {
        title: "利用者に聞く",
        howToMd: "月に1回、使った人に聞く。",
        sourceUrls: ["https://example.com/research/interview"],
        marks: ["added"],
        counterMd: null,
      },
    ];
    const { status, json } = await send(
      report({
        approaches: list,
        answerMd: "評価の軸と人の確かめを組み合わせる。",
      }),
    );

    expect(status).toBe(200);
    expect(json).toEqual({
      source: "brain-research",
      topicId: "second-brain",
      week: 1,
      receivedAt: LATER,
      replaced: true,
    });
    const after = counts();
    expect(after.topic).toBe(before.topic);
    expect(after.report).toBe(before.report);
    expect(after.content).toBe(before.content);
    expect(after.searchIndex).toBe(before.searchIndex);
    expect(after.aiRun).toBe(before.aiRun);
    expect(reportContentId("second-brain", 1)).toBe(contentId);
    expect(storedApproaches(contentId)).toHaveLength(4);
    expect(storedApproaches(contentId)).toEqual(list);
    expect(
      db
        .prepare("SELECT answer_md FROM research_report WHERE content_id = ?")
        .get(contentId),
    ).toEqual({ answer_md: "評価の軸と人の確かめを組み合わせる。" });

    // 内容の届いた日時と受け取りの記録は新しい送信のもの。
    const last = db
      .prepare(
        "SELECT delivery_id FROM delivery WHERE result = 'accepted' ORDER BY delivery_id DESC LIMIT 1",
      )
      .get();
    expect(
      db
        .prepare(
          "SELECT received_at, delivery_id FROM content WHERE content_id = ?",
        )
        .get(contentId),
    ).toEqual({ received_at: LATER, delivery_id: last?.delivery_id });

    expect(
      db
        .prepare(
          "SELECT opened_at, is_read, read_at, is_saved, saved_at FROM content_state WHERE content_id = ?",
        )
        .get(contentId),
    ).toEqual({
      opened_at: NOW,
      is_read: 1,
      read_at: NOW,
      is_saved: 1,
      saved_at: NOW,
    });
    expect(
      count(
        "SELECT COUNT(*) AS n FROM delivery WHERE sender = 'brain-research' AND result = 'accepted'",
      ),
    ).toBe(2);

    // 検索の索引も新しい値で作り直す（DD-02 3章 P08）。
    expect(
      db
        .prepare("SELECT body FROM search_index WHERE content_id = ?")
        .all(contentId),
    ).toEqual([
      {
        body: "rag の評価(1週目)\n評価の軸と人の確かめを組み合わせる。\n評価の軸を決める\nragas で測る\n人が読む\n利用者に聞く",
      },
    ]);
  });
});

describe("TC132 過去の週を送り直す（DD-02 FN-025 手順 6.2）", () => {
  it("TC132 1週目の週報は新しい値になる。research_topic の title、status（ended）、last_week（2）は変わらない。週報は2件", async () => {
    await send(report());
    const W2_AT = "2026-12-01T08:05:00.000+09:00";
    clock.set(W2_AT);
    const week2 = await send(
      report({
        week: 2,
        status: "ended",
        topicTitle: "RAG の評価（終了）",
        answerMd: "2週目の答え",
      }),
    );
    expect(week2.status).toBe(200);
    expect(week2.json.replaced).toBe(false);

    const W1_AT = "2026-12-01T08:10:00.000+09:00";
    clock.set(W1_AT);
    const { status, json } = await send(
      report({
        week: 1,
        status: "active",
        topicTitle: "RAG の評価（送り直し）",
        answerMd: "送り直した1週目の答え",
      }),
    );

    expect(status).toBe(200);
    expect(json.replaced).toBe(true);
    expect(
      db
        .prepare(
          "SELECT topic_key, title, status, last_week, last_received_at FROM research_topic",
        )
        .all(),
    ).toEqual([
      {
        topic_key: "second-brain",
        title: "RAG の評価（終了）",
        status: "ended",
        last_week: 2,
        last_received_at: W2_AT,
      },
    ]);
    expect(
      count(
        "SELECT COUNT(*) AS n FROM research_report AS r JOIN research_topic AS t ON t.topic_id = r.topic_id WHERE t.topic_key = 'second-brain'",
      ),
    ).toBe(2);

    const w1 = reportContentId("second-brain", 1);
    expect(
      db
        .prepare(
          "SELECT status, answer_md FROM research_report WHERE content_id = ?",
        )
        .get(w1),
    ).toEqual({ status: "active", answer_md: "送り直した1週目の答え" });
    expect(
      db
        .prepare("SELECT title, received_at FROM content WHERE content_id = ?")
        .get(w1),
    ).toEqual({ title: "RAG の評価（送り直し）（1週目）", received_at: W1_AT });

    // 2週目の週報は変わらない。
    const w2 = reportContentId("second-brain", 2);
    expect(
      db
        .prepare(
          "SELECT status, answer_md FROM research_report WHERE content_id = ?",
        )
        .get(w2),
    ).toEqual({ status: "ended", answer_md: "2週目の答え" });
  });
});

describe("TC133 brain-research の鍵でないと通らない（DD-02 3章 P02、DD-04 3.1、BD-10 T02）", () => {
  const expectDenied = async (key: string | null, nth: number) => {
    const before = counts();
    const { status, json } = await send(report(), key);
    expect(status).toBe(401);
    expect(errorOf(json)).toEqual({
      code: "unauthorized",
      messageId: "MSG-032",
      message: formatMessage("MSG-032"),
    });
    expectNothingKept(before);
    const rows = rejectedDeliveries();
    expect(rows).toHaveLength(nth);
    expect(rows[nth - 1]).toEqual({
      sender: "brain-research",
      target_date: null,
      item_count: 0,
      rejection_reason: "MSG-032",
    });
  };

  it("TC133 brain-harness の鍵、sharpen の鍵、鍵なしは、どれも 401 と MSG-032。delivery に brain-research の rejected が3件", async () => {
    await expectDenied(KB, 1);
    await expectDenied(KS, 2);
    await expectDenied(null, 3);
    expect(
      count(
        "SELECT COUNT(*) AS n FROM delivery WHERE sender = 'brain-research' AND result = 'rejected'",
      ),
    ).toBe(3);
  });

  it("TC133 KR で postNewsBatch は 401 と MSG-032", async () => {
    const log = logger();
    const response = await postNewsBatch({
      logger: log,
      senderKeys: createSenderKeys({ db, clock }),
      ingest: createIngest({ db, clock, logger: log }),
    })(
      new Request(URL_BATCHES, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${KR}`,
        },
        body: JSON.stringify({
          source: "brain-collect",
          date: TODAY,
          items: [],
        }),
      }),
    );
    expect(response.status).toBe(401);
    expect(errorOf((await response.json()) as Record<string, unknown>)).toEqual(
      {
        code: "unauthorized",
        messageId: "MSG-032",
        message: formatMessage("MSG-032"),
      },
    );
    expect(counts().research).toBe(0);
  });
});

// 本文がちょうど bytes バイトになる週報（方法 15 件。各欄は上限の中に収める）。
function bodyOfBytes(bytes: number): string {
  const r = report({
    answerMd: "a",
    unknownsMd: "",
    changesMd: "a",
    approaches: Array.from({ length: 15 }, (_, i) => ({
      title: `方法 ${i + 1}`,
      howToMd: "a",
      sourceUrls: [] as string[],
      marks: [] as string[],
      counterMd: "a",
    })),
  });
  const size = () => Buffer.byteLength(JSON.stringify(r), "utf8");
  // 埋められる欄と、その上限（UTF-8 のバイト数）。
  const slots: { get: () => string; set: (v: string) => void; max: number }[] =
    [
      {
        get: () => r.answerMd,
        set: (v) => (r.answerMd = v),
        max: 4 * KIB,
      },
      {
        get: () => r.unknownsMd,
        set: (v) => (r.unknownsMd = v),
        max: 8 * KIB,
      },
      {
        get: () => r.changesMd,
        set: (v) => (r.changesMd = v),
        max: 8 * KIB,
      },
      ...r.approaches.flatMap((a) => [
        {
          get: () => a.howToMd,
          set: (v: string) => (a.howToMd = v),
          max: 8 * KIB,
        },
        {
          get: () => String(a.counterMd),
          set: (v: string) => (a.counterMd = v),
          max: 2 * KIB,
        },
      ]),
    ];
  const slack = () => slots.reduce((sum, s) => sum + s.max - s.get().length, 0);
  // 欄で埋めきれない分は、2,048 文字の出典の URL で埋める（方法ごとに 50 件まで）。
  let n = 0;
  while (bytes - size() > slack()) {
    const a = r.approaches[Math.floor(n / 50)];
    a.sourceUrls.push(urlOfLength(2048, n));
    n += 1;
  }
  for (const s of slots) {
    const need = bytes - size();
    if (need <= 0) break;
    s.set(s.get() + "a".repeat(Math.min(need, s.max - s.get().length)));
  }
  const text = JSON.stringify(r);
  if (Buffer.byteLength(text, "utf8") !== bytes) throw new Error("大きさ");
  return text;
}

describe("TC134 方法の数と全体の大きさの境界（DD-02 2章 入力チェック C10）", () => {
  it("TC134 方法 15 件は 200", async () => {
    const { status, json } = await send(
      report({ approaches: manyApproaches(15) }),
    );
    expect(status).toBe(200);
    expect(json.replaced).toBe(false);
    expect(storedApproaches(reportContentId("second-brain", 1))).toHaveLength(
      15,
    );
  });

  it("TC134 方法 16 件は 400 と MSG-034。何も残らない", async () => {
    const before = counts();
    const { status, json } = await send(
      report({ approaches: manyApproaches(16) }),
    );
    expect(status).toBe(400);
    expect(errorOf(json)).toEqual({
      code: "bad_request",
      messageId: "MSG-034",
      message: formatMessage("MSG-034"),
    });
    expectNothingKept(before);
    expect(rejectedDeliveries()).toMatchObject([
      {
        sender: "brain-research",
        item_count: 0,
        rejection_reason: "MSG-034",
      },
    ]);
  });

  it("TC134 全体が 256 KiB ちょうどは 200", async () => {
    const { status } = await send(bodyOfBytes(REPORT_MAX_BYTES));
    expect(status).toBe(200);
    expect(counts().report).toBe(1);
  });

  it("TC134 全体が 256 KiB＋1 バイトは 413 と MSG-034。何も残らない", async () => {
    const before = counts();
    const { status, json } = await send(bodyOfBytes(REPORT_MAX_BYTES + 1));
    expect(status).toBe(413);
    expect(errorOf(json)).toEqual({
      code: "payload_too_large",
      messageId: "MSG-034",
      message: formatMessage("MSG-034"),
    });
    expectNothingKept(before);
    expect(rejectedDeliveries()).toEqual([
      {
        sender: "brain-research",
        target_date: null,
        item_count: 0,
        rejection_reason: "MSG-034",
      },
    ]);
  });
});

// ---- TC135 ----

// MSG-033 の文から、差し込んだ項目の名前を取り出す。
function itemOf(message: string): string {
  const [head, tail] = formatMessage("MSG-033", { 項目: "\u0000" }).split(
    "\u0000",
  );
  expect(message.startsWith(head) && message.endsWith(tail), message).toBe(
    true,
  );
  return message.slice(head.length, message.length - tail.length);
}

// 方法の3件目（`approaches` の添字 2、3番目）を変えた週報。
const BROKEN = 2;
function withApproach(patch: Partial<Approach> | ((a: Approach) => void)) {
  const r = report();
  const a = r.approaches[BROKEN];
  if (typeof patch === "function") patch(a);
  else Object.assign(a, patch);
  return r;
}

const fiftyUrls = (extra = 0) =>
  Array.from({ length: 50 + extra }, (_, i) => urlOfLength(40, i));

type Field =
  | { top: string }
  // 方法の項目（外れた項目の名前に、方法の番号と項目の名前が入る）。
  | { approach: string };

const atLimit: [string, () => unknown][] = [
  ["topicId 64 文字", () => report({ topicId: "a".repeat(63) + "-" })],
  ["topicTitle 200 文字", () => report({ topicTitle: "課".repeat(200) })],
  ["方法の title 200 文字", () => withApproach({ title: "題".repeat(200) })],
  ["answerMd 4 KiB", () => report({ answerMd: textOfBytes(4 * KIB) })],
  ["howToMd 8 KiB", () => withApproach({ howToMd: textOfBytes(8 * KIB) })],
  ["counterMd 2 KiB", () => withApproach({ counterMd: textOfBytes(2 * KIB) })],
  ["unknownsMd 8 KiB", () => report({ unknownsMd: textOfBytes(8 * KIB) })],
  ["unknownsMd 空", () => report({ unknownsMd: "" })],
  ["changesMd 8 KiB", () => report({ changesMd: textOfBytes(8 * KIB) })],
  ["出典の URL 50 件", () => withApproach({ sourceUrls: fiftyUrls() })],
  [
    "出典の URL 1件 2,048 文字",
    () => withApproach({ sourceUrls: [urlOfLength(2048)] }),
  ],
  [
    "印 3 件",
    () => withApproach({ marks: ["added", "more_sources", "disputed"] }),
  ],
];

const broken: [string, () => unknown, Field][] = [
  [
    "topicId 65 文字",
    () => report({ topicId: "a".repeat(65) }),
    { top: "topicId" },
  ],
  [
    "topicId に大文字",
    () => report({ topicId: "Second-brain" }),
    { top: "topicId" },
  ],
  [
    "topicTitle 201 文字",
    () => report({ topicTitle: "課".repeat(201) }),
    { top: "topicTitle" },
  ],
  [
    "方法の title 201 文字",
    () => withApproach({ title: "題".repeat(201) }),
    { approach: "title" },
  ],
  [
    "answerMd 4 KiB＋1 バイト",
    () => report({ answerMd: textOfBytes(4 * KIB + 1) }),
    { top: "answerMd" },
  ],
  [
    "howToMd 8 KiB＋1 バイト",
    () => withApproach({ howToMd: textOfBytes(8 * KIB + 1) }),
    { approach: "howToMd" },
  ],
  [
    "counterMd 2 KiB＋1 バイト",
    () => withApproach({ counterMd: textOfBytes(2 * KIB + 1) }),
    { approach: "counterMd" },
  ],
  [
    "unknownsMd 8 KiB＋1 バイト",
    () => report({ unknownsMd: textOfBytes(8 * KIB + 1) }),
    { top: "unknownsMd" },
  ],
  [
    "changesMd 8 KiB＋1 バイト",
    () => report({ changesMd: textOfBytes(8 * KIB + 1) }),
    { top: "changesMd" },
  ],
  [
    "出典の URL 51 件",
    () => withApproach({ sourceUrls: fiftyUrls(1) }),
    { approach: "sourceUrls" },
  ],
  [
    "出典の URL 1件 2,049 文字",
    () => withApproach({ sourceUrls: [urlOfLength(2049)] }),
    { approach: "sourceUrls" },
  ],
  [
    "出典の URL の重なり",
    () =>
      withApproach({
        sourceUrls: [
          "https://example.com/research/same",
          "https://example.com/research/same",
        ],
      }),
    { approach: "sourceUrls" },
  ],
  [
    "javascript: の URL",
    () => withApproach({ sourceUrls: ["javascript:alert(1)"] }),
    { approach: "sourceUrls" },
  ],
  [
    "印の重なり",
    () => withApproach({ marks: ["added", "added"] }),
    { approach: "marks" },
  ],
  [
    "知らない印",
    () => withApproach({ marks: ["important"] }),
    { approach: "marks" },
  ],
  [
    "必須の項目 answerMd が無い",
    () => {
      const r: Partial<Report> = report();
      delete r.answerMd;
      return r;
    },
    { top: "answerMd" },
  ],
  [
    "方法の必須の項目 howToMd が無い",
    () =>
      withApproach((a) => {
        delete (a as Partial<Approach>).howToMd;
      }),
    { approach: "howToMd" },
  ],
];

describe("TC135 欄ごとの上限と形（DD-02 2章 入力チェック C10。Q-096 の答え）", () => {
  it.each(atLimit)("TC135 %s は 200", async (_label, body) => {
    const { status } = await send(body());
    expect(status).toBe(200);
    expect(counts().report).toBe(1);
  });

  it.each(broken)(
    "TC135 %s は 400 と MSG-033（外れた項目の名前。方法なら番号付き）。何も残らない",
    async (_label, body, field) => {
      const before = counts();
      const { status, json } = await send(body());

      expect(status).toBe(400);
      const error = errorOf(json);
      expect(error.code).toBe("bad_request");
      expect(error.messageId).toBe("MSG-033");
      const item = itemOf(error.message);
      if ("top" in field) {
        expect(item).toBe(field.top);
      } else {
        // 方法の番号は `approaches[番号]`（DD-02 FN-025 手順 4）。番号は添字（2）か、何番目（3）か。
        expect(item).toMatch(/approaches\[(\d+)\]/);
        expect(["2", "3"]).toContain(/approaches\[(\d+)\]/.exec(item)?.[1]);
        expect(item).toContain(field.approach);
      }
      expectNothingKept(before);
      expect(rejectedDeliveries()).toMatchObject([
        {
          sender: "brain-research",
          item_count: 0,
          rejection_reason: `MSG-033（項目: ${item}）`,
        },
      ]);
    },
  );

  it("TC135 JSON でない本文は 400 と MSG-033（項目「本文」）。何も残らない", async () => {
    const before = counts();
    const { status, json } = await send("{ これは JSON でない");
    expect(status).toBe(400);
    expect(errorOf(json)).toEqual({
      code: "bad_request",
      messageId: "MSG-033",
      message: formatMessage("MSG-033", { 項目: "本文" }),
    });
    expectNothingKept(before);
  });
});

describe("TC136 残す途中で失敗する（FN-025 異常系、DD-06 E08・E16）", () => {
  it("TC136 research_report を書くところで失敗すると 500 と MSG-046。research_topic、research_report、content、search_index は何も増えず、delivery に rejected が1件", async () => {
    db.exec(
      `CREATE TEMP TRIGGER fail_research_report BEFORE INSERT ON main.research_report
       BEGIN SELECT RAISE(ABORT, 'injected'); END`,
    );
    const before = counts();
    const { status, json } = await send(report());

    expect(status).toBe(500);
    expect(errorOf(json)).toEqual({
      code: "internal",
      messageId: "MSG-046",
      message: formatMessage("MSG-046", { 理由: "予期しない失敗" }),
    });
    expectNothingKept(before);
    expect(rejectedDeliveries()).toEqual([
      {
        sender: "brain-research",
        target_date: TODAY,
        item_count: 0,
        rejection_reason: "MSG-046（理由: 予期しない失敗）",
      },
    ]);
    expect(
      logLines().filter(
        (line) =>
          line.msg === "MSG-046" &&
          line.level === "error" &&
          line.target === "FN-025",
      ),
    ).toHaveLength(1);
  });
});

describe("TC137 同じ課題の同じ週を2つの接続から同時に送る（DD-05 3章 ENT-014・ENT-015）", () => {
  it("TC137 両方 200。その課題の research_topic は1行、その週の research_report は1行で、後に確定した送信の値", async () => {
    const WORKER = new URL("./05-ingest-research-worker.ts", import.meta.url);
    const parties = 2;
    const barrier = new SharedArrayBuffer(4);
    const senders = [
      { now: "2026-12-01T08:00:01.000+09:00", answerMd: "接続 1 の答え" },
      { now: "2026-12-01T08:00:02.000+09:00", answerMd: "接続 2 の答え" },
    ];
    const results = await Promise.all(
      senders.map(
        ({ now, answerMd }) =>
          new Promise<{ status: number; json: Record<string, unknown> }>(
            (resolve, reject) => {
              const worker = new Worker(WORKER, {
                workerData: {
                  path: dbPath,
                  logDir,
                  now,
                  key: KR,
                  body: JSON.stringify(report({ answerMd })),
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
      expect(result.json.topicId).toBe("second-brain");
      expect(result.json.week).toBe(1);
    }
    expect(results.map((r) => r.json.replaced).sort()).toEqual([false, true]);

    expect(
      count(
        "SELECT COUNT(*) AS n FROM research_topic WHERE topic_key = 'second-brain'",
      ),
    ).toBe(1);
    const rows = db
      .prepare(
        `SELECT r.content_id, r.answer_md, c.received_at, c.delivery_id
         FROM research_report AS r
         JOIN research_topic AS t ON t.topic_id = r.topic_id
         JOIN content AS c ON c.content_id = r.content_id
         WHERE t.topic_key = 'second-brain' AND r.week = 1`,
      )
      .all();
    expect(rows).toHaveLength(1);
    expect(counts().research).toBe(1);

    // 後に確定した送信は、受け取りの記録の ID が大きい方。
    const last = db
      .prepare(
        "SELECT delivery_id, received_at FROM delivery WHERE result = 'accepted' AND sender = 'brain-research' ORDER BY delivery_id DESC LIMIT 1",
      )
      .get();
    const lastSender = senders.find(({ now }) => now === last?.received_at);
    expect(lastSender).toBeDefined();
    expect(rows[0]).toMatchObject({
      answer_md: lastSender?.answerMd,
      received_at: last?.received_at,
      delivery_id: last?.delivery_id,
    });
    expect(
      db.prepare("SELECT last_received_at FROM research_topic").get(),
    ).toEqual({ last_received_at: last?.received_at });
    expect(
      count(
        "SELECT COUNT(*) AS n FROM delivery WHERE result = 'accepted' AND sender = 'brain-research'",
      ),
    ).toBe(2);
    expect(
      count(
        "SELECT COUNT(*) AS n FROM search_index WHERE content_id = ?",
        Number(rows[0].content_id),
      ),
    ).toBe(1);
  });
});

// ---- TC102（定義ファイル） ----

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

// 形だけを比べる（説明の文は比べない）。
function shapeOf(value: Json): Json {
  if (Array.isArray(value)) return value.map(shapeOf);
  if (value === null || typeof value !== "object") return value;
  const result: { [key: string]: Json } = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === "description" || key === "summary") continue;
    result[key] = shapeOf(item);
  }
  return result;
}

describe("TC102 openapi.yaml の postResearchReport と schema が DD-04 の定義どおり（DD-04 1章、CR-021）", () => {
  const read = (path: string) =>
    parseYaml(readFileSync(join(__dirname, path), "utf8")) as {
      [key: string]: Json;
    };
  const openapi = read("../docs/api/openapi.yaml");
  const expected = read("./fixtures/research-report-openapi.yaml");

  it("TC102 /api/research/reports の post が postResearchReport で、求めと応答が DD-04 の定義どおり", () => {
    const paths = openapi.paths as { [key: string]: Json };
    const want = expected.paths as { [key: string]: Json };
    expect(shapeOf(paths["/api/research/reports"])).toEqual(
      shapeOf(want["/api/research/reports"]),
    );
  });

  it.each([
    "ResearchReportPayload",
    "ApproachPayload",
    "ResearchReportResult",
    "ResearchStatus",
    "ApproachMark",
  ])("TC102 schema %s が DD-04 の定義どおり", (name) => {
    const schemas = (openapi.components as { [key: string]: Json }).schemas as {
      [key: string]: Json;
    };
    const want = expected.schemas as { [key: string]: Json };
    expect(schemas[name]).toBeDefined();
    expect(shapeOf(schemas[name])).toEqual(shapeOf(want[name]));
  });
});
