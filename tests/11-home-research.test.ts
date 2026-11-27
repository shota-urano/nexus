import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020";
import { parse as parseYaml } from "yaml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setRead } from "../src/app/api/_entry/content-state";
import { createDeviceApiContext } from "../src/app/api/_entry/device-api";
import { type HomeApiContext, getHome } from "../src/app/api/_entry/home";
import { postResearchReport } from "../src/app/api/_entry/research-report";
import { createDeviceKeyVerifier } from "../src/server/auth/device-key";
import { createSenderKeys } from "../src/server/auth/sender-key";
import { createContents } from "../src/server/contents";
import {
  type Database,
  databasePath,
  openDatabase,
} from "../src/server/db/connection";
import { type Home, createHomeView } from "../src/server/home";
import { createIngest } from "../src/server/ingest";
import { type FakeClock, createFakeClock } from "../src/server/shared/clock";
import { createLogger } from "../src/server/shared/logger";
import { createSecret, hashSecret } from "../src/server/shared/secret";
import { NOW, insertD1News, migrate } from "./fixtures/news";

// 11-home の実装単位5（CR-020、CR-021）: `getHome` に `research.unreadCount`（既読でない週報の数）を足し、
// `docs/api/openapi.yaml` の `Home` に `research`（必須）を足す。週報の未着は出さない
// （FN-020、DD-01 M19、DD-02 FN-020 手順 6、DD-04 `Home`、RD-03 R21）。
// 受け入れ基準は DD-10 TC142、TC80、TC83、TC102。TC80 と TC83 は tests/11-home-api.test.ts で確かめる。
// 前提は「共通＋D2」（DD-10 3章）に、課題 B の2週目（2026-11-30 送り、未読）を足した DB。
// D2 は受け取りの関数（`postResearchReport`）で入れる。日本時間の今は 2026-12-01 08:00。

const ORIGIN = "http://localhost:48401";
const URL_HOME = `${ORIGIN}/api/app/home`;
const URL_REPORTS = "http://127.0.0.1:48400/api/research/reports";
const TODAY = "2026-12-01";
const HOME_NOTICES = ["MSG-015", "MSG-016", "MSG-017"];

type HomeWithResearch = Home & { research: { unreadCount: number } };

let dir: string;
let db: Database;
let clock: FakeClock;
let K1: string;
let KR: string;
let context: HomeApiContext;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-11-home-research-"));
  clock = createFakeClock(NOW);
  db = openDatabase(databasePath(dir));
  migrate(db);
  // 共通（D1）と端末 ipad の鍵 K1、配信元の鍵 KR（brain-research）。
  insertD1News(db);
  K1 = createSecret();
  db.prepare(
    "INSERT INTO device (device_name, device_key_hash, registered_at, last_used_at) VALUES ('ipad', ?, ?, ?)",
  ).run(hashSecret(K1), "2026-11-20T09:00:00.000+09:00", NOW);
  KR = createSenderKeys({ db, clock }).issue("brain-research").key;
  context = {
    deviceApi: createDeviceApiContext({
      clock,
      logger: createLogger({ process: "web", clock, dir: join(dir, "logs") }),
      origin: ORIGIN,
      deviceKeys: createDeviceKeyVerifier({ db, clock }),
    }),
    home: createHomeView({ db, clock }),
  };
});

afterEach(() => {
  if (db.isOpen) db.close();
  rmSync(dir, { recursive: true, force: true });
});

// ---- 週報を入れる ----

function approach(title: string, marks: string[] = []) {
  return {
    title,
    howToMd: `${title}のやり方。`,
    sourceUrls: ["https://example.com/research/source"],
    marks,
    counterMd: marks.includes("disputed") ? "反対の意見。" : null,
  };
}

async function receive(
  receivedAt: string,
  report: Record<string, unknown> & { topicId: string; week: number },
): Promise<number> {
  clock.set(receivedAt);
  const logger = createLogger({
    process: "web",
    clock,
    dir: join(dir, "logs"),
  });
  const response = await postResearchReport({
    logger,
    senderKeys: createSenderKeys({ db, clock }),
    ingest: createIngest({ db, clock, logger }),
  })(
    new Request(URL_REPORTS, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${KR}`,
      },
      body: JSON.stringify({ source: "brain-research", ...report }),
    }),
  );
  expect(response.status).toBe(200);
  clock.set(NOW);
  const row = db
    .prepare(
      "SELECT r.content_id FROM research_report AS r JOIN research_topic AS t ON t.topic_id = r.topic_id WHERE t.topic_key = ? AND r.week = ?",
    )
    .get(report.topicId, report.week) as { content_id: number } | undefined;
  if (row === undefined) throw new Error("週報が残っていない");
  return row.content_id;
}

// 端末の API の `setRead` で既読にする。
async function markRead(contentId: number): Promise<void> {
  const response = await setRead({
    deviceApi: context.deviceApi,
    contents: createContents({ db, clock }),
  })(
    new Request(`${ORIGIN}/api/app/contents/${contentId}/read`, {
      method: "PUT",
      headers: {
        cookie: `nexus_device=${K1}`,
        origin: ORIGIN,
        "content-type": "application/json",
      },
      body: JSON.stringify({ isRead: true }),
    }),
    { params: Promise.resolve({ contentId: String(contentId) }) },
  );
  expect(response.status).toBe(200);
}

const ragEval = (week: number, sentOn: string) => ({
  topicId: "rag-eval",
  topicTitle: "RAG の評価",
  week,
  sentOn,
  status: "ended",
  answerMd: "評価の軸を先に決める。",
  approaches: [approach("評価の軸を決める")],
  unknownsMd: "人の評価との差。",
  changesMd: week === 1 ? "初めての週報" : "変化なし",
});

const receiveB1 = () =>
  receive("2026-11-23T07:00:00.000+09:00", ragEval(1, "2026-11-23"));

// TC142 で D2 に足す、課題 B の2週目（2026-11-30 送り、未読）。
const receiveB2 = () =>
  receive("2026-11-30T07:00:00.000+09:00", ragEval(2, "2026-11-30"));

// D2（DD-10 3章）。課題 A（second-brain、進行中）の1週目（2026-11-24 送り、既読）と2週目
// （2026-12-01 送り、未読。印が added、more_sources、disputed の方法が1件ずつと印の無い方法1件）。
// 課題 B（rag-eval、終了）の1週目（2026-11-23 送り、既読）。
async function insertD2(): Promise<{ a1: number; a2: number; b1: number }> {
  const b1 = await receiveB1();
  const a1 = await receive("2026-11-24T07:00:00.000+09:00", {
    topicId: "second-brain",
    topicTitle: "第二の脳の作り方",
    week: 1,
    sentOn: "2026-11-24",
    status: "active",
    answerMd: "メモを毎日まとめる。",
    approaches: [approach("毎日まとめる")],
    unknownsMd: "続け方。",
    changesMd: "初めての週報",
  });
  const a2 = await receive("2026-12-01T07:00:00.000+09:00", {
    topicId: "second-brain",
    topicTitle: "第二の脳の作り方",
    week: 2,
    sentOn: "2026-12-01",
    status: "active",
    answerMd: "メモを毎日まとめ、週に1回見直す。",
    approaches: [
      approach("ノートを分けて書く", ["added"]),
      approach("週に1回見直す", ["more_sources"]),
      approach("道具を1つにする", ["disputed"]),
      approach("人に話す"),
    ],
    unknownsMd: "どこまで細かく分けるか。",
    changesMd: "方法を3件足した。",
  });
  await markRead(a1);
  await markRead(b1);
  return { a1, a2, b1 };
}

// ---- 呼ぶ ----

async function callHome(): Promise<{ status: number; json: unknown }> {
  const response = await getHome(context)(
    new Request(URL_HOME, {
      method: "GET",
      headers: { cookie: `nexus_device=${K1}` },
    }),
  );
  return { status: response.status, json: await response.json() };
}

async function home(): Promise<HomeWithResearch> {
  const { status, json } = await callHome();
  expect(status).toBe(200);
  return json as HomeWithResearch;
}

// ---- 定義ファイル ----

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

const readYaml = (path: string) =>
  parseYaml(readFileSync(join(__dirname, path), "utf8")) as JsonObject;

const openapi = readYaml("../docs/api/openapi.yaml");
const schemas = (openapi.components as JsonObject).schemas as JsonObject;

function toLocalRefs(value: Json): Json {
  if (Array.isArray(value)) return value.map(toLocalRefs);
  if (value === null || typeof value !== "object") return value;
  const result: JsonObject = {};
  for (const [key, item] of Object.entries(value)) {
    result[key] =
      key === "$ref" &&
      typeof item === "string" &&
      item.startsWith("#/components/schemas/")
        ? `#/$defs/${item.slice("#/components/schemas/".length)}`
        : toLocalRefs(item);
  }
  return result;
}

// `openapi.yaml` の `Home` で照らす（DD-04 の照合と同じく Ajv。ADR-021）。
function homeValidator() {
  const ajv = new Ajv2020({ allErrors: true });
  return ajv.compile({
    $ref: "#/$defs/Home",
    $defs: toLocalRefs(schemas) as JsonObject,
  });
}

// 形だけを比べる（説明の文は比べない）。
function shapeOf(value: Json): Json {
  if (Array.isArray(value)) return value.map(shapeOf);
  if (value === null || typeof value !== "object") return value;
  const result: JsonObject = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === "description" || key === "summary") continue;
    result[key] = shapeOf(item);
  }
  return result;
}

describe("TC142 ホームの未読の週報の数（FN-020、DD-02 FN-020 手順 6 の後、RD-03 R21、CR-020）", () => {
  it("TC142 共通＋D2 に課題 B の2週目（未読）を足した DB で、research.unreadCount は 2。notices に週報の未着が無い", async () => {
    const d2 = await insertD2();
    const b2 = await receiveB2();
    // 前提: 未読の週報は課題 A の2週目と課題 B の2週目の2件。
    const unread = db
      .prepare(
        "SELECT c.content_id FROM content AS c LEFT JOIN content_state AS s ON s.content_id = c.content_id WHERE c.kind = 'research' AND (s.content_id IS NULL OR s.is_read = 0) ORDER BY c.content_id",
      )
      .all()
      .map((row) => (row as { content_id: number }).content_id);
    expect(unread.sort()).toEqual([d2.a2, b2].sort());

    const result = await home();
    expect(result.research).toEqual({ unreadCount: 2 });
    for (const notice of result.notices) {
      expect(HOME_NOTICES).toContain(notice);
    }
    // 本文は openapi.yaml の Home に合う（TC102）。
    const validate = homeValidator();
    expect(validate(result), JSON.stringify(validate.errors)).toBe(true);
  });

  it("TC142 今日は週報の受け取りが無く、ほかの配信元は今日届いた 7:00 以後の DB で、notices は空（週報の未着を出さない）", async () => {
    // 週報は前の週の分だけ（今日の受け取りは無い）。D1 で brain-harness は今日届いている。
    await receiveB1();
    await receiveB2();
    db.prepare(
      "INSERT INTO delivery (sender, target_date, received_at, item_count, result) VALUES ('sharpen', ?, ?, 1, 'accepted')",
    ).run(TODAY, `${TODAY}T06:00:00.000+09:00`);
    expect(
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM delivery WHERE sender = 'brain-research' AND target_date = ? AND result = 'accepted'",
        )
        .get(TODAY),
    ).toEqual({ n: 0 });

    const result = await home();
    expect(result.notices).toEqual([]);
    expect(result.research).toEqual({ unreadCount: 2 });
  });

  it("既読にした週報は数えず、週報でない内容（ニュース）も数えない", async () => {
    // D1 のニュースは全て未読。週報は課題 B の1週目と2週目。
    const b1 = await receiveB1();
    await receiveB2();
    expect((await home()).research).toEqual({ unreadCount: 2 });

    await markRead(b1);
    expect((await home()).research).toEqual({ unreadCount: 1 });
  });
});

describe("TC102 openapi.yaml の Home に research（必須）がある（DD-04 `Home`、CR-021）", () => {
  const expected = readYaml("./fixtures/home-research-openapi.yaml");

  it("TC102 schema Home が DD-04 の定義どおり（research は必須で、unreadCount は 0 以上の整数）", () => {
    const want = expected.schemas as JsonObject;
    expect(schemas.Home).toBeDefined();
    expect(shapeOf(schemas.Home)).toEqual(shapeOf(want.Home));
  });

  it("TC102 Home の照合は research の無い本文と、unreadCount が負の本文を断る", () => {
    const validate = homeValidator();
    const body = {
      newCount: 0,
      unreadCount: 0,
      learning: null,
      ai: { writingCount: 0, hasFailure: false },
      picks: [],
      notices: [],
    };
    expect(validate(body)).toBe(false);
    expect(validate({ ...body, research: { unreadCount: -1 } })).toBe(false);
    expect(validate({ ...body, research: {} })).toBe(false);
    expect(validate({ ...body, research: { unreadCount: 0 } })).toBe(true);
  });

  it("TC102 getHome の応答の本文が openapi.yaml の Home に合う（週報の無い DB）", async () => {
    const result = await home();
    expect(result.research).toEqual({ unreadCount: 0 });
    const validate = homeValidator();
    expect(validate(result), JSON.stringify(validate.errors)).toBe(true);
  });
});
