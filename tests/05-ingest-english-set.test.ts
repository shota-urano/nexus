import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { postEnglishSet } from "../src/app/api/_entry/english-set";
import { createSenderKeys } from "../src/server/auth/sender-key";
import { type Database, openDatabase } from "../src/server/db/connection";
import { createIngest } from "../src/server/ingest";
import { ENGLISH_SET_MAX_BYTES } from "../src/server/kinds/english/ingest";
import { createFakeClock } from "../src/server/shared/clock";
import { createLogger } from "../src/server/shared/logger";
import { formatMessage } from "../src/server/shared/messages";
import { NOW, insertD1News, migrate } from "./fixtures/news";

// 05-ingest の実装単位2: 英語のセットの受け取り `postEnglishSet`（M16 の形の確かめと置き換え）。
// FN-007、IF-002、DD-01 M13、DD-01 M16、DD-02 FN-007。
// 受け入れ基準は TC30〜TC34、TC119、TC121。

const URL_SETS = "http://127.0.0.1:48400/api/learning/sets";
const DATE = "2026-12-02";

let dir: string;
let dbPath: string;
let logDir: string;
let db: Database;
let KB: string;
let KS: string;
const clock = createFakeClock(NOW);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-english-"));
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

function handler() {
  const logger = createLogger({ process: "web", clock, dir: logDir });
  return postEnglishSet({
    logger,
    senderKeys: createSenderKeys({ db, clock }),
    ingest: createIngest({ db, clock, logger }),
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

type Problem = Record<string, unknown>;

function problems(count: number): Problem[] {
  return Array.from({ length: count }, (_, i) => ({
    no: i + 1,
    kind: i % 3 === 0 ? "code" : "quiz",
    questionMd: `問題 ${i + 1}`,
    answerMd: `解答 ${i + 1}`,
  }));
}

const reading = {
  date: DATE,
  format: "story",
  title: "A Morning Walk",
  scene: "park",
  summary: "朝の散歩",
  paragraphs: [
    {
      sentences: [
        {
          en: "I walk in the park.",
          ja: "私は公園を歩く。",
          notes: [{ text: "walk", kind: "verb", ja: "歩く" }],
        },
      ],
    },
  ],
};

function englishSet(overrides: Record<string, unknown> = {}) {
  return {
    date: DATE,
    lane: "en",
    theme: "現在形の使い方",
    source: "theme",
    lessonMd: "# 現在形\n\n習慣を表す。",
    problems: [
      ...problems(3),
      {
        no: 4,
        questionMd: "正しいものを選ぶ",
        answerMd: "b",
        answerType: "choice",
        expected: "b",
        choices: ["a", "b", "c"],
      },
      {
        no: 5,
        questionMd: "数を答える",
        answerMd: "12.5",
        answerType: "number",
        expected: "12.5",
      },
      {
        no: 6,
        questionMd: "語を書く",
        answerMd: "walk",
        answerType: "text",
        expected: "walk",
      },
    ],
    closingMd: "また明日。",
    read: reading,
    ...overrides,
  };
}

async function send(
  body: unknown,
  key: string | null = KS,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (key !== null) headers.authorization = `Bearer ${key}`;
  const response = await handler()(
    new Request(URL_SETS, {
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
  english: count("SELECT COUNT(*) AS n FROM content WHERE kind = 'english'"),
  englishSet: count("SELECT COUNT(*) AS n FROM english_set"),
  delivery: count("SELECT COUNT(*) AS n FROM delivery"),
  searchIndex: count("SELECT COUNT(*) AS n FROM search_index"),
  aiRun: count("SELECT COUNT(*) AS n FROM ai_run"),
});

const englishRow = (date: string = DATE) =>
  db
    .prepare(
      `SELECT c.content_id, c.title, c.received_at, c.delivery_id,
              s.learning_theme, s.lesson_body_md, s.closing_md, s.problems_json,
              s.reading_json, s.raw_payload_json
       FROM content AS c JOIN english_set AS s ON s.content_id = c.content_id
       WHERE c.kind = 'english' AND c.target_date = ?`,
    )
    .all(date);

const rejectedDeliveries = () =>
  db
    .prepare(
      "SELECT sender, target_date, item_count, rejection_reason FROM delivery WHERE result = 'rejected' ORDER BY delivery_id",
    )
    .all();

const errorOf = (json: Record<string, unknown>) =>
  json.error as { code: string; message: string; messageId: string };

describe("TC30 2026-12-02 のセットを受け取る（FN-007、DD-02 FN-007 手順 4）", () => {
  it("TC30 200。content（english）と english_set が1行。raw_payload_json は送った本文と同じ。delivery に accepted が1件", async () => {
    const before = counts();
    const text = JSON.stringify(englishSet(), null, 2);
    const { status, json } = await send(text);

    expect(status).toBe(200);
    expect(json).toEqual({ date: DATE, receivedAt: NOW });
    const after = counts();
    expect(after.english - before.english).toBe(1);
    expect(after.englishSet - before.englishSet).toBe(1);
    expect(after.searchIndex - before.searchIndex).toBe(1);
    // 記事の関係の判定は入れない。
    expect(after.aiRun).toBe(before.aiRun);

    const rows = englishRow();
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.title).toBe("現在形の使い方");
    expect(row.learning_theme).toBe("現在形の使い方");
    expect(row.lesson_body_md).toBe("# 現在形\n\n習慣を表す。");
    expect(row.closing_md).toBe("また明日。");
    expect(row.received_at).toBe(NOW);
    expect(row.raw_payload_json).toBe(text);
    expect(JSON.parse(String(row.reading_json))).toEqual(reading);

    const deliveries = db
      .prepare(
        "SELECT delivery_id, sender, target_date, received_at, item_count, result FROM delivery WHERE sender = 'sharpen'",
      )
      .all();
    expect(deliveries).toEqual([
      {
        delivery_id: row.delivery_id,
        sender: "sharpen",
        target_date: DATE,
        received_at: NOW,
        item_count: 1,
        result: "accepted",
      },
    ]);
    expect(
      logLines().filter(
        (line) => line.msg === "MSG-031" && line.target === "FN-007",
      ),
    ).toHaveLength(1);
  });

  it("TC30 検索の索引は学習テーマと教材の本文を改行でつなぎ、NFKC で正規化して小文字にする（DD-02 3章 P08）", async () => {
    await send(englishSet({ theme: "Ｐresent", lessonMd: "ＡＢＣ Lesson" }));
    const [row] = englishRow();
    const index = db
      .prepare("SELECT body FROM search_index WHERE content_id = ?")
      .get(Number(row.content_id));
    expect(index?.body).toBe("present\nabc lesson");
  });

  it("TC30 `today` は日本時間の今日の日付にし、原文は書き換えない（DD-02 FN-007 手順 3、4.3）", async () => {
    const text = JSON.stringify(englishSet({ date: "today" }));
    const { status, json } = await send(text);
    expect(status).toBe(200);
    expect(json.date).toBe("2026-12-01");
    const rows = englishRow("2026-12-01");
    expect(rows).toHaveLength(1);
    expect(rows[0].raw_payload_json).toBe(text);
  });
});

describe("TC31 同じ日付で読む教材の無いセットを送ると置き換える（FN-007 業務ルール）", () => {
  it("TC31 content は1行のまま（同じ content_id）。reading_json は空。english_answer と content_state は残る", async () => {
    expect((await send(englishSet())).status).toBe(200);
    const [first] = englishRow();
    const contentId = Number(first.content_id);
    // そのセットに答えがある。
    db.prepare(
      "INSERT INTO english_answer (content_id, answers_json, completed_at) VALUES (?, ?, ?)",
    ).run(
      contentId,
      JSON.stringify([{ no: 1, grade: "o", answer: "a" }]),
      "2026-12-01T07:30:00.000+09:00",
    );
    db.prepare(
      "INSERT INTO content_state (content_id, is_read, read_at, is_saved) VALUES (?, 1, ?, 0)",
    ).run(contentId, "2026-12-01T07:30:00.000+09:00");

    clock.set("2026-12-01T09:00:00.000+09:00");
    const withoutRead: Record<string, unknown> = {
      ...englishSet({
        theme: "過去形の使い方",
        lessonMd: "# 過去形",
        problems: problems(2),
        closingMd: null,
      }),
    };
    delete withoutRead.read;
    const { status, json } = await send(withoutRead);

    expect(status).toBe(200);
    expect(json.receivedAt).toBe("2026-12-01T09:00:00.000+09:00");
    const rows = englishRow();
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.content_id).toBe(contentId);
    expect(row.title).toBe("過去形の使い方");
    expect(row.learning_theme).toBe("過去形の使い方");
    expect(row.lesson_body_md).toBe("# 過去形");
    expect(row.closing_md).toBeNull();
    expect(row.reading_json).toBeNull();
    expect(JSON.parse(String(row.problems_json))).toHaveLength(2);
    expect(row.received_at).toBe("2026-12-01T09:00:00.000+09:00");
    const lastDelivery = db
      .prepare(
        "SELECT MAX(delivery_id) AS id FROM delivery WHERE sender = 'sharpen' AND result = 'accepted'",
      )
      .get();
    expect(row.delivery_id).toBe(lastDelivery?.id);
    expect(row.delivery_id).not.toBe(first.delivery_id);

    expect(
      db
        .prepare(
          "SELECT answers_json, completed_at FROM english_answer WHERE content_id = ?",
        )
        .get(contentId),
    ).toEqual({
      answers_json: JSON.stringify([{ no: 1, grade: "o", answer: "a" }]),
      completed_at: "2026-12-01T07:30:00.000+09:00",
    });
    expect(
      db
        .prepare("SELECT is_read FROM content_state WHERE content_id = ?")
        .get(contentId),
    ).toEqual({ is_read: 1 });
    expect(
      count(
        "SELECT COUNT(*) AS n FROM search_index WHERE content_id = ?",
        contentId,
      ),
    ).toBe(1);
    expect(
      count(
        "SELECT COUNT(*) AS n FROM delivery WHERE sender = 'sharpen' AND result = 'accepted'",
      ),
    ).toBe(2);
  });
});

describe("TC32 データの状態によるチェック（FN-007、DD-06 E01）", () => {
  const withProblem = (index: number, patch: Problem) => {
    const set = englishSet();
    const list = set.problems as Problem[];
    list[index] = { ...list[index], ...patch };
    return set;
  };

  const cases: [string, unknown, string][] = [
    ["問題番号の重なり", withProblem(1, { no: 1 }), "no"],
    [
      "choice の expected が選択肢に無い",
      withProblem(3, { expected: "z" }),
      "choices",
    ],
    [
      "number の expected が数でない",
      withProblem(4, { expected: "twelve" }),
      "expected",
    ],
    ["問題 61 問", englishSet({ problems: problems(61) }), "problems"],
    ["lane が main", englishSet({ lane: "main" }), "lane"],
  ];

  it.each(cases)(
    "TC32 %s は 400 と MSG-033（項目「%s」）。何も残らない",
    async (_label, body, field) => {
      const before = counts();
      const { status, json } = await send(body);

      expect(status).toBe(400);
      expect(errorOf(json)).toEqual({
        code: "bad_request",
        messageId: "MSG-033",
        message: formatMessage("MSG-033", { 項目: field }),
      });
      const after = counts();
      expect(after.english).toBe(before.english);
      expect(after.englishSet).toBe(before.englishSet);
      expect(after.searchIndex).toBe(before.searchIndex);
      expect(rejectedDeliveries()).toEqual([
        {
          sender: "sharpen",
          target_date: DATE,
          item_count: 0,
          rejection_reason: `MSG-033（項目: ${field}）`,
        },
      ]);
    },
  );

  it("TC32 問題 60 問は受け取る（BD-06 IF-002 3.2）", async () => {
    const { status } = await send(englishSet({ problems: problems(60) }));
    expect(status).toBe(200);
  });

  const moreCases: [string, unknown, string][] = [
    ["lane が無い", englishSet({ lane: undefined }), "lane"],
    ["問題が 0 問", englishSet({ problems: [] }), "problems"],
    [
      "answerType があって expected が無い",
      withProblem(5, { expected: undefined }),
      "expected",
    ],
    ["choice の選択肢が1件", withProblem(3, { choices: ["b"] }), "choices"],
    [
      "choice の選択肢が7件",
      withProblem(3, { choices: ["a", "b", "c", "d", "e", "f", "g"] }),
      "choices",
    ],
    [
      "choice の選択肢が重なる",
      withProblem(3, { choices: ["a", "b", "b"] }),
      "choices",
    ],
    [
      "choice でない問題に選択肢がある",
      withProblem(5, { choices: ["walk", "run"] }),
      "choices",
    ],
    [
      "読む教材の文の形が正しくない",
      englishSet({
        read: { ...reading, paragraphs: [{ sentences: [{ en: "x" }] }] },
      }),
      "ja",
    ],
    ["theme が空", englishSet({ theme: "" }), "theme"],
    ["存在しない日付", englishSet({ date: "2026-13-01" }), "date"],
  ];

  it.each(moreCases)(
    "TC32 %s も 400 と MSG-033（項目「%s」。BD-02 FN-007）",
    async (_label, body, field) => {
      const before = counts();
      const { status, json } = await send(body);
      expect(status).toBe(400);
      expect(errorOf(json).message).toBe(
        formatMessage("MSG-033", { 項目: field }),
      );
      expect(counts().english).toBe(before.english);
    },
  );

  it("TC32 number の expected は前後の空白を除いた十進の数なら受け取る（DD-02 FN-011 の読み方）", async () => {
    const { status } = await send(withProblem(4, { expected: " -0.50 " }));
    expect(status).toBe(200);
  });

  it("TC32 JSON でない本文は 400 と MSG-033（項目「本文」）。delivery に sharpen の rejected が1件", async () => {
    const { status, json } = await send("{not json");
    expect(status).toBe(400);
    expect(errorOf(json).message).toBe(
      formatMessage("MSG-033", { 項目: "本文" }),
    );
    expect(rejectedDeliveries()).toEqual([
      {
        sender: "sharpen",
        target_date: null,
        item_count: 0,
        rejection_reason: "MSG-033（項目: 本文）",
      },
    ]);
  });
});

// 本文がちょうど bytes バイトになる送信の文。
function bodyOfBytes(bytes: number): string {
  const set = englishSet();
  const base = Buffer.byteLength(JSON.stringify(set));
  set.lessonMd += "a".repeat(bytes - base);
  const text = JSON.stringify(set);
  if (Buffer.byteLength(text) !== bytes) throw new Error("大きさが違う");
  return text;
}

describe("TC33 本文の大きさの境界（BD-06 IF-002 3.2）", () => {
  it("TC33 256 KiB ちょうどは 200", async () => {
    expect(ENGLISH_SET_MAX_BYTES).toBe(262_144);
    const { status } = await send(bodyOfBytes(ENGLISH_SET_MAX_BYTES));
    expect(status).toBe(200);
    expect(englishRow()).toHaveLength(1);
  });

  it("TC33 256 KiB + 1 バイトは 413 と MSG-034 で、何も残らない", async () => {
    const before = counts();
    const { status, json } = await send(bodyOfBytes(ENGLISH_SET_MAX_BYTES + 1));

    expect(status).toBe(413);
    expect(errorOf(json)).toEqual({
      code: "payload_too_large",
      messageId: "MSG-034",
      message: formatMessage("MSG-034"),
    });
    const after = counts();
    expect(after.english).toBe(before.english);
    expect(after.englishSet).toBe(before.englishSet);
    expect(rejectedDeliveries()).toEqual([
      {
        sender: "sharpen",
        target_date: null,
        item_count: 0,
        rejection_reason: "MSG-034",
      },
    ]);
  });
});

describe("TC34 鍵が通らない（FN-007 異常系、DD-02 3章 P02、DD-06 E03）", () => {
  it("TC34 brain-harness の鍵 KB は 401 と MSG-032。何も残らない", async () => {
    const before = counts();
    const { status, json } = await send(englishSet(), KB);

    expect(status).toBe(401);
    expect(errorOf(json)).toEqual({
      code: "unauthorized",
      messageId: "MSG-032",
      message: formatMessage("MSG-032"),
    });
    const after = counts();
    expect(after.english).toBe(before.english);
    expect(after.englishSet).toBe(before.englishSet);
    expect(rejectedDeliveries()).toEqual([
      {
        sender: "sharpen",
        target_date: null,
        item_count: 0,
        rejection_reason: "MSG-032",
      },
    ]);
  });

  it("TC34 鍵なしと取り消した鍵も 401 と MSG-032", async () => {
    expect((await send(englishSet(), null)).status).toBe(401);
    createSenderKeys({ db, clock }).revoke("sharpen");
    expect((await send(englishSet(), KS)).status).toBe(401);
    expect(rejectedDeliveries()).toHaveLength(2);
  });
});

describe("TC119 問題の kind の無いセット（DD-02 FN-007 手順 4.3、BD-06 IF-002 3.2）", () => {
  it("TC119 200。problems_json の問題は kind が quiz。raw_payload_json の問題には kind が無い", async () => {
    const list = problems(3).map((problem) => {
      const rest: Record<string, unknown> = { ...problem };
      delete rest.kind;
      return rest;
    });
    const { status } = await send(englishSet({ problems: list }));

    expect(status).toBe(200);
    const [row] = englishRow();
    const stored = JSON.parse(String(row.problems_json)) as Problem[];
    expect(stored.map((problem) => problem.kind)).toEqual([
      "quiz",
      "quiz",
      "quiz",
    ]);
    expect(stored[0]).toEqual({ ...list[0], kind: "quiz" });
    const raw = JSON.parse(String(row.raw_payload_json)) as {
      problems: Problem[];
    };
    for (const problem of raw.problems) {
      expect(problem).not.toHaveProperty("kind");
    }
  });

  it("TC119 kind のある問題は届いた値のまま残す", async () => {
    await send(englishSet({ problems: problems(4) }));
    const [row] = englishRow();
    const stored = JSON.parse(String(row.problems_json)) as Problem[];
    expect(stored.map((problem) => problem.kind)).toEqual([
      "code",
      "quiz",
      "quiz",
      "code",
    ]);
  });
});

describe("TC121 同じ日付のセットを2つの接続から同時に送る（DD-05 3章 ENT-001・ENT-003）", () => {
  it("TC121 両方 200。その日付の英語の content は1行だけで、後に確定した送信の値", async () => {
    const WORKER = new URL("./05-ingest-news-worker.ts", import.meta.url);
    const parties = 2;
    const barrier = new SharedArrayBuffer(4);
    const senders = [
      { now: "2026-12-01T08:00:01.000+09:00", theme: "接続 1 のテーマ" },
      { now: "2026-12-01T08:00:02.000+09:00", theme: "接続 2 のテーマ" },
    ];
    const results = await Promise.all(
      senders.map(
        ({ now, theme }) =>
          new Promise<{ status: number; json: Record<string, unknown> }>(
            (resolve, reject) => {
              const worker = new Worker(WORKER, {
                workerData: {
                  path: dbPath,
                  logDir,
                  now,
                  key: KS,
                  body: JSON.stringify(englishSet({ theme })),
                  barrier,
                  parties,
                  entry: "english",
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
      expect(result.json.date).toBe(DATE);
    }
    const rows = englishRow();
    expect(rows).toHaveLength(1);

    const last = db
      .prepare(
        "SELECT delivery_id, received_at FROM delivery WHERE sender = 'sharpen' AND result = 'accepted' ORDER BY delivery_id DESC LIMIT 1",
      )
      .get();
    const lastSender = senders.find(({ now }) => now === last?.received_at);
    expect(lastSender).toBeDefined();
    expect(rows[0].title).toBe(lastSender?.theme);
    expect(rows[0].learning_theme).toBe(lastSender?.theme);
    expect(rows[0].delivery_id).toBe(last?.delivery_id);
    expect(
      count(
        "SELECT COUNT(*) AS n FROM delivery WHERE sender = 'sharpen' AND result = 'accepted'",
      ),
    ).toBe(2);
  });
});
