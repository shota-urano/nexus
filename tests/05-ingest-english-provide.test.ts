import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getEnglishResult,
  getEnglishSetForSender,
} from "../src/app/api/_entry/english-provide";
import { createSenderKeys } from "../src/server/auth/sender-key";
import { type Database, openDatabase } from "../src/server/db/connection";
import { createIngest } from "../src/server/ingest";
import { ENGLISH_KIND } from "../src/server/kinds/english/ingest";
import { createEnglishForSender } from "../src/server/kinds/english/provide";
import { createFakeClock } from "../src/server/shared/clock";
import { createLogger } from "../src/server/shared/logger";
import { formatMessage } from "../src/server/shared/messages";
import { NOW, insertD1News, migrate } from "./fixtures/news";

// 05-ingest の実装単位3: sharpen が読む `getEnglishSetForSender` と `getEnglishResult`。
// FN-013、IF-003、DD-01 M16、DD-02 FN-013。受け入れ基準は TC35〜TC37。

const BASE = "http://127.0.0.1:48400/api/learning/sets";
const E1_DATE = "2026-12-01";
const E2_DATE = "2026-11-30";
const E2_COMPLETED_AT = "2026-11-30T21:15:00.000+09:00";
const E2_RECEIVED_AT = "2026-11-30T06:00:00.000+09:00";

let dir: string;
let db: Database;
let KB: string;
let KS: string;
let e1Payload: Record<string, unknown>;
const clock = createFakeClock(NOW);

function englishSet(date: string, withReading: boolean) {
  return {
    date,
    lane: "en",
    theme: "現在形の使い方",
    source: "theme",
    lessonMd: "# 現在形\n\n習慣を表す。",
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
    ...(withReading
      ? {
          read: {
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
          },
        }
      : {}),
  };
}

const E2_GRADES = [
  { no: 1, grade: "o", answer: "b" },
  { no: 2, grade: "d", answer: "walks" },
  { no: 3, grade: "x" },
];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-english-provide-"));
  clock.set(NOW);
  db = openDatabase(join(dir, "nexus.db"));
  migrate(db);
  // 共通（D1）: ニュース、配信元の鍵 KB、KS、英語の E1（2026-12-01、未完了）と E2（2026-11-30、完了）。
  insertD1News(db);
  const keys = createSenderKeys({ db, clock });
  KB = keys.issue("brain-harness").key;
  KS = keys.issue("sharpen").key;
  const logger = createLogger({
    process: "web",
    clock,
    dir: join(dir, "logs"),
  });
  const ingest = createIngest({ db, clock, logger });

  clock.set(E2_RECEIVED_AT);
  const e2 = englishSet(E2_DATE, false);
  expect(
    ingest.receive("sharpen", ENGLISH_KIND, e2, JSON.stringify(e2)).ok,
  ).toBe(true);
  db.prepare(
    `INSERT INTO english_answer (content_id, answers_json, completed_at)
     SELECT content_id, ?, ? FROM content WHERE kind = 'english' AND target_date = ?`,
  ).run(JSON.stringify(E2_GRADES), E2_COMPLETED_AT, E2_DATE);

  clock.set(NOW);
  e1Payload = englishSet(E1_DATE, true);
  expect(
    ingest.receive(
      "sharpen",
      ENGLISH_KIND,
      e1Payload,
      JSON.stringify(e1Payload),
    ).ok,
  ).toBe(true);
});

afterEach(() => {
  if (db.isOpen) db.close();
  rmSync(dir, { recursive: true, force: true });
});

function context() {
  return {
    logger: createLogger({ process: "web", clock, dir: join(dir, "logs") }),
    senderKeys: createSenderKeys({ db, clock }),
    englishForSender: createEnglishForSender({ db }),
    clock,
  };
}

async function call(
  which: "set" | "result",
  date: string,
  key: string | null = KS,
  lane: string | null = "en",
): Promise<{ status: number; json: Record<string, unknown> }> {
  const headers: Record<string, string> = {};
  if (key !== null) headers.authorization = `Bearer ${key}`;
  const path = which === "set" ? `${BASE}/${date}` : `${BASE}/${date}/result`;
  const url = lane === null ? path : `${path}?lane=${lane}`;
  const handler =
    which === "set"
      ? getEnglishSetForSender(context())
      : getEnglishResult(context());
  const response = await handler(new Request(url, { method: "GET", headers }), {
    params: Promise.resolve({ date }),
  });
  return {
    status: response.status,
    json: (await response.json()) as Record<string, unknown>,
  };
}

const errorOf = (json: Record<string, unknown>) =>
  json.error as { code: string; message: string; messageId: string };

const deliveryCount = () =>
  Number(db.prepare("SELECT COUNT(*) AS n FROM delivery").get()?.n);

describe("TC35 sharpen がセットと答えを読む（FN-013、DD-02 FN-013）", () => {
  it("TC35 11-30 の答えは 200。today の答えは 404 と MSG-035。today のセットは 200 で原文に date と receivedAt", async () => {
    const before = deliveryCount();

    const done = await call("result", E2_DATE);
    expect(done.status).toBe(200);
    expect(done.json).toEqual({
      date: E2_DATE,
      grades: E2_GRADES,
      feeling: "",
      completedAt: E2_COMPLETED_AT,
    });

    const notYet = await call("result", "today");
    expect(notYet.status).toBe(404);
    expect(errorOf(notYet.json)).toEqual({
      code: "not_found",
      messageId: "MSG-035",
      message: formatMessage("MSG-035", { 日付: E1_DATE }),
    });

    const set = await call("set", "today");
    expect(set.status).toBe(200);
    expect(set.json).toEqual({ ...e1Payload, date: E1_DATE, receivedAt: NOW });

    // 読むだけなので受け取りの記録を作らない（DD-02 FN-013 手順 4）。
    expect(deliveryCount()).toBe(before);
  });

  it("TC35 答えは answers_json のまま返す（置き換えた後のセットに無い問題番号も残す）", async () => {
    const grades = [...E2_GRADES, { no: 9, grade: "o" }];
    db.prepare(
      `UPDATE english_answer SET answers_json = ?
       WHERE content_id = (SELECT content_id FROM content WHERE kind = 'english' AND target_date = ?)`,
    ).run(JSON.stringify(grades), E2_DATE);
    const { status, json } = await call("result", E2_DATE);
    expect(status).toBe(200);
    expect(json.grades).toEqual(grades);
  });
});

describe("TC36 セットの無い日（FN-013、DD-06 E05）", () => {
  it("TC36 getEnglishResult と getEnglishSetForSender はどちらも 404 と MSG-036", async () => {
    const date = "2026-11-29";
    for (const which of ["result", "set"] as const) {
      const { status, json } = await call(which, date);
      expect(status).toBe(404);
      expect(errorOf(json)).toEqual({
        code: "not_found",
        messageId: "MSG-036",
        message: formatMessage("MSG-036", { 日付: date }),
      });
    }
  });
});

describe("TC37 鍵（FN-013、NFR-014）", () => {
  it("TC37 鍵なしと KB で getEnglishResult はどちらも 401 と MSG-032", async () => {
    for (const key of [null, KB]) {
      const { status, json } = await call("result", E2_DATE, key);
      expect(status).toBe(401);
      expect(errorOf(json)).toEqual({
        code: "unauthorized",
        messageId: "MSG-032",
        message: formatMessage("MSG-032"),
      });
    }
  });
});

describe("FN-013 の入力の確かめ（DD-02 FN-013 手順 1）", () => {
  it("lane が en でないか無いときは 400 と MSG-033", async () => {
    for (const lane of ["main", null]) {
      for (const which of ["result", "set"] as const) {
        const { status, json } = await call(which, E1_DATE, KS, lane);
        expect(status).toBe(400);
        expect(errorOf(json).messageId).toBe("MSG-033");
      }
    }
  });

  it("存在しない日付は 400 と MSG-033", async () => {
    const { status, json } = await call("set", "2026-02-30");
    expect(status).toBe(400);
    expect(errorOf(json).messageId).toBe("MSG-033");
  });
});
