import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { markOpened } from "../src/app/api/_entry/content-state";
import { createDeviceApiContext } from "../src/app/api/_entry/device-api";
import {
  type EnglishLearningApiContext,
  getEnglishSet,
  listEnglishSets,
  putEnglishAnswer,
} from "../src/app/api/_entry/english-learning";
import { createDeviceKeyVerifier } from "../src/server/auth/device-key";
import { createContents } from "../src/server/contents";
import {
  type Database,
  databasePath,
  openDatabase,
} from "../src/server/db/connection";
import { createIngest } from "../src/server/ingest";
import { ENGLISH_KIND } from "../src/server/kinds/english/ingest";
import {
  type EnglishLearning,
  createEnglishLearning,
} from "../src/server/kinds/english/learning";
import { createFakeClock, type FakeClock } from "../src/server/shared/clock";
import { NexusError } from "../src/server/shared/errors";
import { createLogger, type Logger } from "../src/server/shared/logger";
import { type MessageId, formatMessage } from "../src/server/shared/messages";
import { createSecret, hashSecret } from "../src/server/shared/secret";
import { NOW, insertD1News, migrate } from "./fixtures/news";

// 09-english の実装単位1: `listEnglishSets`、`getEnglishSet`、`putEnglishAnswer`（DD-01 M16、M11）。
// FN-008、FN-009、FN-012、DD-02 FN-009・FN-012、3章 P03、P04。受け入れ基準は TC38、TC40、TC45、TC46。

const ORIGIN = "http://localhost:48401";
const BASE = `${ORIGIN}/api/app/english/sets`;

const E1_DATE = "2026-12-01";
const E2_DATE = "2026-11-30";
const E3_DATE = "2026-11-29";
const E2_RECEIVED_AT = "2026-11-30T06:00:00.000+09:00";
const E3_RECEIVED_AT = "2026-11-29T06:00:00.000+09:00";
const E2_COMPLETED_AT = "2026-11-30T21:15:00.000+09:00";
const E2_GRADES = [
  { no: 1, grade: "o", answer: "b" },
  { no: 2, grade: "d", answer: "walks" },
  { no: 3, grade: "x" },
];

const reading = (date: string) => ({
  date,
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
});

// D1 の英語のセット（DD-10 3章）: 問題 3 問（choice、text、answerType なし）。
function englishSet(date: string, theme: string, withReading: boolean) {
  return {
    date,
    lane: "en",
    theme,
    source: "theme",
    lessonMd: "# 現在形\n\n習慣を表す。\n\n## 読む\n\n下の英文を読む。",
    problems: [
      {
        no: 1,
        questionMd: "正しいものを選ぶ",
        answerMd: "b",
        answerType: "choice",
        expected: "b",
        choices: ["a", "b", "c"],
      },
      {
        no: 2,
        questionMd: "語を書く",
        answerMd: "walk",
        answerType: "text",
        expected: "walk",
      },
      { no: 3, questionMd: "訳す", answerMd: "私は歩く。" },
    ],
    closingMd: "また明日。",
    ...(withReading ? { read: reading(date) } : {}),
  };
}

let dir: string;
let db: Database;
let clock: FakeClock;
let logger: Logger;
let K1: string;
let A1: number;
let E1: number;
let E2: number;
let E3: number;
let context: EnglishLearningApiContext;

function englishContentId(date: string): number {
  const row = db
    .prepare(
      "SELECT content_id FROM content WHERE kind = 'english' AND target_date = ?",
    )
    .get(date);
  return Number(row?.content_id);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-09-english-"));
  clock = createFakeClock(NOW);
  db = openDatabase(databasePath(dir));
  migrate(db);
  ({ A1 } = insertD1News(db));
  K1 = createSecret();
  db.prepare(
    "INSERT INTO device (device_name, device_key_hash, registered_at, last_used_at) VALUES ('ipad', ?, ?, ?)",
  ).run(hashSecret(K1), "2026-11-20T09:00:00.000+09:00", NOW);
  logger = createLogger({ process: "web", clock, dir: join(dir, "logs") });
  const ingest = createIngest({ db, clock, logger });
  const receive = (set: Record<string, unknown>) =>
    expect(
      ingest.receive("sharpen", ENGLISH_KIND, set, JSON.stringify(set)).ok,
    ).toBe(true);

  // TC38 の3件目（未完了）。
  clock.set(E3_RECEIVED_AT);
  receive(englishSet(E3_DATE, "過去形", false));
  // E2（2026-11-30、完了済み。TC40 のため読む教材つき）。
  clock.set(E2_RECEIVED_AT);
  receive(englishSet(E2_DATE, "進行形", true));
  // E1（2026-12-01、未完了、読む教材あり）。
  clock.set(NOW);
  receive(englishSet(E1_DATE, "現在形の使い方", true));
  E1 = englishContentId(E1_DATE);
  E2 = englishContentId(E2_DATE);
  E3 = englishContentId(E3_DATE);
  db.prepare(
    "INSERT INTO english_answer (content_id, answers_json, completed_at) VALUES (?, ?, ?)",
  ).run(E2, JSON.stringify(E2_GRADES), E2_COMPLETED_AT);

  context = {
    deviceApi: createDeviceApiContext({
      clock,
      logger,
      origin: ORIGIN,
      deviceKeys: createDeviceKeyVerifier({ db, clock }),
    }),
    english: createEnglishLearning({ db, clock }),
  };
});

afterEach(() => {
  if (db.isOpen) db.close();
  rmSync(dir, { recursive: true, force: true });
});

const route = (contentId: number | string) => ({
  params: Promise.resolve({ contentId: String(contentId) }),
});

function headers(origin: string | null = ORIGIN): Headers {
  const result = new Headers({ cookie: `nexus_device=${K1}` });
  if (origin !== null) result.set("origin", origin);
  return result;
}

function callList(query = ""): Promise<Response> {
  return listEnglishSets(context)(
    new Request(`${BASE}${query}`, { headers: headers(null) }),
  );
}

function callGet(contentId: number | string): Promise<Response> {
  return getEnglishSet(context)(
    new Request(`${BASE}/${contentId}`, { headers: headers(null) }),
    route(contentId),
  );
}

function callPut(
  contentId: number | string,
  body: unknown,
  init: { origin?: string | null; api?: EnglishLearningApiContext } = {},
): Promise<Response> {
  const h = headers(init.origin === undefined ? ORIGIN : init.origin);
  h.set("content-type", "application/json");
  return putEnglishAnswer(init.api ?? context)(
    new Request(`${BASE}/${contentId}/answer`, {
      method: "PUT",
      headers: h,
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    route(contentId),
  );
}

function errorBody(code: string, id: MessageId) {
  return { error: { code, message: formatMessage(id), messageId: id } };
}

interface AnswerRow {
  answers_json: string;
  completed_at: string;
}

function answerRow(contentId: number): AnswerRow | undefined {
  return db
    .prepare(
      "SELECT answers_json, completed_at FROM english_answer WHERE content_id = ?",
    )
    .get(contentId) as AnswerRow | undefined;
}

function stateRow(contentId: number) {
  return db
    .prepare(
      "SELECT opened_at, is_read, read_at, is_saved, saved_at FROM content_state WHERE content_id = ?",
    )
    .get(contentId) as
    | {
        opened_at: string | null;
        is_read: number;
        read_at: string | null;
        is_saved: number;
        saved_at: string | null;
      }
    | undefined;
}

const E1_ALL_GRADES = [
  { no: 1, grade: "o", answer: "b" },
  { no: 2, grade: "x", answer: "run" },
  { no: 3, grade: "d", answer: "私は走る。" },
];

describe("TC38 listEnglishSets を limit 2 で、続けて nextCursor で（FN-008、DD-02 3章 P03）", () => {
  it("1ページ目は新しい順の2件と nextCursor。2ページ目は残りの1件と nextCursor null。完了した1件の isCompleted が真", async () => {
    const first = await callList("?limit=2");
    expect(first.status).toBe(200);
    const page1 = (await first.json()) as {
      items: Record<string, unknown>[];
      nextCursor: string | null;
    };
    expect(page1.items).toEqual([
      {
        contentId: E1,
        learningTheme: "現在形の使い方",
        targetDate: E1_DATE,
        receivedAt: NOW,
        isNew: true,
        isRead: false,
        isSaved: false,
        isCompleted: false,
      },
      {
        contentId: E2,
        learningTheme: "進行形",
        targetDate: E2_DATE,
        receivedAt: E2_RECEIVED_AT,
        isNew: true,
        isRead: false,
        isSaved: false,
        isCompleted: true,
      },
    ]);
    expect(typeof page1.nextCursor).toBe("string");

    const second = await callList(
      `?limit=2&cursor=${encodeURIComponent(page1.nextCursor ?? "")}`,
    );
    expect(second.status).toBe(200);
    const page2 = (await second.json()) as {
      items: Record<string, unknown>[];
      nextCursor: string | null;
    };
    expect(page2.items.map((item) => item.contentId)).toEqual([E3]);
    expect(page2.items[0]).toMatchObject({
      targetDate: E3_DATE,
      isCompleted: false,
    });
    expect(page2.nextCursor).toBeNull();
  });

  it("英語でない内容（ニュース）は出ない。limit を省くと全てを1ページで返す", async () => {
    const response = await callList();
    const page = (await response.json()) as {
      items: { contentId: number }[];
      nextCursor: string | null;
    };
    expect(page.items.map((item) => item.contentId)).toEqual([E1, E2, E3]);
    expect(page.nextCursor).toBeNull();
  });

  it("開いた、既読、保存の状態を返す", async () => {
    db.prepare(
      "INSERT INTO content_state (content_id, opened_at, is_read, read_at, is_saved, saved_at) VALUES (?, ?, 1, ?, 1, ?)",
    ).run(E1, NOW, NOW, NOW);
    const page = (await (await callList("?limit=1")).json()) as {
      items: Record<string, unknown>[];
    };
    expect(page.items[0]).toMatchObject({
      contentId: E1,
      isNew: false,
      isRead: true,
      isSaved: true,
    });
  });

  it("cursor が戻せないか limit が 1〜50 でなければ 400 と MSG-019", async () => {
    for (const query of ["?cursor=***", "?limit=0", "?limit=51", "?limit=a"]) {
      const response = await callList(query);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual(
        errorBody("bad_request", "MSG-019"),
      );
    }
  });
});

describe("TC40 getEnglishSet（E2）の後に markOpened（FN-009、DD-02 FN-009）", () => {
  it("reading と lastAnswer がある。opened_at が入る", async () => {
    const response = await callGet(E2);
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toEqual({
      contentId: E2,
      learningTheme: "進行形",
      targetDate: E2_DATE,
      // サーバは本文を変えずに返す（DD-02 FN-009 手順 5）。
      lessonMd: "# 現在形\n\n習慣を表す。\n\n## 読む\n\n下の英文を読む。",
      problems: englishSet(E2_DATE, "進行形", true).problems.map((problem) => ({
        ...problem,
        kind: "quiz",
      })),
      closingMd: "また明日。",
      reading: reading(E2_DATE),
      state: {
        contentId: E2,
        isNew: true,
        isRead: false,
        isSaved: false,
        savedAt: null,
      },
      lastAnswer: {
        contentId: E2,
        grades: E2_GRADES,
        completedAt: E2_COMPLETED_AT,
      },
    });

    // 画面（M04）は、教材を出した後に markOpened を呼ぶ（DD-02 FN-009 手順 4）。
    const opened = await markOpened({
      deviceApi: context.deviceApi,
      contents: createContents({ db, clock }),
    })(
      new Request(`${ORIGIN}/api/app/contents/${E2}/opened`, {
        method: "POST",
        headers: headers(),
      }),
      route(E2),
    );
    expect(opened.status).toBe(200);
    expect(stateRow(E2)?.opened_at).toBe(NOW);

    const again = (await (await callGet(E2)).json()) as {
      state: { isNew: boolean };
    };
    expect(again.state.isNew).toBe(false);
  });

  it("答えの無い教材は lastAnswer が null。読む教材の無い教材は reading が null", async () => {
    const e1 = (await (await callGet(E1)).json()) as Record<string, unknown>;
    expect(e1.lastAnswer).toBeNull();
    expect(e1.reading).toEqual(reading(E1_DATE));
    const e3 = (await (await callGet(E3)).json()) as Record<string, unknown>;
    expect(e3.reading).toBeNull();
    expect(e3.lastAnswer).toBeNull();
  });

  it("無い内容 ID、英語でない内容 ID、形の違う内容 ID は 404 と MSG-019", async () => {
    for (const id of [9999, A1, "abc"]) {
      const response = await callGet(id);
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual(errorBody("not_found", "MSG-019"));
    }
  });
});

describe("TC45 E1 の putEnglishAnswer に全ての問題の ○△×（FN-012、DD-02 FN-012）", () => {
  it("200。english_answer があり、content_state の is_read 1", async () => {
    expect(answerRow(E1)).toBeUndefined();
    const response = await callPut(E1, { grades: E1_ALL_GRADES });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      contentId: E1,
      grades: E1_ALL_GRADES,
      completedAt: NOW,
    });
    expect(answerRow(E1)).toEqual({
      answers_json: JSON.stringify(E1_ALL_GRADES),
      completed_at: NOW,
    });
    expect(stateRow(E1)).toMatchObject({ is_read: 1, read_at: NOW });

    // 一覧でも完了になる。
    const page = (await (await callList("?limit=1")).json()) as {
      items: Record<string, unknown>[];
    };
    expect(page.items[0]).toMatchObject({
      contentId: E1,
      isRead: true,
      isCompleted: true,
    });
  });

  it("前の答えは丸ごと置き換え、完了した日時を新しくする。既読の日時は変えない（DD-04 3.2）", async () => {
    db.prepare(
      "INSERT INTO content_state (content_id, is_read, read_at) VALUES (?, 1, ?)",
    ).run(E2, E2_COMPLETED_AT);
    const grades = [
      { no: 3, grade: "o", answer: "私は歩く。" },
      { no: 1, grade: "o" },
      { no: 2, grade: "o", answer: "walk" },
    ];
    const response = await callPut(E2, { grades });
    expect(response.status).toBe(200);
    expect(answerRow(E2)).toEqual({
      answers_json: JSON.stringify(grades),
      completed_at: NOW,
    });
    expect(stateRow(E2)).toMatchObject({
      is_read: 1,
      read_at: E2_COMPLETED_AT,
    });

    const detail = (await (await callGet(E2)).json()) as {
      lastAnswer: unknown;
    };
    expect(detail.lastAnswer).toEqual({
      contentId: E2,
      grades,
      completedAt: NOW,
    });
  });

  it("答えは 500 文字まで受ける", async () => {
    const grades = [
      { no: 1, grade: "o", answer: "あ".repeat(500) },
      { no: 2, grade: "o" },
      { no: 3, grade: "o" },
    ];
    expect((await callPut(E1, { grades })).status).toBe(200);
  });
});

describe("TC46 ○△× の無い問題がある grades、セットに無い問題番号を含む grades（FN-012、DD-06 E07）", () => {
  const cases: [string, unknown[]][] = [
    [
      "○△× の無い問題がある",
      [
        { no: 1, grade: "o" },
        { no: 2, grade: "x" },
      ],
    ],
    [
      "セットに無い問題番号を含む",
      [
        { no: 1, grade: "o" },
        { no: 2, grade: "x" },
        { no: 3, grade: "d" },
        { no: 4, grade: "o" },
      ],
    ],
    [
      "同じ問題番号が重なる",
      [
        { no: 1, grade: "o" },
        { no: 2, grade: "x" },
        { no: 2, grade: "d" },
      ],
    ],
  ];

  for (const [name, grades] of cases) {
    it(`${name}: 400 と MSG-005。データは変わらない`, async () => {
      for (const id of [E1, E2]) {
        const before = answerRow(id);
        const response = await callPut(id, { grades });
        expect(response.status).toBe(400);
        expect(await response.json()).toEqual(
          errorBody("bad_request", "MSG-005"),
        );
        expect(answerRow(id)).toEqual(before);
        expect(stateRow(id)).toBeUndefined();
      }
    });
  }
});

describe("putEnglishAnswer の入口（DD-02 3章 P01、DD-04 3.4）", () => {
  it("本文の形が違えば 400 と MSG-019 で、データは変わらない", async () => {
    const bodies: unknown[] = [
      "{",
      {},
      { grades: [] },
      { grades: E1_ALL_GRADES, extra: 1 },
      {
        grades: [
          { no: 1, grade: "o" },
          { no: 2, grade: "o" },
          { no: 3, grade: "maru" },
        ],
      },
      {
        grades: [
          { no: 1, grade: "o", answer: "あ".repeat(501) },
          { no: 2, grade: "o" },
          { no: 3, grade: "o" },
        ],
      },
    ];
    for (const body of bodies) {
      const response = await callPut(E1, body);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual(
        errorBody("bad_request", "MSG-019"),
      );
    }
    expect(answerRow(E1)).toBeUndefined();
    expect(stateRow(E1)).toBeUndefined();
  });

  it("無い内容 ID と英語でない内容 ID は 404 と MSG-019", async () => {
    for (const id of [9999, A1]) {
      const response = await callPut(id, { grades: E1_ALL_GRADES });
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual(errorBody("not_found", "MSG-019"));
    }
    expect(stateRow(A1)).toBeUndefined();
  });

  it("Origin が違うか無ければ 403 と MSG-019 で、データは変わらない", async () => {
    for (const origin of ["https://evil.example", null]) {
      const response = await callPut(E1, { grades: E1_ALL_GRADES }, { origin });
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual(
        errorBody("forbidden_origin", "MSG-019"),
      );
    }
    expect(answerRow(E1)).toBeUndefined();
  });

  it("残す途中の失敗は 500 と MSG-007", async () => {
    const failing: EnglishLearning = {
      ...context.english,
      putAnswer() {
        throw new NexusError("DB_UNAVAILABLE", "DB が使えない");
      },
    };
    const response = await callPut(
      E1,
      { grades: E1_ALL_GRADES },
      { api: { deviceApi: context.deviceApi, english: failing } },
    );
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual(errorBody("internal", "MSG-007"));
  });

  it("書き込みの途中で失敗したら、答えも既読も残らない", async () => {
    db.exec(
      "CREATE TRIGGER fail_state BEFORE INSERT ON content_state BEGIN SELECT RAISE(ABORT, 'fail'); END",
    );
    const response = await callPut(E1, { grades: E1_ALL_GRADES });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual(errorBody("internal", "MSG-007"));
    expect(answerRow(E1)).toBeUndefined();
    expect(stateRow(E1)).toBeUndefined();
  });

  it("鍵が無ければ 401 と MSG-020", async () => {
    const response = await listEnglishSets(context)(new Request(BASE));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual(errorBody("unauthorized", "MSG-020"));
  });
});
