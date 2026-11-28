import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020";
import { parse as parseYaml } from "yaml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setRead } from "../src/app/api/_entry/content-state";
import { createDeviceApiContext } from "../src/app/api/_entry/device-api";
import { postResearchReport } from "../src/app/api/_entry/research-report";
import { createDeviceKeyVerifier } from "../src/server/auth/device-key";
import { createSenderKeys } from "../src/server/auth/sender-key";
import { createContents } from "../src/server/contents";
import {
  type Database,
  databasePath,
  openDatabase,
} from "../src/server/db/connection";
import { createIngest } from "../src/server/ingest";
import { type FakeClock, createFakeClock } from "../src/server/shared/clock";
import { createLogger } from "../src/server/shared/logger";
import { createSecret, hashSecret } from "../src/server/shared/secret";
import { NOW, insertD1News, migrate } from "./fixtures/news";

// 14-research の実装単位1（CR-020、CR-021）: 課題の一覧 `listResearchTopics`（FN-026）と週報
// `getResearchReport`（FN-027。週の一覧、出典の数）を M33 で作り、`docs/api/openapi.yaml` に
// 2つの operation（`/api/app/research/topics`、`/api/app/research/reports/{contentId}`）と応答の schema
// （`ResearchTopicList`、`ResearchTopicSummary`、`ResearchReportDetail`、`Approach`）を足す。
// 受け入れ基準は DD-10 TC138、TC139、TC102。
// CR-024 の行: `getResearchReport` の応答に段（`steps`、`stepChangesMd`）と方法の `no`、`step`、`seen` を足し、
// `markApproachSeen` を作る。受け入れ基準は DD-10 TC152、TC153。TC102 の全ての operation の照合（正常、4xx、500）は
// tests/13-release-contract.test.ts でも確かめる。
// 前提は「共通＋D2」（DD-10 3章）。D2 は受け取りの関数（`postResearchReport`）で入れる。
// 呼ぶのは本物の道（src/app/api/app/research/**/route.ts）で、Web サーバと同じ部品
// （環境変数の設定で開く DB）まで通す。日本時間の今は 2026-12-01 08:00。

const ORIGIN = "http://localhost:48401";
const URL_REPORTS = "http://127.0.0.1:48400/api/research/reports";
const ENV_NAMES = [
  "NEXUS_ENV",
  "NEXUS_DATA_DIR",
  "NEXUS_LOG_DIR",
  "NEXUS_ORIGIN",
] as const;
const MISSING_ID = 999_999;

let dir: string;
let db: Database;
let clock: FakeClock;
let K1: string;
let KR: string;
let A1: number;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const name of ENV_NAMES) savedEnv[name] = process.env[name];
  // 共通の前提: 日本時間の今を 2026-12-01 08:00 にする（タイマーは本物のまま）。
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW));
  dir = mkdtempSync(join(tmpdir(), "nexus-14-research-api-"));
  process.env.NEXUS_ENV = "test";
  process.env.NEXUS_DATA_DIR = dir;
  process.env.NEXUS_LOG_DIR = join(dir, "logs");
  process.env.NEXUS_ORIGIN = ORIGIN;
  clock = createFakeClock(NOW);
  db = openDatabase(databasePath(dir));
  migrate(db);
  // 共通（D1）と端末 ipad の鍵 K1、配信元の鍵 KR（brain-research）。
  A1 = insertD1News(db).A1;
  K1 = createSecret();
  db.prepare(
    "INSERT INTO device (device_name, device_key_hash, registered_at, last_used_at) VALUES ('ipad', ?, ?, ?)",
  ).run(hashSecret(K1), "2026-11-20T09:00:00.000+09:00", NOW);
  KR = createSenderKeys({ db, clock }).issue("brain-research").key;
  vi.resetModules();
});

afterEach(async () => {
  try {
    const { webContext } = await import("../src/app/api/_entry/web-context");
    const { aiJobs } = webContext();
    if (aiJobs.db.isOpen) aiJobs.close();
  } catch {
    // 部品を作れなかったときは閉じるものが無い。
  }
  if (db.isOpen) db.close();
  rmSync(dir, { recursive: true, force: true });
  vi.useRealTimers();
  for (const name of ENV_NAMES) {
    if (savedEnv[name] === undefined) delete process.env[name];
    else process.env[name] = savedEnv[name];
  }
});

// ---- 週報を入れる ----

interface ApproachInput {
  title: string;
  howToMd: string;
  sourceUrls: string[];
  marks: string[];
  counterMd: string | null;
}

function approach(
  title: string,
  marks: string[] = [],
  sourceUrls: string[] = ["https://example.com/research/source"],
): ApproachInput {
  return {
    title,
    howToMd: `${title}のやり方。`,
    sourceUrls,
    marks,
    counterMd: marks.includes("disputed") ? "反対の意見。" : null,
  };
}

interface ReportInput {
  topicId: string;
  topicTitle: string;
  week: number;
  sentOn: string;
  status: string;
  answerMd: string;
  approaches: ApproachInput[];
  unknownsMd: string;
  changesMd: string;
}

async function receive(
  receivedAt: string,
  report: ReportInput,
): Promise<number> {
  clock.set(receivedAt);
  const logger = createLogger({
    process: "web",
    clock,
    dir: join(dir, "seed-logs"),
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

// 端末の API の `setRead` で既読にする（D2 の既読の週報）。
async function markRead(contentId: number): Promise<void> {
  const response = await setRead({
    deviceApi: createDeviceApiContext({
      clock,
      logger: createLogger({ process: "web", clock, dir: join(dir, "seed") }),
      origin: ORIGIN,
      deviceKeys: createDeviceKeyVerifier({ db, clock }),
    }),
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

// 課題 A の1週目。方法は3件で、出典の URL が 2、1、0 件（出典の数を確かめるため）。
const A_WEEK1: ReportInput = {
  topicId: "second-brain",
  topicTitle: "第二の脳の作り方",
  week: 1,
  sentOn: "2026-11-24",
  status: "active",
  answerMd: "メモを毎日まとめる。",
  approaches: [
    approach(
      "毎日まとめる",
      [],
      [
        "https://example.com/research/daily-1",
        "https://example.com/research/daily-2",
      ],
    ),
    approach("タグを付ける", [], ["http://example.com/research/tag"]),
    approach("紙に書く", [], []),
  ],
  unknownsMd: "続け方。",
  changesMd: "初めての週報",
};

// 課題 A の2週目。印が added、more_sources、disputed の方法が1件ずつと、印の無い方法1件。
const A_WEEK2: ReportInput = {
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
};

const B_WEEK1: ReportInput = {
  topicId: "rag-eval",
  topicTitle: "RAG の評価",
  week: 1,
  sentOn: "2026-11-23",
  status: "ended",
  answerMd: "評価の軸を先に決める。",
  approaches: [approach("評価の軸を決める")],
  unknownsMd: "人の評価との差。",
  changesMd: "初めての週報",
};

const RECEIVED = {
  b1: "2026-11-23T07:00:00.000+09:00",
  a1: "2026-11-24T07:00:00.000+09:00",
  a2: "2026-12-01T07:00:00.000+09:00",
};

// D2（DD-10 3章）。課題 A（second-brain、進行中）の1週目（2026-11-24 送り、既読）と2週目
// （2026-12-01 送り、未読）。課題 B（rag-eval、終了）の1週目（2026-11-23 送り、既読）。
async function insertD2(): Promise<{ a1: number; a2: number; b1: number }> {
  const b1 = await receive(RECEIVED.b1, B_WEEK1);
  const a1 = await receive(RECEIVED.a1, A_WEEK1);
  const a2 = await receive(RECEIVED.a2, A_WEEK2);
  await markRead(a1);
  await markRead(b1);
  return { a1, a2, b1 };
}

// ---- 本物の道を呼ぶ ----

const headers = (cookie: string | null): HeadersInit =>
  cookie === null ? {} : { cookie };

async function callTopics(
  cookie: string | null = `nexus_device=${K1}`,
): Promise<Response> {
  const route = await import("../src/app/api/app/research/topics/route");
  return route.GET(
    new Request(`${ORIGIN}/api/app/research/topics`, {
      method: "GET",
      headers: headers(cookie),
    }),
  );
}

async function callReport(
  contentId: number,
  cookie: string | null = `nexus_device=${K1}`,
): Promise<Response> {
  const route =
    await import("../src/app/api/app/research/reports/[contentId]/route");
  return route.GET(
    new Request(`${ORIGIN}/api/app/research/reports/${contentId}`, {
      method: "GET",
      headers: headers(cookie),
    }),
    { params: Promise.resolve({ contentId: String(contentId) }) },
  );
}

interface TopicSummary {
  topicId: string;
  title: string;
  status: string;
  lastWeek: number;
  lastReceivedAt: string;
  latestContentId: number;
  hasUnread: boolean;
}

interface ReportDetail {
  contentId: number;
  topicId: string;
  topicTitle: string;
  week: number;
  sentOn: string;
  status: string;
  answerMd: string;
  approaches: (ApproachInput & { sourceCount: number })[];
  unknownsMd: string;
  changesMd: string;
  receivedAt: string;
  state: {
    contentId: number;
    isNew: boolean;
    isRead: boolean;
    isSaved: boolean;
  };
  weeks: { contentId: number; week: number; sentOn: string; isRead: boolean }[];
}

// ---- 定義ファイル ----

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

const readYaml = (path: string) =>
  parseYaml(readFileSync(join(__dirname, path), "utf8")) as JsonObject;

const openapi = readYaml("../docs/api/openapi.yaml");
const schemas = (openapi.components as JsonObject).schemas as JsonObject;
const expected = readYaml("./fixtures/research-topics-openapi.yaml");

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

// `openapi.yaml` の schema で照らす（DD-04 の照合と同じく Ajv。ADR-021）。
function validatorOf(name: string) {
  const ajv = new Ajv2020({ allErrors: true });
  return ajv.compile({
    $ref: `#/$defs/${name}`,
    $defs: toLocalRefs(schemas) as JsonObject,
  });
}

function expectSchema(name: string, body: unknown): void {
  const validate = validatorOf(name);
  expect(validate(body), JSON.stringify(validate.errors)).toBe(true);
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

// ---- テスト ----

describe("TC138 課題の一覧 listResearchTopics（FN-026、DD-02 FN-026、CR-020）", () => {
  it("TC138 共通＋D2 で、課題 A、B が最後に届いた日時の新しい順。A は lastWeek 2、latestContentId が2週目、hasUnread 真。B（全て既読）は hasUnread 偽で status ended", async () => {
    const d2 = await insertD2();
    const response = await callTopics();
    expect(response.status).toBe(200);
    const body = (await response.json()) as { topics: TopicSummary[] };
    expectSchema("ResearchTopicList", body);

    expect(body.topics.map((t) => t.topicId)).toEqual([
      "second-brain",
      "rag-eval",
    ]);
    const [a, b] = body.topics;
    expect(a).toMatchObject({
      topicId: "second-brain",
      title: "第二の脳の作り方",
      status: "active",
      lastWeek: 2,
      latestContentId: d2.a2,
      hasUnread: true,
    });
    expect(b).toMatchObject({
      topicId: "rag-eval",
      title: "RAG の評価",
      status: "ended",
      lastWeek: 1,
      latestContentId: d2.b1,
      hasUnread: false,
    });
    // 最後に届いた日時は research_topic.last_received_at（受け取った日時）。
    expect(Date.parse(a.lastReceivedAt)).toBe(Date.parse(RECEIVED.a2));
    expect(Date.parse(b.lastReceivedAt)).toBe(Date.parse(RECEIVED.b1));
    expect(Date.parse(a.lastReceivedAt)).toBeGreaterThan(
      Date.parse(b.lastReceivedAt),
    );
  });

  it("TC138 最後に届いた日時の順は、課題を作った順ではない（B の2週目が A より後に届くと B が先になる）", async () => {
    await insertD2();
    await receive("2026-12-01T07:30:00.000+09:00", {
      ...B_WEEK1,
      week: 2,
      sentOn: "2026-12-01",
      changesMd: "変化なし",
    });
    const response = await callTopics();
    expect(response.status).toBe(200);
    const body = (await response.json()) as { topics: TopicSummary[] };
    expect(body.topics.map((t) => t.topicId)).toEqual([
      "rag-eval",
      "second-brain",
    ]);
    // B の2週目は未読なので、B の hasUnread は真になる。
    expect(body.topics[0]).toMatchObject({ lastWeek: 2, hasUnread: true });
  });

  it("TC138 空の DB（週報が1件も無い）では topics が空", async () => {
    const response = await callTopics();
    expect(response.status).toBe(200);
    const body = (await response.json()) as { topics: TopicSummary[] };
    expect(body).toEqual({ topics: [] });
    expectSchema("ResearchTopicList", body);
  });

  it("端末の鍵が無いと 401（DD-02 3章 P01、DD-06 E03）", async () => {
    await insertD2();
    const response = await callTopics(null);
    expect(response.status).toBe(401);
    expectSchema("Error", await response.json());
  });
});

describe("TC139 週報 getResearchReport（FN-027、DD-02 FN-027、DD-06 E05、CR-020）", () => {
  it("TC139 課題 A の1週目の内容ID で、1週目の中身と、weeks が2週目、1週目の順。方法ごとの sourceCount が URL の数", async () => {
    const d2 = await insertD2();
    const response = await callReport(d2.a1);
    expect(response.status).toBe(200);
    const body = (await response.json()) as ReportDetail;
    expectSchema("ResearchReportDetail", body);

    expect(body).toMatchObject({
      contentId: d2.a1,
      topicId: "second-brain",
      topicTitle: "第二の脳の作り方",
      week: 1,
      sentOn: "2026-11-24",
      status: "active",
      answerMd: A_WEEK1.answerMd,
      unknownsMd: A_WEEK1.unknownsMd,
      changesMd: A_WEEK1.changesMd,
    });
    expect(Date.parse(body.receivedAt)).toBe(Date.parse(RECEIVED.a1));
    // 1週目は既読（D2）。
    expect(body.state).toMatchObject({ contentId: d2.a1, isRead: true });

    // 方法は送った順に、送った値のまま。出典の数は sourceUrls の数（Q-088 の答え）。
    expect(body.approaches).toMatchObject(
      A_WEEK1.approaches.map((a) => ({
        ...a,
        sourceCount: a.sourceUrls.length,
      })),
    );
    expect(body.approaches.map((a) => a.sourceCount)).toEqual([2, 1, 0]);

    // 同じ課題の週の一覧は、週の大きい順（課題 B の週は入らない）。
    expect(body.weeks).toMatchObject([
      { contentId: d2.a2, week: 2, sentOn: "2026-12-01", isRead: false },
      { contentId: d2.a1, week: 1, sentOn: "2026-11-24", isRead: true },
    ]);
  });

  it("TC139 課題 A の2週目の内容ID でも、その週の中身（印と反対の意見）と同じ weeks を返す", async () => {
    const d2 = await insertD2();
    const response = await callReport(d2.a2);
    expect(response.status).toBe(200);
    const body = (await response.json()) as ReportDetail;
    expectSchema("ResearchReportDetail", body);
    expect(body).toMatchObject({ contentId: d2.a2, week: 2 });
    expect(body.state).toMatchObject({ contentId: d2.a2, isRead: false });
    expect(body.approaches).toMatchObject(
      A_WEEK2.approaches.map((a) => ({
        ...a,
        sourceCount: a.sourceUrls.length,
      })),
    );
    expect(body.weeks.map((w) => w.contentId)).toEqual([d2.a2, d2.a1]);
  });

  it("TC139 課題 B の1週目は、weeks が B の1週目だけ", async () => {
    const d2 = await insertD2();
    const response = await callReport(d2.b1);
    expect(response.status).toBe(200);
    const body = (await response.json()) as ReportDetail;
    expect(body).toMatchObject({
      contentId: d2.b1,
      topicId: "rag-eval",
      status: "ended",
    });
    expect(body.weeks).toMatchObject([
      { contentId: d2.b1, week: 1, sentOn: "2026-11-23", isRead: true },
    ]);
  });

  it("TC139 記事 A1 の内容ID（週報でない内容）は 404 と MSG-048", async () => {
    await insertD2();
    const response = await callReport(A1);
    expect(response.status).toBe(404);
    const body = (await response.json()) as {
      error: { code: string; messageId: string };
    };
    expectSchema("Error", body);
    expect(body.error).toMatchObject({
      code: "not_found",
      messageId: "MSG-048",
    });
  });

  it("TC139 無い内容ID は 404 と MSG-048", async () => {
    await insertD2();
    const response = await callReport(MISSING_ID);
    expect(response.status).toBe(404);
    const body = (await response.json()) as {
      error: { code: string; messageId: string };
    };
    expectSchema("Error", body);
    expect(body.error).toMatchObject({
      code: "not_found",
      messageId: "MSG-048",
    });
  });

  it("端末の鍵が無いと 401（DD-02 3章 P01、DD-06 E03）", async () => {
    const d2 = await insertD2();
    const response = await callReport(d2.a1, null);
    expect(response.status).toBe(401);
    expectSchema("Error", await response.json());
  });
});

describe("TC102 openapi.yaml の listResearchTopics、getResearchReport と schema が DD-04 の定義どおり（DD-04 1章、CR-021）", () => {
  it.each([
    "/api/app/research/topics",
    "/api/app/research/reports/{contentId}",
    "/api/app/research/reports/{contentId}/approaches/{no}/seen",
  ])("TC102 %s が DD-04 の定義どおり", (path) => {
    const paths = openapi.paths as JsonObject;
    const want = expected.paths as JsonObject;
    expect(paths[path]).toBeDefined();
    expect(shapeOf(paths[path])).toEqual(shapeOf(want[path]));
  });

  it.each([
    "ResearchTopicList",
    "ResearchTopicSummary",
    "ResearchReportDetail",
    "Approach",
    "ApproachSeen",
  ])("TC102 schema %s が DD-04 の定義どおり", (name) => {
    const want = expected.schemas as JsonObject;
    expect(schemas[name]).toBeDefined();
    expect(shapeOf(schemas[name])).toEqual(shapeOf(want[name]));
  });

  it("TC102 Approach の照合は sourceCount の無い方法と、負の sourceCount を断る", () => {
    const validate = validatorOf("Approach");
    const body = {
      title: "毎日まとめる",
      howToMd: "やり方。",
      sourceUrls: ["https://example.com/a"],
      marks: ["added"],
      counterMd: null,
    };
    expect(validate(body)).toBe(false);
    expect(validate({ ...body, sourceCount: -1 })).toBe(false);
    expect(validate({ ...body, sourceCount: 1 })).toBe(true);
  });
});

// ---- CR-024（段と確かめた印） ----

// 課題 A の2週目を、段の欄のある週報で送り直したもの（段3件。段2が今ここ）。
const A_WEEK2_ROADMAP = {
  ...A_WEEK2,
  steps: [
    { no: 1, title: "材料を残す", status: "done" },
    { no: 2, title: "つながりを見分ける", status: "current" },
    { no: 3, title: "アイデアを出す", status: "todo" },
  ],
  stepChangesMd: "段3を2つに分ける案。",
  approaches: A_WEEK2.approaches.map((a, i) => ({
    ...a,
    no: [1, 2, 3, 4][i],
    step: [2, 2, 1, null][i],
  })),
};

async function callSeen(
  contentId: number,
  no: number | string,
  init: { cookie?: string | null; origin?: string } = {},
): Promise<Response> {
  const route =
    await import("../src/app/api/app/research/reports/[contentId]/approaches/[no]/seen/route");
  const cookie = init.cookie === undefined ? `nexus_device=${K1}` : init.cookie;
  return route.POST(
    new Request(
      `${ORIGIN}/api/app/research/reports/${contentId}/approaches/${no}/seen`,
      {
        method: "POST",
        headers: {
          ...(cookie === null ? {} : { cookie }),
          origin: init.origin ?? ORIGIN,
        },
      },
    ),
    {
      params: Promise.resolve({
        contentId: String(contentId),
        no: String(no),
      }),
    },
  );
}

const seenRows = () =>
  db
    .prepare(
      "SELECT content_id, approach_no, seen_at FROM research_approach_seen ORDER BY content_id, approach_no",
    )
    .all();

interface RoadmapDetail extends ReportDetail {
  steps: { no: number; title: string; status: string }[];
  stepChangesMd: string | null;
  approaches: (ReportDetail["approaches"][number] & {
    no: number | null;
    step: number | null;
    seen: boolean;
  })[];
}

describe("TC152 週報 getResearchReport の段と確かめた印（FN-027 手順 4。CR-024）", () => {
  it("TC152 段の欄のある2週目は steps、stepChangesMd、方法の no と step を送った値で返し、確かめた no 2 だけ seen が真", async () => {
    const d2 = await insertD2();
    await receive(RECEIVED.a2, A_WEEK2_ROADMAP);
    db.prepare(
      "INSERT INTO research_approach_seen (content_id, approach_no, seen_at) VALUES (?, 2, ?)",
    ).run(d2.a2, NOW);

    const response = await callReport(d2.a2);
    expect(response.status).toBe(200);
    const body = (await response.json()) as RoadmapDetail;
    expectSchema("ResearchReportDetail", body);
    expect(body.steps).toEqual(A_WEEK2_ROADMAP.steps);
    expect(body.stepChangesMd).toBe(A_WEEK2_ROADMAP.stepChangesMd);
    expect(body.approaches.map((a) => [a.no, a.step, a.seen])).toEqual([
      [1, 2, false],
      [2, 2, true],
      [3, 1, false],
      [4, null, false],
    ]);
  });

  it("TC152 段の欄の無い1週目は steps が空、stepChangesMd が null、方法の no と step が null、seen が偽", async () => {
    const d2 = await insertD2();
    const response = await callReport(d2.a1);
    expect(response.status).toBe(200);
    const body = (await response.json()) as RoadmapDetail;
    expectSchema("ResearchReportDetail", body);
    expect(body.steps).toEqual([]);
    expect(body.stepChangesMd).toBeNull();
    for (const a of body.approaches) {
      expect(a).toMatchObject({ no: null, step: null, seen: false });
    }
  });
});

describe("TC153 markApproachSeen（FN-027 手順 8、RD-03 R26、DD-04 3.2、DD-06 E04・E05。CR-024）", () => {
  it("TC153 no 1 を2回確かめると、どちらも 200 で seenAt は1回目のまま。送り直しの後も seen が真", async () => {
    const d2 = await insertD2();
    await receive(RECEIVED.a2, A_WEEK2_ROADMAP);

    const first = await callSeen(d2.a2, 1);
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as {
      contentId: number;
      no: number;
      seenAt: string;
    };
    expectSchema("ApproachSeen", firstBody);
    expect(firstBody).toMatchObject({ contentId: d2.a2, no: 1 });
    expect(Date.parse(firstBody.seenAt)).toBe(Date.parse(NOW));

    vi.setSystemTime(new Date(Date.parse(NOW) + 60_000));
    const second = await callSeen(d2.a2, 1);
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as { seenAt: string };
    expect(secondBody.seenAt).toBe(firstBody.seenAt);
    expect(seenRows()).toHaveLength(1);

    // 同じ週を送り直しても、確かめたことは残る（RD-03 R23、R26）。
    await receive(RECEIVED.a2, A_WEEK2_ROADMAP);
    const report = (await (await callReport(d2.a2)).json()) as RoadmapDetail;
    expect(report.approaches.find((a) => a.no === 1)?.seen).toBe(true);
  });

  it.each([
    ["無い番号 no 99", "a2", 99],
    ["週報でない内容（記事 A1）", "A1", 1],
    ["無い内容ID", "missing", 1],
  ] as const)(
    "TC153 %s は 404 と MSG-048 で、行が増えない",
    async (_label, target, no) => {
      const d2 = await insertD2();
      await receive(RECEIVED.a2, A_WEEK2_ROADMAP);
      const id = target === "a2" ? d2.a2 : target === "A1" ? A1 : MISSING_ID;
      const response = await callSeen(id, no);
      expect(response.status).toBe(404);
      const body = (await response.json()) as {
        error: { code: string; messageId: string };
      };
      expectSchema("Error", body);
      expect(body.error).toMatchObject({
        code: "not_found",
        messageId: "MSG-048",
      });
      expect(seenRows()).toEqual([]);
    },
  );

  it("TC153 番号の形が違う（0、文字）は 404 と MSG-048", async () => {
    const d2 = await insertD2();
    await receive(RECEIVED.a2, A_WEEK2_ROADMAP);
    for (const no of ["0", "abc"]) {
      const response = await callSeen(d2.a2, no);
      expect(response.status, no).toBe(404);
    }
    expect(seenRows()).toEqual([]);
  });

  it("TC153 Origin の違う求めは 403 で、行が増えない", async () => {
    const d2 = await insertD2();
    await receive(RECEIVED.a2, A_WEEK2_ROADMAP);
    const response = await callSeen(d2.a2, 1, {
      origin: "http://evil.example",
    });
    expect(response.status).toBe(403);
    expect(seenRows()).toEqual([]);
  });

  it("TC153 端末の鍵が無いと 401 で、行が増えない", async () => {
    const d2 = await insertD2();
    await receive(RECEIVED.a2, A_WEEK2_ROADMAP);
    const response = await callSeen(d2.a2, 1, { cookie: null });
    expect(response.status).toBe(401);
    expect(seenRows()).toEqual([]);
  });
});
