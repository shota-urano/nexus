import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020";
import { parse as parseYaml } from "yaml";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createDevices } from "../src/server/auth/devices";
import { createSenderKeys } from "../src/server/auth/sender-key";
import {
  type Database,
  databasePath,
  openDatabase,
} from "../src/server/db/connection";
import { createIngest } from "../src/server/ingest";
import { ENGLISH_KIND } from "../src/server/kinds/english/ingest";
import { RESEARCH_KIND } from "../src/server/kinds/research/ingest";
import { createFakeClock } from "../src/server/shared/clock";
import { createLogger } from "../src/server/shared/logger";
import { createSecret, hashSecret } from "../src/server/shared/secret";
import { NOW, insertD1News, migrate } from "./fixtures/news";

// 13-release の実装単位3: 全ての operation の応答を `docs/api/openapi.yaml` と照らす契約のテスト
// （NFR-015、DD-01 M10、ADR-021、DD-04 1章「実装との一致の確かめ方」、DD-04 3.4）。受け入れ基準は DD-10 TC102。
// DD-04 2章の全ての operation について、正常の応答と、定義ファイルに書いた全ての 4xx の応答と、
// DB の失敗を差し込んだときの 500 の応答（`streamReply` は送り始める前の失敗）を、本物の道
// （src/app/**/route.ts）から Web サーバと同じ部品（環境変数の設定で開く DB）まで通して起こし、
//   - 状態の番号が、その operation の定義ファイルの responses にあること
//   - 本文が、その状態の番号の schema に Ajv で合うこと（本文を定めていない応答は本文が空であること）
// を確かめる。前提の状態は DD-10 2章の「共通」（D1 を入れた一時の DB、日本時間の今 2026-12-01 08:00、
// 端末 `ipad` の鍵 K1 の Cookie、NEXUS のオリジンの `Origin`）。

const ORIGIN = "http://localhost:48401";
const OPENAPI_PATH = join(__dirname, "..", "docs", "api", "openapi.yaml");
const ENV_NAMES = [
  "NEXUS_ENV",
  "NEXUS_DATA_DIR",
  "NEXUS_LOG_DIR",
  "NEXUS_ORIGIN",
] as const;
const HTTP_METHODS = ["get", "put", "post", "delete", "patch"] as const;
// 配信元の本文の上限（BD-06 IF-001 3.2 は 1 MiB、IF-002 3.2 と IF-005 3.2 は 256 KiB）。
const NEWS_BATCH_LIMIT_BYTES = 1024 * 1024;
const ENGLISH_SET_LIMIT_BYTES = 256 * 1024;
const RESEARCH_REPORT_LIMIT_BYTES = 256 * 1024;
const MISSING_ID = 999_999;

// ---- 定義ファイル ----

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

interface OperationDef {
  method: string;
  path: string;
  responses: Record<string, JsonObject>;
}

const openapi = parseYaml(readFileSync(OPENAPI_PATH, "utf8")) as JsonObject;
const components = openapi.components as JsonObject;

function resolveResponse(response: JsonObject): JsonObject {
  const ref = response.$ref;
  if (typeof ref !== "string") return response;
  const prefix = "#/components/responses/";
  if (!ref.startsWith(prefix)) throw new Error(`読めない参照: ${ref}`);
  const resolved = (components.responses as JsonObject)[
    ref.slice(prefix.length)
  ];
  if (resolved === undefined) throw new Error(`参照の先が無い: ${ref}`);
  return resolveResponse(resolved as JsonObject);
}

function readOperations(): Map<string, OperationDef> {
  const result = new Map<string, OperationDef>();
  for (const [path, item] of Object.entries(openapi.paths as JsonObject)) {
    for (const method of HTTP_METHODS) {
      const operation = (item as JsonObject)[method] as JsonObject | undefined;
      if (operation === undefined) continue;
      const responses: Record<string, JsonObject> = {};
      for (const [status, response] of Object.entries(
        operation.responses as JsonObject,
      )) {
        responses[status] = resolveResponse(response as JsonObject);
      }
      result.set(String(operation.operationId), { method, path, responses });
    }
  }
  return result;
}

const OPERATIONS = readOperations();

// 定義ファイルの schema（OpenAPI 3.1 は JSON Schema 2020-12）を Ajv で使えるようにする。
// `#/components/schemas/X` の参照を、同じ schema の `$defs` の参照に置き換えて組み立てる。
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

const DEFS = toLocalRefs(components.schemas) as JsonObject;
const ajv = new Ajv2020({ allErrors: true });

function validatorFor(schema: Json) {
  const local = toLocalRefs(schema) as JsonObject;
  return ajv.compile({ ...local, $defs: DEFS });
}

// 応答が定義ファイルに合うことを確かめる（TC102 の期待結果）。
async function expectContract(
  operationId: string,
  response: Response,
): Promise<void> {
  const operation = OPERATIONS.get(operationId);
  if (operation === undefined) {
    throw new Error(`定義ファイルに無い operation: ${operationId}`);
  }
  const status = String(response.status);
  const defined = Object.keys(operation.responses);
  expect(
    defined,
    `${operationId} が定義ファイルに無い状態の番号 ${status} を返した`,
  ).toContain(status);

  const content = operation.responses[status].content as JsonObject | undefined;
  if (content === undefined) {
    expect(
      await response.text(),
      `${operationId} の ${status} は本文を定めていない`,
    ).toBe("");
    return;
  }

  const contentType = (response.headers.get("content-type") ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  expect(
    Object.keys(content),
    `${operationId} の ${status} の Content-Type ${contentType}`,
  ).toContain(contentType);
  const schema = (content[contentType] as JsonObject).schema as Json;
  const body: unknown =
    contentType === "application/json"
      ? await response.json()
      : await response.text();
  const validate = validatorFor(schema);
  const ok = validate(body);
  expect(
    ok,
    `${operationId} の ${status} の本文が schema に合わない: ${ajv.errorsText(
      validate.errors,
    )}\n${JSON.stringify(body).slice(0, 2000)}`,
  ).toBe(true);
}

// ---- 試験の Web サーバ ----

// 本物の道を、新しいモジュールの組で読み込む（Web サーバの部品 `webContext` はプロセスに1つなので、
// DB の失敗を差し込むときは、組ごと作り直す）。
async function loadRoutes() {
  return {
    webContext: await import("../src/app/api/_entry/web-context"),
    home: await import("../src/app/api/app/home/route"),
    galaxy: await import("../src/app/api/app/news/galaxy/route"),
    article: await import("../src/app/api/app/news/articles/[contentId]/route"),
    opened:
      await import("../src/app/api/app/contents/[contentId]/opened/route"),
    read: await import("../src/app/api/app/contents/[contentId]/read/route"),
    saved: await import("../src/app/api/app/contents/[contentId]/saved/route"),
    englishSets: await import("../src/app/api/app/english/sets/route"),
    englishSet:
      await import("../src/app/api/app/english/sets/[contentId]/route"),
    englishAnswer:
      await import("../src/app/api/app/english/sets/[contentId]/answer/route"),
    inbox: await import("../src/app/api/app/contents/inbox/route"),
    search: await import("../src/app/api/app/contents/search/route"),
    savedList: await import("../src/app/api/app/contents/saved/route"),
    conversations: await import("../src/app/api/app/conversations/route"),
    conversation:
      await import("../src/app/api/app/conversations/[conversationId]/route"),
    questions:
      await import("../src/app/api/app/conversations/[conversationId]/questions/route"),
    stream:
      await import("../src/app/api/app/messages/[messageId]/stream/route"),
    retry: await import("../src/app/api/app/messages/[messageId]/retry/route"),
    stop: await import("../src/app/api/app/messages/[messageId]/stop/route"),
    dismiss:
      await import("../src/app/api/app/messages/[messageId]/dismiss/route"),
    register: await import("../src/app/register/route"),
    health: await import("../src/app/api/health/route"),
    newsBatch: await import("../src/app/api/inbox/batches/route"),
    learningSets: await import("../src/app/api/learning/sets/route"),
    learningSet: await import("../src/app/api/learning/sets/[date]/route"),
    learningResult:
      await import("../src/app/api/learning/sets/[date]/result/route"),
    researchReports: await import("../src/app/api/research/reports/route"),
    researchTopics: await import("../src/app/api/app/research/topics/route"),
    researchReport:
      await import("../src/app/api/app/research/reports/[contentId]/route"),
  };
}

type Routes = Awaited<ReturnType<typeof loadRoutes>>;

interface Seed {
  K1: string;
  KB: string;
  KS: string;
  KR: string;
  registrationCode: string;
  A1: number;
  E1: number;
  E2: number;
  E1_DATE: string;
  E2_DATE: string;
  // 課題 rag-eval の1週目の週報（D2 の課題 B の1週目と同じ形。CR-020）。
  R1: number;
  // A1 の会話（発言なし）。
  C1: number;
  // 作成中の応答がある会話。
  C2: number;
  // 完了した AI の発言と、失敗した AI の発言。
  doneReply: number;
  failedReply: number;
}

interface Server {
  dir: string;
  db: Database;
  routes: Routes;
  seed: Seed;
}

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

// D1 の英語のセット（DD-10 3章）: 問題 3 問（choice、text、answerType なし）、読む教材あり。
const englishPayload = (date: string, theme: string) => ({
  date,
  lane: "en",
  theme,
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
  read: reading(date),
});

function seedD1(db: Database, logDir: string): Seed {
  const clock = createFakeClock(NOW);
  const run = (sql: string, ...params: (string | number | null)[]) =>
    Number(db.prepare(sql).run(...params).lastInsertRowid);

  const { A1 } = insertD1News(db);
  const K1 = createSecret();
  run(
    "INSERT INTO device (device_name, device_key_hash, registered_at, last_used_at) VALUES ('ipad', ?, ?, ?)",
    hashSecret(K1),
    "2026-11-20T09:00:00.000+09:00",
    NOW,
  );
  const senderKeys = createSenderKeys({ db, clock });
  const KB = senderKeys.issue("brain-harness").key;
  const KS = senderKeys.issue("sharpen").key;
  const KR = senderKeys.issue("brain-research").key;
  const registrationCode = createDevices({ db, clock }).add("android").code;

  // 英語: 2026-11-30 の E2（完了済み）、2026-12-01 の E1（未完了）。
  const ingest = createIngest({
    db,
    clock,
    logger: createLogger({ process: "web", clock, dir: logDir }),
  });
  const receive = (set: Record<string, unknown>) => {
    const outcome = ingest.receive(
      "sharpen",
      ENGLISH_KIND,
      set,
      JSON.stringify(set),
    );
    if (!outcome.ok) throw new Error("英語のセットを入れられない");
  };
  const E2_DATE = "2026-11-30";
  const E1_DATE = "2026-12-01";
  clock.set("2026-11-30T06:00:00.000+09:00");
  receive(englishPayload(E2_DATE, "進行形"));
  clock.set(NOW);
  receive(englishPayload(E1_DATE, "現在形の使い方"));
  const englishId = (date: string) =>
    Number(
      db
        .prepare(
          "SELECT content_id FROM content WHERE kind = 'english' AND target_date = ?",
        )
        .get(date)?.content_id,
    );
  const E1 = englishId(E1_DATE);
  const E2 = englishId(E2_DATE);

  // 週報: 課題 rag-eval の1週目（2026-11-23 送り）。受け取りの関数で入れる（DD-10 3章 D2）。
  const research = {
    source: "brain-research",
    topicId: "rag-eval",
    topicTitle: "RAG の評価",
    week: 1,
    sentOn: "2026-11-23",
    status: "ended",
    answerMd: "評価の軸を先に決める。",
    approaches: [
      {
        title: "評価の軸を決める",
        howToMd: "正しさと網羅の2つの軸を先に決める。",
        sourceUrls: [
          "https://example.com/research/axis",
          "https://example.com/research/axis-2",
        ],
        marks: ["added", "disputed"],
        counterMd: "反対の意見。",
      },
    ],
    unknownsMd: "人の評価との差。",
    changesMd: "初めての週報",
  };
  clock.set("2026-11-23T07:00:00.000+09:00");
  const researchOutcome = ingest.receive(
    "brain-research",
    RESEARCH_KIND,
    research,
    JSON.stringify(research),
  );
  if (!researchOutcome.ok) throw new Error("週報を入れられない");
  clock.set(NOW);
  const R1 = Number(
    db
      .prepare(
        "SELECT r.content_id FROM research_report AS r JOIN research_topic AS t ON t.topic_id = r.topic_id WHERE t.topic_key = 'rag-eval' AND r.week = 1",
      )
      .get()?.content_id,
  );
  run(
    "INSERT INTO english_answer (content_id, answers_json, completed_at) VALUES (?, ?, ?)",
    E2,
    JSON.stringify([
      { no: 1, grade: "o", answer: "b" },
      { no: 2, grade: "d", answer: "walks" },
      { no: 3, grade: "x" },
    ]),
    "2026-11-30T21:15:00.000+09:00",
  );

  // 会話: A1 の会話 C1（発言なし）。
  const SPOKEN_AT = "2026-11-30T21:00:00.000+09:00";
  const conversation = () =>
    run(
      "INSERT INTO conversation (target_content_id, question_target_json, started_at, last_spoken_at) VALUES (?, ?, ?, ?)",
      A1,
      JSON.stringify({ kind: "article", contentId: A1 }),
      SPOKEN_AT,
      SPOKEN_AT,
    );
  const owner = (conversationId: number) =>
    run(
      "INSERT INTO message (conversation_id, speaker, body_md, sent_at) VALUES (?, 'owner', '要点は？', ?)",
      conversationId,
      SPOKEN_AT,
    );
  const ai = (conversationId: number, state: string, body: string) =>
    run(
      "INSERT INTO message (conversation_id, speaker, body_md, sent_at, reply_state, reply_to_message_id) VALUES (?, 'ai', ?, ?, ?, ?)",
      conversationId,
      body,
      SPOKEN_AT,
      state,
      owner(conversationId),
    );
  const C1 = conversation();
  // 409 の前提: 作成中の応答がある会話。
  const C2 = conversation();
  ai(C2, "writing", "");
  const C3 = conversation();
  const doneReply = ai(C3, "done", "要点は3つある。");
  const failedReply = ai(C3, "failed", "");

  return {
    K1,
    KB,
    KS,
    KR,
    registrationCode,
    A1,
    E1,
    E2,
    E1_DATE,
    E2_DATE,
    R1,
    C1,
    C2,
    doneReply,
    failedReply,
  };
}

const savedEnv: Record<string, string | undefined> = {};
const servers: Server[] = [];

async function startServer(): Promise<Server> {
  const dir = mkdtempSync(join(tmpdir(), "nexus-13-contract-"));
  process.env.NEXUS_ENV = "test";
  process.env.NEXUS_DATA_DIR = dir;
  process.env.NEXUS_LOG_DIR = join(dir, "logs");
  process.env.NEXUS_ORIGIN = ORIGIN;
  const db = openDatabase(databasePath(dir));
  migrate(db);
  const seed = seedD1(db, join(dir, "seed-logs"));
  vi.resetModules();
  const routes = await loadRoutes();
  const server = { dir, db, routes, seed };
  servers.push(server);
  return server;
}

function stopServer(server: Server): void {
  try {
    const { aiJobs } = server.routes.webContext.webContext();
    if (aiJobs.db.isOpen) aiJobs.close();
  } catch {
    // 部品を作れなかった組は閉じるものが無い。
  }
  if (server.db.isOpen) server.db.close();
  rmSync(server.dir, { recursive: true, force: true });
}

// DB の失敗を差し込む（DD-10 TC102 の 500 の応答）。鍵を確かめた後で、Web サーバの DB を閉じる。
// 鍵を求めない operation は、呼ぶ前に閉じる。
type Failure = "afterDeviceKey" | "afterSenderKey" | "beforeCall";

function injectDbFailure(server: Server, failure: Failure): void {
  const context = server.routes.webContext.webContext();
  const closeDb = () => {
    if (context.aiJobs.db.isOpen) context.aiJobs.db.close();
  };
  if (failure === "beforeCall") {
    closeDb();
  } else if (failure === "afterDeviceKey") {
    const keys = context.deviceApi.deviceKeys;
    const verify = keys.verify.bind(keys);
    keys.verify = (key) => {
      const result = verify(key);
      closeDb();
      return result;
    };
  } else {
    const keys = context.senderKeys;
    const verify = keys.verify.bind(keys);
    keys.verify = (key, usedInterface) => {
      const result = verify(key, usedInterface);
      closeDb();
      return result;
    };
  }
}

// ---- 要求 ----

interface Call {
  cookie?: string | null;
  origin?: string | null;
  bearer?: string | null;
  body?: string;
  headers?: Record<string, string>;
}

function request(
  server: Server,
  method: string,
  path: string,
  call: Call = {},
): Request {
  const headers = new Headers(call.headers);
  const cookie =
    call.cookie === undefined ? `nexus_device=${server.seed.K1}` : call.cookie;
  if (cookie !== null) headers.set("cookie", cookie);
  const origin = call.origin === undefined ? ORIGIN : call.origin;
  if (origin !== null && method !== "GET") headers.set("origin", origin);
  if (call.bearer !== undefined && call.bearer !== null) {
    headers.set("authorization", `Bearer ${call.bearer}`);
  }
  if (call.body !== undefined) headers.set("content-type", "application/json");
  return new Request(`${ORIGIN}${path}`, {
    method,
    headers,
    body: call.body,
  });
}

const json = (value: unknown) => JSON.stringify(value);
const params = <T extends Record<string, string>>(value: T) => ({
  params: Promise.resolve(value),
});
const NO_COOKIE: Call = { cookie: null };
const OTHER_ORIGIN: Call = { origin: "https://evil.example" };

const newsBatch = (date: string) => ({
  source: "brain-collect",
  date,
  items: [
    {
      slug: "0123456789ab",
      kind: "read",
      title: "契約のテストの記事",
      bodyMd: "本文",
      url: "https://example.com/news/contract",
      imageUrl: null,
      theme: "AI",
    },
  ],
});

// IF-005 の週報（BD-06 IF-005 3.2。方法 1 件）。
const researchReport = () => ({
  source: "brain-research",
  topicId: "second-brain",
  topicTitle: "RAG の評価",
  week: 1,
  sentOn: "2026-12-01",
  status: "active",
  answerMd: "評価の軸を先に決める。",
  approaches: [
    {
      title: "評価の軸を決める",
      howToMd: "正しさと網羅の2つの軸を先に決める。",
      sourceUrls: ["https://example.com/research/axis"],
      marks: ["added"],
      counterMd: null,
    },
  ],
  unknownsMd: "",
  changesMd: "変化なし",
});

// 本文が上限を超える JSON（埋め草だけで上限のバイト数になる）。
function oversized(base: Record<string, unknown>, limit: number): string {
  return json({ ...base, pad: "x".repeat(limit) });
}

// ---- operation ごとの組 ----

interface Case {
  status: number;
  label: string;
  call: (server: Server) => Promise<Response>;
}

interface OperationCases {
  // 500 の応答のために DB の失敗を差し込む時点。
  failure: Failure;
  // 正常の応答の組（最初の組を、DB の失敗を差し込んで 500 の応答にも使う）。
  cases: Case[];
}

const CASES: Record<string, OperationCases> = {
  getHome: {
    failure: "afterDeviceKey",
    cases: [
      {
        status: 200,
        label: "ホーム",
        call: (s) => s.routes.home.GET(request(s, "GET", "/api/app/home")),
      },
      {
        status: 401,
        label: "鍵なし",
        call: (s) =>
          s.routes.home.GET(request(s, "GET", "/api/app/home", NO_COOKIE)),
      },
    ],
  },
  getGalaxy: {
    failure: "afterDeviceKey",
    cases: [
      {
        status: 200,
        label: "2026-12-01 の図",
        call: (s) =>
          s.routes.galaxy.GET(
            request(s, "GET", "/api/app/news/galaxy?date=2026-12-01"),
          ),
      },
      {
        status: 400,
        label: "date の形が違う",
        call: (s) =>
          s.routes.galaxy.GET(
            request(s, "GET", "/api/app/news/galaxy?date=abc"),
          ),
      },
      {
        status: 401,
        label: "鍵なし",
        call: (s) =>
          s.routes.galaxy.GET(
            request(s, "GET", "/api/app/news/galaxy", NO_COOKIE),
          ),
      },
    ],
  },
  getArticle: {
    failure: "afterDeviceKey",
    cases: [
      {
        status: 200,
        label: "A1",
        call: (s) =>
          s.routes.article.GET(
            request(s, "GET", `/api/app/news/articles/${s.seed.A1}`),
            params({ contentId: String(s.seed.A1) }),
          ),
      },
      {
        status: 401,
        label: "鍵なし",
        call: (s) =>
          s.routes.article.GET(
            request(s, "GET", `/api/app/news/articles/${s.seed.A1}`, NO_COOKIE),
            params({ contentId: String(s.seed.A1) }),
          ),
      },
      {
        status: 404,
        label: "無い記事",
        call: (s) =>
          s.routes.article.GET(
            request(s, "GET", `/api/app/news/articles/${MISSING_ID}`),
            params({ contentId: String(MISSING_ID) }),
          ),
      },
    ],
  },
  listResearchTopics: {
    failure: "afterDeviceKey",
    cases: [
      {
        status: 200,
        label: "課題の一覧",
        call: (s) =>
          s.routes.researchTopics.GET(
            request(s, "GET", "/api/app/research/topics"),
          ),
      },
      {
        status: 401,
        label: "鍵なし",
        call: (s) =>
          s.routes.researchTopics.GET(
            request(s, "GET", "/api/app/research/topics", NO_COOKIE),
          ),
      },
    ],
  },
  getResearchReport: {
    failure: "afterDeviceKey",
    cases: [
      {
        status: 200,
        label: "課題 rag-eval の1週目",
        call: (s) =>
          s.routes.researchReport.GET(
            request(s, "GET", `/api/app/research/reports/${s.seed.R1}`),
            params({ contentId: String(s.seed.R1) }),
          ),
      },
      {
        status: 401,
        label: "鍵なし",
        call: (s) =>
          s.routes.researchReport.GET(
            request(
              s,
              "GET",
              `/api/app/research/reports/${s.seed.R1}`,
              NO_COOKIE,
            ),
            params({ contentId: String(s.seed.R1) }),
          ),
      },
      {
        status: 404,
        label: "週報でない内容（記事 A1）",
        call: (s) =>
          s.routes.researchReport.GET(
            request(s, "GET", `/api/app/research/reports/${s.seed.A1}`),
            params({ contentId: String(s.seed.A1) }),
          ),
      },
      {
        status: 404,
        label: "無い内容",
        call: (s) =>
          s.routes.researchReport.GET(
            request(s, "GET", `/api/app/research/reports/${MISSING_ID}`),
            params({ contentId: String(MISSING_ID) }),
          ),
      },
    ],
  },
  markOpened: {
    failure: "afterDeviceKey",
    cases: [
      {
        status: 200,
        label: "A1 を開く",
        call: (s) =>
          s.routes.opened.POST(
            request(s, "POST", `/api/app/contents/${s.seed.A1}/opened`, {
              body: "{}",
            }),
            params({ contentId: String(s.seed.A1) }),
          ),
      },
      {
        status: 401,
        label: "鍵なし",
        call: (s) =>
          s.routes.opened.POST(
            request(s, "POST", `/api/app/contents/${s.seed.A1}/opened`, {
              ...NO_COOKIE,
              body: "{}",
            }),
            params({ contentId: String(s.seed.A1) }),
          ),
      },
      {
        status: 403,
        label: "オリジンが違う",
        call: (s) =>
          s.routes.opened.POST(
            request(s, "POST", `/api/app/contents/${s.seed.A1}/opened`, {
              ...OTHER_ORIGIN,
              body: "{}",
            }),
            params({ contentId: String(s.seed.A1) }),
          ),
      },
      {
        status: 404,
        label: "無い内容",
        call: (s) =>
          s.routes.opened.POST(
            request(s, "POST", `/api/app/contents/${MISSING_ID}/opened`, {
              body: "{}",
            }),
            params({ contentId: String(MISSING_ID) }),
          ),
      },
    ],
  },
  setRead: {
    failure: "afterDeviceKey",
    cases: stateCases("read", "isRead"),
  },
  setSaved: {
    failure: "afterDeviceKey",
    cases: stateCases("saved", "isSaved"),
  },
  listEnglishSets: {
    failure: "afterDeviceKey",
    cases: listCases(
      (s, call, query) =>
        s.routes.englishSets.GET(
          request(s, "GET", `/api/app/english/sets${query}`, call),
        ),
      "",
    ),
  },
  getEnglishSet: {
    failure: "afterDeviceKey",
    cases: [
      {
        status: 200,
        label: "E2（完了済み、読む教材あり）",
        call: (s) =>
          s.routes.englishSet.GET(
            request(s, "GET", `/api/app/english/sets/${s.seed.E2}`),
            params({ contentId: String(s.seed.E2) }),
          ),
      },
      {
        status: 401,
        label: "鍵なし",
        call: (s) =>
          s.routes.englishSet.GET(
            request(s, "GET", `/api/app/english/sets/${s.seed.E1}`, NO_COOKIE),
            params({ contentId: String(s.seed.E1) }),
          ),
      },
      {
        status: 404,
        label: "無い教材",
        call: (s) =>
          s.routes.englishSet.GET(
            request(s, "GET", `/api/app/english/sets/${MISSING_ID}`),
            params({ contentId: String(MISSING_ID) }),
          ),
      },
    ],
  },
  putEnglishAnswer: {
    failure: "afterDeviceKey",
    cases: (() => {
      const answer =
        (contentId: (s: Server) => number, body: unknown, call: Call = {}) =>
        (s: Server) =>
          s.routes.englishAnswer.PUT(
            request(s, "PUT", `/api/app/english/sets/${contentId(s)}/answer`, {
              ...call,
              body: json(body),
            }),
            params({ contentId: String(contentId(s)) }),
          );
      const grades = {
        grades: [
          { no: 1, grade: "o", answer: "b" },
          { no: 2, grade: "d", answer: "walks" },
          { no: 3, grade: "x" },
        ],
      };
      return [
        {
          status: 200,
          label: "E1 を完了",
          call: answer((s) => s.seed.E1, grades),
        },
        {
          status: 400,
          label: "grades が空",
          call: answer((s) => s.seed.E1, { grades: [] }),
        },
        {
          status: 401,
          label: "鍵なし",
          call: answer((s) => s.seed.E1, grades, NO_COOKIE),
        },
        {
          status: 403,
          label: "オリジンが違う",
          call: answer((s) => s.seed.E1, grades, OTHER_ORIGIN),
        },
        {
          status: 404,
          label: "無い教材",
          call: answer(() => MISSING_ID, grades),
        },
      ];
    })(),
  },
  listInbox: {
    failure: "afterDeviceKey",
    cases: listCases(
      (s, call, query) =>
        s.routes.inbox.GET(
          request(s, "GET", `/api/app/contents/inbox${query}`, call),
        ),
      "",
    ),
  },
  searchContents: {
    failure: "afterDeviceKey",
    cases: [
      {
        status: 200,
        label: "「記事」で探す",
        call: (s) =>
          s.routes.search.GET(
            request(
              s,
              "GET",
              `/api/app/contents/search?q=${encodeURIComponent("記事")}`,
            ),
          ),
      },
      {
        status: 400,
        label: "q なし",
        call: (s) =>
          s.routes.search.GET(request(s, "GET", "/api/app/contents/search")),
      },
      {
        status: 401,
        label: "鍵なし",
        call: (s) =>
          s.routes.search.GET(
            request(
              s,
              "GET",
              `/api/app/contents/search?q=${encodeURIComponent("記事")}`,
              NO_COOKIE,
            ),
          ),
      },
    ],
  },
  listSaved: {
    failure: "afterDeviceKey",
    cases: listCases(
      (s, call, query) =>
        s.routes.savedList.GET(
          request(s, "GET", `/api/app/contents/saved${query}`, call),
        ),
      "",
    ),
  },
  listConversations: {
    failure: "afterDeviceKey",
    cases: [
      {
        status: 200,
        label: "A1 の会話",
        call: (s) =>
          s.routes.conversations.GET(
            request(
              s,
              "GET",
              `/api/app/conversations?targetContentId=${s.seed.A1}`,
            ),
          ),
      },
      {
        status: 400,
        label: "targetContentId の形が違う",
        call: (s) =>
          s.routes.conversations.GET(
            request(s, "GET", "/api/app/conversations?targetContentId=abc"),
          ),
      },
      {
        status: 401,
        label: "鍵なし",
        call: (s) =>
          s.routes.conversations.GET(
            request(s, "GET", "/api/app/conversations", NO_COOKIE),
          ),
      },
    ],
  },
  createConversation: {
    failure: "afterDeviceKey",
    cases: (() => {
      const create =
        (body: (s: Server) => unknown, call: Call = {}) =>
        (s: Server) =>
          s.routes.conversations.POST(
            request(s, "POST", "/api/app/conversations", {
              ...call,
              body: json(body(s)),
            }),
          );
      const target = (s: Server) => ({
        target: { kind: "article", contentId: s.seed.A1 },
      });
      return [
        { status: 201, label: "A1 の会話を作る", call: create(target) },
        {
          status: 400,
          label: "target の kind が値に無い",
          call: create((s) => ({
            target: { kind: "unknown", contentId: s.seed.A1 },
          })),
        },
        { status: 401, label: "鍵なし", call: create(target, NO_COOKIE) },
        {
          status: 403,
          label: "オリジンが違う",
          call: create(target, OTHER_ORIGIN),
        },
      ];
    })(),
  },
  getConversation: {
    failure: "afterDeviceKey",
    cases: [
      {
        status: 200,
        label: "C2（作成中の応答あり）",
        call: (s) =>
          s.routes.conversation.GET(
            request(s, "GET", `/api/app/conversations/${s.seed.C2}`),
            params({ conversationId: String(s.seed.C2) }),
          ),
      },
      {
        status: 401,
        label: "鍵なし",
        call: (s) =>
          s.routes.conversation.GET(
            request(s, "GET", `/api/app/conversations/${s.seed.C1}`, NO_COOKIE),
            params({ conversationId: String(s.seed.C1) }),
          ),
      },
      {
        status: 404,
        label: "無い会話",
        call: (s) =>
          s.routes.conversation.GET(
            request(s, "GET", `/api/app/conversations/${MISSING_ID}`),
            params({ conversationId: String(MISSING_ID) }),
          ),
      },
    ],
  },
  postQuestion: {
    failure: "afterDeviceKey",
    cases: (() => {
      const ask =
        (
          conversationId: (s: Server) => number,
          text: string,
          call: Call = {},
        ) =>
        (s: Server) =>
          s.routes.questions.POST(
            request(
              s,
              "POST",
              `/api/app/conversations/${conversationId(s)}/questions`,
              { ...call, body: json({ text }) },
            ),
            params({ conversationId: String(conversationId(s)) }),
          );
      const C1 = (s: Server) => s.seed.C1;
      return [
        {
          status: 202,
          label: "C1 に質問",
          call: ask(C1, "この記事の要点は？"),
        },
        { status: 400, label: "text が空", call: ask(C1, "") },
        { status: 401, label: "鍵なし", call: ask(C1, "要点は？", NO_COOKIE) },
        {
          status: 403,
          label: "オリジンが違う",
          call: ask(C1, "要点は？", OTHER_ORIGIN),
        },
        {
          status: 404,
          label: "無い会話",
          call: ask(() => MISSING_ID, "要点は？"),
        },
        {
          status: 409,
          label: "作成中の応答がある C2",
          call: ask((s) => s.seed.C2, "続きは？"),
        },
      ];
    })(),
  },
  streamReply: {
    failure: "afterDeviceKey",
    cases: [
      {
        status: 200,
        label: "完了した応答（state を送って閉じる）",
        call: (s) =>
          s.routes.stream.GET(
            request(s, "GET", `/api/app/messages/${s.seed.doneReply}/stream`),
            params({ messageId: String(s.seed.doneReply) }),
          ),
      },
      {
        status: 401,
        label: "鍵なし",
        call: (s) =>
          s.routes.stream.GET(
            request(
              s,
              "GET",
              `/api/app/messages/${s.seed.doneReply}/stream`,
              NO_COOKIE,
            ),
            params({ messageId: String(s.seed.doneReply) }),
          ),
      },
      {
        status: 404,
        label: "無い発言",
        call: (s) =>
          s.routes.stream.GET(
            request(s, "GET", `/api/app/messages/${MISSING_ID}/stream`),
            params({ messageId: String(MISSING_ID) }),
          ),
      },
    ],
  },
  retryReply: {
    failure: "afterDeviceKey",
    cases: replyActionCases("retry"),
  },
  stopReply: {
    failure: "afterDeviceKey",
    cases: replyActionCases("stop"),
  },
  dismissReply: {
    failure: "afterDeviceKey",
    cases: replyActionCases("dismiss"),
  },
  openRegistration: {
    failure: "beforeCall",
    cases: [
      {
        status: 303,
        label: "有効な登録コード",
        call: (s) =>
          s.routes.register.GET(
            request(
              s,
              "GET",
              `/register?code=${encodeURIComponent(s.seed.registrationCode)}`,
              NO_COOKIE,
            ),
          ),
      },
      {
        status: 303,
        label: "通らない登録コード",
        call: (s) =>
          s.routes.register.GET(
            request(s, "GET", "/register?code=not-a-code", NO_COOKIE),
          ),
      },
    ],
  },
  getHealth: {
    failure: "beforeCall",
    cases: [
      {
        status: 200,
        label: "鍵なしで状態",
        call: async (s) => s.routes.health.GET(),
      },
    ],
  },
  postNewsBatch: {
    failure: "afterSenderKey",
    cases: (() => {
      const post =
        (body: string, bearer: (s: Server) => string | null) => (s: Server) =>
          s.routes.newsBatch.POST(
            request(s, "POST", "/api/inbox/batches", {
              cookie: null,
              origin: null,
              bearer: bearer(s),
              body,
            }),
          );
      const KB = (s: Server) => s.seed.KB;
      return [
        {
          status: 200,
          label: "記事 1 件",
          call: post(json(newsBatch("2026-12-02")), KB),
        },
        { status: 400, label: "JSON でない本文", call: post("not json", KB) },
        {
          status: 401,
          label: "sharpen の鍵",
          call: post(json(newsBatch("2026-12-02")), (s) => s.seed.KS),
        },
        {
          status: 413,
          label: "1 MiB を超える本文",
          call: post(
            oversized(newsBatch("2026-12-02"), NEWS_BATCH_LIMIT_BYTES),
            KB,
          ),
        },
      ];
    })(),
  },
  postEnglishSet: {
    failure: "afterSenderKey",
    cases: (() => {
      const post =
        (body: string, bearer: (s: Server) => string | null) => (s: Server) =>
          s.routes.learningSets.POST(
            request(s, "POST", "/api/learning/sets", {
              cookie: null,
              origin: null,
              bearer: bearer(s),
              body,
            }),
          );
      const KS = (s: Server) => s.seed.KS;
      const payload = englishPayload("2026-12-02", "未来形");
      return [
        {
          status: 200,
          label: "2026-12-02 のセット",
          call: post(json(payload), KS),
        },
        {
          status: 400,
          label: "問題の無いセット",
          call: post(json({ ...payload, problems: [] }), KS),
        },
        {
          status: 401,
          label: "brain-harness の鍵",
          call: post(json(payload), (s) => s.seed.KB),
        },
        {
          status: 413,
          label: "256 KiB を超える本文",
          call: post(oversized(payload, ENGLISH_SET_LIMIT_BYTES), KS),
        },
      ];
    })(),
  },
  postResearchReport: {
    failure: "afterSenderKey",
    cases: (() => {
      const post =
        (body: string, bearer: (s: Server) => string | null) => (s: Server) =>
          s.routes.researchReports.POST(
            request(s, "POST", "/api/research/reports", {
              cookie: null,
              origin: null,
              bearer: bearer(s),
              body,
            }),
          );
      const KR = (s: Server) => s.seed.KR;
      const payload = researchReport();
      return [
        {
          status: 200,
          label: "課題 second-brain の1週目",
          call: post(json(payload), KR),
        },
        {
          status: 400,
          label: "answerMd の無い週報",
          call: post(json({ ...payload, answerMd: undefined }), KR),
        },
        {
          status: 401,
          label: "brain-harness の鍵",
          call: post(json(payload), (s) => s.seed.KB),
        },
        {
          status: 413,
          label: "256 KiB を超える本文",
          call: post(oversized(payload, RESEARCH_REPORT_LIMIT_BYTES), KR),
        },
      ];
    })(),
  },
  getEnglishSetForSender: {
    failure: "afterSenderKey",
    cases: senderReadCases("set"),
  },
  getEnglishResult: {
    failure: "afterSenderKey",
    cases: senderReadCases("result"),
  },
};

function stateCases(name: "read" | "saved", field: string): Case[] {
  const put =
    (contentId: (s: Server) => number, body: unknown, call: Call = {}) =>
    (s: Server) => {
      const route = name === "read" ? s.routes.read : s.routes.saved;
      return route.PUT(
        request(s, "PUT", `/api/app/contents/${contentId(s)}/${name}`, {
          ...call,
          body: json(body),
        }),
        params({ contentId: String(contentId(s)) }),
      );
    };
  const A1 = (s: Server) => s.seed.A1;
  return [
    {
      status: 200,
      label: `A1 の ${field} を真に`,
      call: put(A1, { [field]: true }),
    },
    {
      status: 400,
      label: `${field} が真偽値でない`,
      call: put(A1, { [field]: "yes" }),
    },
    {
      status: 401,
      label: "鍵なし",
      call: put(A1, { [field]: true }, NO_COOKIE),
    },
    {
      status: 403,
      label: "オリジンが違う",
      call: put(A1, { [field]: true }, OTHER_ORIGIN),
    },
    {
      status: 404,
      label: "無い内容",
      call: put(() => MISSING_ID, { [field]: true }),
    },
  ];
}

function listCases(
  get: (s: Server, call: Call, query: string) => Promise<Response>,
  base: string,
): Case[] {
  return [
    { status: 200, label: "最初のページ", call: (s) => get(s, {}, base) },
    {
      status: 400,
      label: "limit が 51",
      call: (s) => get(s, {}, `${base}?limit=51`),
    },
    { status: 401, label: "鍵なし", call: (s) => get(s, NO_COOKIE, base) },
  ];
}

function replyActionCases(action: "retry" | "stop" | "dismiss"): Case[] {
  const post =
    (messageId: (s: Server) => number, call: Call = {}) =>
    (s: Server) =>
      s.routes[action].POST(
        request(s, "POST", `/api/app/messages/${messageId(s)}/${action}`, {
          ...call,
          body: "{}",
        }),
        params({ messageId: String(messageId(s)) }),
      );
  const failed = (s: Server) => s.seed.failedReply;
  return [
    { status: 200, label: "失敗した応答", call: post(failed) },
    { status: 401, label: "鍵なし", call: post(failed, NO_COOKIE) },
    { status: 403, label: "オリジンが違う", call: post(failed, OTHER_ORIGIN) },
    { status: 404, label: "無い発言", call: post(() => MISSING_ID) },
  ];
}

function senderReadCases(kind: "set" | "result"): Case[] {
  const get =
    (date: (s: Server) => string, bearer: (s: Server) => string | null) =>
    (s: Server) => {
      const suffix = kind === "set" ? "" : "/result";
      const path = `/api/learning/sets/${date(s)}${suffix}?lane=en`;
      const route =
        kind === "set" ? s.routes.learningSet : s.routes.learningResult;
      return route.GET(
        request(s, "GET", path, { cookie: null, bearer: bearer(s) }),
        params({ date: date(s) }),
      );
    };
  const KS = (s: Server) => s.seed.KS;
  // セットは E1、答えは完了済みの E2 を読む。
  const found = (s: Server) =>
    kind === "set" ? s.seed.E1_DATE : s.seed.E2_DATE;
  return [
    { status: 200, label: "届いた日付", call: get(found, KS) },
    { status: 400, label: "date の形が違う", call: get(() => "abc", KS) },
    {
      status: 401,
      label: "brain-harness の鍵",
      call: get(found, (s) => s.seed.KB),
    },
    {
      status: 404,
      label: "セットの無い日付",
      call: get(() => "2020-01-01", KS),
    },
  ];
}

// ---- テスト ----

let server: Server;

beforeAll(async () => {
  for (const name of ENV_NAMES) savedEnv[name] = process.env[name];
  // 共通の前提: 日本時間の今を 2026-12-01 08:00 にする（タイマーは本物のまま）。
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW));
  server = await startServer();
});

afterAll(() => {
  for (const s of servers) stopServer(s);
  vi.useRealTimers();
  for (const name of ENV_NAMES) {
    if (savedEnv[name] === undefined) delete process.env[name];
    else process.env[name] = savedEnv[name];
  }
});

describe("TC102 全ての operation の応答が openapi.yaml に合う（DD-04 1章 実装との一致、DD-04 3.4、ADR-021）", () => {
  it("TC102 DD-04 2章の全ての operation（定義ファイルの全ての operationId）を確かめる", () => {
    expect([...OPERATIONS.keys()].sort()).toEqual(Object.keys(CASES).sort());
    expect(OPERATIONS.size).toBe(29);
    expect(OPERATIONS.get("postResearchReport")).toMatchObject({
      method: "post",
      path: "/api/research/reports",
    });
    expect(OPERATIONS.get("listResearchTopics")).toMatchObject({
      method: "get",
      path: "/api/app/research/topics",
    });
    expect(OPERATIONS.get("getResearchReport")).toMatchObject({
      method: "get",
      path: "/api/app/research/reports/{contentId}",
    });
  });

  it("TC102 定義ファイルに書いた全ての状態の番号（正常、4xx、500）を、どの operation でも起こして確かめる", () => {
    for (const [operationId, operation] of OPERATIONS) {
      const exercised = new Set(
        (CASES[operationId]?.cases ?? []).map((c) => String(c.status)),
      );
      exercised.add("500");
      expect(
        [...exercised].sort(),
        `${operationId} で起こす状態の番号`,
      ).toEqual(Object.keys(operation.responses).sort());
    }
  });

  it("TC102 照合は、定義ファイルに合わない本文を断る（照合が空振りしていないこと）", () => {
    const home = OPERATIONS.get("getHome")?.responses["200"].content as
      JsonObject | undefined;
    const homeSchema = (home?.["application/json"] as JsonObject).schema;
    expect(validatorFor(homeSchema)({})).toBe(false);
    expect(
      validatorFor({ $ref: "#/components/schemas/Error" })({
        error: { code: "teapot", message: "x", messageId: "MSG-019" },
      }),
    ).toBe(false);
    expect(
      validatorFor({ $ref: "#/components/schemas/Error" })({
        error: { code: "internal", message: "x", messageId: "MSG-019" },
      }),
    ).toBe(true);
  });

  for (const operationId of OPERATIONS.keys()) {
    const entry = CASES[operationId];
    if (entry === undefined) continue;

    it(`TC102 ${operationId} の正常の応答と 4xx の応答の本文が schema に合い、状態の番号が定義ファイルにある`, async () => {
      for (const c of entry.cases) {
        const response = await c.call(server);
        expect(response.status, `${operationId}（${c.label}）`).toBe(c.status);
        await expectContract(operationId, response);
      }
    });

    it(`TC102 ${operationId} に DB の失敗を差し込むと 500 で、本文が schema に合う${
      operationId === "streamReply" ? "（送り始める前の失敗）" : ""
    }`, async () => {
      const failing = await startServer();
      injectDbFailure(failing, entry.failure);
      const response = await entry.cases[0].call(failing);
      expect(response.status, `${operationId}（DB の失敗）`).toBe(500);
      await expectContract(operationId, response);
    });
  }
});
