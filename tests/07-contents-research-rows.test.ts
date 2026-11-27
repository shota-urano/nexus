import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type ContentListApiContext,
  listInbox,
  listSaved,
  searchContents,
} from "../src/app/api/_entry/content-list";
import { setRead, setSaved } from "../src/app/api/_entry/content-state";
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
import { createFakeClock, type FakeClock } from "../src/server/shared/clock";
import { createLogger } from "../src/server/shared/logger";
import { createSecret, hashSecret } from "../src/server/shared/secret";
import { NOW, insertD1News, migrate } from "./fixtures/news";

// 07-contents の実装単位5（CR-020）: Inbox、Explore、Library に週報が出る。API は変えない。
// 受け入れ基準の DD-10 TC144（結合。FN-017、FN-018、FN-019 と週報、DD-02 3章 P08）。
// 前提は「共通＋D2」（DD-10 3章）。D2 は受け取りの関数（`postResearchReport`）で入れる。
// 課題 A の2週目の方法の見出しに「ノート」、そのためにはだけに「索引」を含め、2週目を保存する。

const ORIGIN = "http://localhost:48401";
const BASE = `${ORIGIN}/api/app/contents`;
const URL_REPORTS = "http://127.0.0.1:48400/api/research/reports";

let dir: string;
let db: Database;
let clock: FakeClock;
let K1: string;
let KR: string;
let context: ContentListApiContext;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-07-research-"));
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
  const logger = createLogger({
    process: "web",
    clock,
    dir: join(dir, "logs"),
  });
  context = {
    deviceApi: createDeviceApiContext({
      clock,
      logger,
      origin: ORIGIN,
      deviceKeys: createDeviceKeyVerifier({ db, clock }),
    }),
    contents: createContents({ db, clock }),
  };
});

afterEach(() => {
  if (db.isOpen) db.close();
  rmSync(dir, { recursive: true, force: true });
});

// ---- D2 を入れる ----

interface Approach {
  title: string;
  howToMd: string;
  sourceUrls: string[];
  marks: string[];
  counterMd: string | null;
}

function approach(patch: Partial<Approach> & { title: string }): Approach {
  return {
    howToMd: `${patch.title}のやり方。`,
    sourceUrls: ["https://example.com/research/source"],
    marks: [],
    counterMd: null,
    ...patch,
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
  const row = db
    .prepare(
      "SELECT r.content_id FROM research_report AS r JOIN research_topic AS t ON t.topic_id = r.topic_id WHERE t.topic_key = ? AND r.week = ?",
    )
    .get(report.topicId, report.week) as { content_id: number } | undefined;
  if (row === undefined) throw new Error("週報が残っていない");
  return row.content_id;
}

function stateRequest(
  contentId: number,
  segment: "read" | "saved",
  body: unknown,
): Request {
  return new Request(`${BASE}/${contentId}/${segment}`, {
    method: "PUT",
    headers: {
      cookie: `nexus_device=${K1}`,
      origin: ORIGIN,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

const route = (contentId: number) => ({
  params: Promise.resolve({ contentId: String(contentId) }),
});

const stateContext = () => ({
  deviceApi: context.deviceApi,
  contents: context.contents,
});

async function markRead(contentId: number): Promise<void> {
  const response = await setRead(stateContext())(
    stateRequest(contentId, "read", { isRead: true }),
    route(contentId),
  );
  expect(response.status).toBe(200);
}

async function markSaved(contentId: number): Promise<void> {
  const response = await setSaved(stateContext())(
    stateRequest(contentId, "saved", { isSaved: true }),
    route(contentId),
  );
  expect(response.status).toBe(200);
}

interface D2 {
  a1: number;
  a2: number;
  b1: number;
}

// D2（DD-10 3章）。課題 A（second-brain、進行中）の1週目（2026-11-24 送り、既読）と2週目
// （2026-12-01 送り、未読。印が added、more_sources、disputed の方法が1件ずつと印の無い方法1件）。
// 課題 B（rag-eval、終了）の1週目（2026-11-23 送り、既読）。
// TC144 の前提: 課題 A の2週目の方法の見出しに「ノート」、そのためにはだけに「索引」。2週目を保存した。
async function insertD2(): Promise<D2> {
  const b1 = await receive("2026-11-23T07:00:00.000+09:00", {
    topicId: "rag-eval",
    topicTitle: "RAG の評価",
    week: 1,
    sentOn: "2026-11-23",
    status: "ended",
    answerMd: "評価の軸を先に決める。",
    approaches: [approach({ title: "評価の軸を決める" })],
    unknownsMd: "人の評価との差。",
    changesMd: "変化なし",
  });
  const a1 = await receive("2026-11-24T07:00:00.000+09:00", {
    topicId: "second-brain",
    topicTitle: "第二の脳の作り方",
    week: 1,
    sentOn: "2026-11-24",
    status: "active",
    answerMd: "メモを毎日まとめる。",
    approaches: [approach({ title: "毎日まとめる" })],
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
      approach({ title: "ノートを分けて書く", marks: ["added"] }),
      approach({
        title: "週に1回見直す",
        howToMd: "見直すときに索引を作る。",
        marks: ["more_sources"],
      }),
      approach({
        title: "道具を1つにする",
        marks: ["disputed"],
        counterMd: "道具を分けたほうが続くという意見もある。",
      }),
      approach({ title: "人に話す" }),
    ],
    unknownsMd: "どこまで細かく分けるか。",
    changesMd: "方法を3件足した。",
  });
  clock.set(NOW);
  await markRead(a1);
  await markRead(b1);
  await markSaved(a2);
  return { a1, a2, b1 };
}

// ---- 呼ぶ ----

interface ContentPage {
  items: {
    contentId: number;
    kind: string;
    title: string;
    isRead: boolean;
    isSaved: boolean;
  }[];
  nextCursor: string | null;
}

function getRequest(path: string, query: Record<string, string> = {}) {
  const url = new URL(`${BASE}/${path}`);
  for (const [name, value] of Object.entries(query)) {
    url.searchParams.set(name, value);
  }
  return new Request(url, {
    method: "GET",
    headers: { cookie: `nexus_device=${K1}` },
  });
}

async function page(response: Response): Promise<ContentPage> {
  expect(response.status).toBe(200);
  return (await response.json()) as ContentPage;
}

const callInbox = async () =>
  page(await listInbox(context)(getRequest("inbox")));
const callSaved = async () =>
  page(await listSaved(context)(getRequest("saved")));
const callSearch = async (q: string) =>
  page(await searchContents(context)(getRequest("search", { q })));

describe("TC144 週報が Inbox、Explore、Library に出る（FN-017、FN-018、FN-019、DD-02 3章 P08、CR-020）", () => {
  it("Inbox に未読の週報が kind research で出る", async () => {
    const d2 = await insertD2();
    const inbox = await callInbox();
    const item = inbox.items.find((i) => i.contentId === d2.a2);
    expect(item).toBeDefined();
    expect(item?.kind).toBe("research");
    expect(item?.isRead).toBe(false);
    expect(item?.title).toBe("第二の脳の作り方（2週目）");
  });

  it("「ノート」で2週目が見つかり、「索引」では見つからない（そのためにはは探さない。RD-03 R19）", async () => {
    const d2 = await insertD2();
    const note = await callSearch("ノート");
    expect(note.items.map((i) => i.contentId)).toEqual([d2.a2]);
    expect(note.items[0].kind).toBe("research");
    const index = await callSearch("索引");
    expect(index.items.map((i) => i.contentId)).toEqual([]);
  });

  it("Library に保存した2週目が kind research で出る", async () => {
    const d2 = await insertD2();
    const saved = await callSaved();
    expect(saved.items.map((i) => i.contentId)).toEqual([d2.a2]);
    expect(saved.items[0].kind).toBe("research");
    expect(saved.items[0].isSaved).toBe(true);
  });
});
