import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type ContentListApiContext,
  listInbox,
  listSaved,
} from "../src/app/api/_entry/content-list";
import {
  markOpened,
  setRead,
  setSaved,
} from "../src/app/api/_entry/content-state";
import { createDeviceApiContext } from "../src/app/api/_entry/device-api";
import { createDeviceKeyVerifier } from "../src/server/auth/device-key";
import { createContents } from "../src/server/contents";
import {
  type Database,
  databasePath,
  openDatabase,
} from "../src/server/db/connection";
import { createFakeClock, type FakeClock } from "../src/server/shared/clock";
import { createLogger } from "../src/server/shared/logger";
import { formatMessage } from "../src/server/shared/messages";
import { decodeCursor, encodeCursor } from "../src/server/shared/paging";
import { createSecret, hashSecret } from "../src/server/shared/secret";
import {
  NOW,
  type D1News,
  insertArticle,
  insertD1News,
  insertDelivery,
  migrate,
} from "./fixtures/news";

// 07-contents の実装単位2: 一覧の続き（DD-02 3章 P03）と `listInbox`、`listSaved`。
// FN-005、FN-006、FN-017、FN-019、DD-01 M17。受け入れ基準は TC25、TC27、TC76。

const ORIGIN = "http://localhost:48401";
const BASE = `${ORIGIN}/api/app/contents`;

let dir: string;
let db: Database;
let clock: FakeClock;
let K1: string;
let context: ContentListApiContext;

function setUp(withD1: boolean): D1News | null {
  dir = mkdtempSync(join(tmpdir(), "nexus-07-list-"));
  clock = createFakeClock(NOW);
  db = openDatabase(databasePath(dir));
  migrate(db);
  const d1 = withD1 ? insertD1News(db) : null;
  K1 = createSecret();
  db.prepare(
    "INSERT INTO device (device_name, device_key_hash, registered_at, last_used_at) VALUES ('ipad', ?, ?, ?)",
  ).run(hashSecret(K1), "2026-11-20T09:00:00.000+09:00", NOW);
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
  return d1;
}

afterEach(() => {
  if (db.isOpen) db.close();
  rmSync(dir, { recursive: true, force: true });
});

// 英語の教材（`content` の kind english と `english_set`）を入れる。
function insertEnglish(
  targetDate: string,
  receivedAt: string,
  title: string,
): number {
  const result = db
    .prepare(
      "INSERT INTO content (kind, title, target_date, received_at) VALUES ('english', ?, ?, ?)",
    )
    .run(title, targetDate, receivedAt);
  const contentId = Number(result.lastInsertRowid);
  db.prepare(
    "INSERT INTO english_set (content_id, learning_theme, lesson_body_md, problems_json, raw_payload_json) VALUES (?, ?, ?, ?, ?)",
  ).run(contentId, title, "本文", JSON.stringify([{ no: 1 }]), "{}");
  return contentId;
}

function listRequest(
  segment: "inbox" | "saved",
  query: Record<string, string> = {},
  cookie: string | null = `nexus_device=${K1}`,
): Request {
  const url = new URL(`${BASE}/${segment}`);
  for (const [name, value] of Object.entries(query)) {
    url.searchParams.set(name, value);
  }
  const headers = new Headers();
  if (cookie !== null) headers.set("cookie", cookie);
  return new Request(url, { method: "GET", headers });
}

interface ContentPage {
  items: {
    contentId: number;
    kind: string;
    title: string;
    targetDate: string;
    receivedAt: string;
    isNew: boolean;
    isRead: boolean;
    isSaved: boolean;
    savedAt: string | null;
  }[];
  nextCursor: string | null;
}

async function callInbox(
  query: Record<string, string> = {},
): Promise<ContentPage> {
  const response = await listInbox(context)(listRequest("inbox", query));
  expect(response.status).toBe(200);
  return (await response.json()) as ContentPage;
}

async function callSavedList(
  query: Record<string, string> = {},
): Promise<ContentPage> {
  const response = await listSaved(context)(listRequest("saved", query));
  expect(response.status).toBe(200);
  return (await response.json()) as ContentPage;
}

function stateContext() {
  return { deviceApi: context.deviceApi, contents: context.contents };
}

function contentRequest(
  contentId: number,
  segment: "opened" | "read" | "saved",
  body?: unknown,
): Request {
  const headers = new Headers({
    cookie: `nexus_device=${K1}`,
    origin: ORIGIN,
  });
  if (body !== undefined) headers.set("content-type", "application/json");
  return new Request(`${BASE}/${contentId}/${segment}`, {
    method: segment === "opened" ? "POST" : "PUT",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const route = (contentId: number) => ({
  params: Promise.resolve({ contentId: String(contentId) }),
});

async function open(contentId: number): Promise<void> {
  const response = await markOpened(stateContext())(
    contentRequest(contentId, "opened"),
    route(contentId),
  );
  expect(response.status).toBe(200);
}

async function read(contentId: number, isRead: boolean): Promise<void> {
  const response = await setRead(stateContext())(
    contentRequest(contentId, "read", { isRead }),
    route(contentId),
  );
  expect(response.status).toBe(200);
}

async function save(contentId: number, isSaved: boolean): Promise<void> {
  const response = await setSaved(stateContext())(
    contentRequest(contentId, "saved", { isSaved }),
    route(contentId),
  );
  expect(response.status).toBe(200);
}

function readState(
  contentId: number,
): { is_read: number; read_at: string | null } | undefined {
  return db
    .prepare("SELECT is_read, read_at FROM content_state WHERE content_id = ?")
    .get(contentId) as { is_read: number; read_at: string | null } | undefined;
}

describe("TC25 開いたが未読の A1 を既読にし、未読に戻す（FN-005、BD-02 3章 既読）", () => {
  let d1: D1News;
  beforeEach(() => {
    d1 = setUp(true) as D1News;
  });

  it("既読の後は Inbox に A1 が出ず、未読に戻した後は出る", async () => {
    const { A1 } = d1;
    await open(A1);
    expect((await callInbox()).items.map((item) => item.contentId)).toContain(
      A1,
    );

    clock.set("2026-12-01T08:10:00.000+09:00");
    await read(A1, true);
    expect(readState(A1)).toEqual({
      is_read: 1,
      read_at: "2026-12-01T08:10:00.000+09:00",
    });
    expect(
      (await callInbox()).items.map((item) => item.contentId),
    ).not.toContain(A1);

    await read(A1, false);
    expect(readState(A1)).toEqual({ is_read: 0, read_at: null });
    const after = await callInbox();
    const a1 = after.items.find((item) => item.contentId === A1);
    expect(a1).toMatchObject({ isNew: false, isRead: false });
  });
});

describe("TC27 A1 と E1 を保存し、A1 の保存を外す（FN-006、FN-019）", () => {
  let d1: D1News;
  beforeEach(() => {
    d1 = setUp(true) as D1News;
  });

  it("1回目の一覧は2件（保存した日時の新しい順）、外した後は E1 の1件", async () => {
    const { A1 } = d1;
    const E1 = insertEnglish(
      "2026-12-01",
      "2026-12-01T06:00:00.000+09:00",
      "英語の教材 E1",
    );

    await save(A1, true);
    clock.set("2026-12-01T08:05:00.000+09:00");
    await save(E1, true);

    const first = await callSavedList();
    expect(first.nextCursor).toBeNull();
    expect(first.items).toEqual([
      {
        contentId: E1,
        kind: "english",
        title: "英語の教材 E1",
        targetDate: "2026-12-01",
        receivedAt: "2026-12-01T06:00:00.000+09:00",
        isNew: true,
        isRead: false,
        isSaved: true,
        savedAt: "2026-12-01T08:05:00.000+09:00",
      },
      {
        contentId: A1,
        kind: "news",
        title: "今日の記事 A1",
        targetDate: "2026-12-01",
        receivedAt: "2026-12-01T07:00:00.000+09:00",
        isNew: true,
        isRead: false,
        isSaved: true,
        savedAt: NOW,
      },
    ]);

    await save(A1, false);
    const second = await callSavedList();
    expect(second.items.map((item) => item.contentId)).toEqual([E1]);
    expect(second.nextCursor).toBeNull();
  });
});

describe("TC76 AC15 のデータで listInbox（FN-017、DD-02 FN-017）", () => {
  beforeEach(() => {
    setUp(false);
  });

  it("4件で既読の記事は出ず、isNew は開いていない記事1件と教材1件だけ。届いた日時の新しい順", async () => {
    const delivery = insertDelivery(
      db,
      "2026-12-01",
      "2026-12-01T07:00:00.000+09:00",
      3,
    );
    const article = (title: string, receivedAt: string) =>
      insertArticle(db, {
        title,
        theme: "AI",
        guideMd: `${title} の案内`,
        targetDate: receivedAt.slice(0, 10),
        receivedAt,
        deliveryId: delivery,
      });
    const notOpened = article(
      "開いていない記事",
      "2026-12-01T07:00:00.000+09:00",
    );
    const openedUnread = article(
      "開いたが未読の記事",
      "2026-11-30T07:00:00.000+09:00",
    );
    const readArticle = article("既読の記事", "2026-11-29T07:00:00.000+09:00");
    const englishNotOpened = insertEnglish(
      "2026-12-01",
      "2026-12-01T06:00:00.000+09:00",
      "開いていない教材",
    );
    const englishOpened = insertEnglish(
      "2026-11-30",
      "2026-11-30T06:00:00.000+09:00",
      "開いたが未完了の教材",
    );
    await open(openedUnread);
    await open(readArticle);
    await read(readArticle, true);
    await open(englishOpened);

    const page = await callInbox();
    expect(page.nextCursor).toBeNull();
    expect(
      page.items.map((item) => [item.contentId, item.kind, item.isNew]),
    ).toEqual([
      [notOpened, "news", true],
      [englishNotOpened, "english", true],
      [openedUnread, "news", false],
      [englishOpened, "english", false],
    ]);
    expect(page.items.every((item) => !item.isRead)).toBe(true);
  });
});

describe("DD-02 3章 P03 一覧の続き", () => {
  let d1: D1News;
  beforeEach(() => {
    d1 = setUp(true) as D1News;
  });

  it("listInbox を limit 2 で、nextCursor で続けて読むと、届いた日時と ID の大きい順に全件を1回ずつ返す", async () => {
    const { A1, A2, A3, P1, P2, P8 } = d1;
    const seen: number[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const query: Record<string, string> = { limit: "2" };
      if (cursor !== null) query.cursor = cursor;
      const page = await callInbox(query);
      seen.push(...page.items.map((item) => item.contentId));
      cursor = page.nextCursor;
      pages += 1;
      if (cursor !== null) expect(page.items).toHaveLength(2);
    } while (cursor !== null && pages < 10);
    // 6件をちょうど 2 件ずつ読むと、3ページ目には続きが無い。
    expect(pages).toBe(3);
    expect(seen).toEqual([A3, A2, A1, P2, P1, P8]);
  });

  it("limit を省くと 30 件まで、上限は 50 件", async () => {
    const delivery = insertDelivery(
      db,
      "2026-11-01",
      "2026-11-01T07:00:00.000+09:00",
      60,
    );
    for (let index = 0; index < 60; index += 1) {
      insertArticle(db, {
        title: `記事 ${index}`,
        theme: "AI",
        guideMd: "案内",
        targetDate: "2026-11-01",
        receivedAt: "2026-11-01T07:00:00.000+09:00",
        deliveryId: delivery,
      });
    }
    const byDefault = await callInbox();
    expect(byDefault.items).toHaveLength(30);
    expect(byDefault.nextCursor).not.toBeNull();
    const max = await callInbox({ limit: "50" });
    expect(max.items).toHaveLength(50);
    const rest = await callInbox({
      limit: "50",
      cursor: max.nextCursor as string,
    });
    expect(rest.items).toHaveLength(16);
    expect(rest.nextCursor).toBeNull();
  });

  it("listSaved は保存した日時が同じなら ID の大きい順で、続きを返す", async () => {
    const { A1, A2, A3 } = d1;
    await save(A1, true);
    await save(A3, true);
    clock.set("2026-12-01T08:01:00.000+09:00");
    await save(A2, true);

    const first = await callSavedList({ limit: "2" });
    expect(first.items.map((item) => item.contentId)).toEqual([A2, A3]);
    expect(first.nextCursor).not.toBeNull();
    expect(decodeCursor(first.nextCursor as string)).toEqual({
      value: NOW,
      id: A3,
    });
    const second = await callSavedList({
      limit: "2",
      cursor: first.nextCursor as string,
    });
    expect(second.items.map((item) => item.contentId)).toEqual([A1]);
    expect(second.nextCursor).toBeNull();
  });

  it.each([
    ["cursor が base64url でない", { cursor: "a+b/" }],
    [
      "cursor の中身が組でない",
      { cursor: Buffer.from("[1]").toString("base64url") },
    ],
    [
      "cursor の中身が JSON でない",
      { cursor: Buffer.from("x").toString("base64url") },
    ],
    [
      "cursor の ID が整数でない",
      { cursor: Buffer.from('["a",1.5]').toString("base64url") },
    ],
    ["cursor が 200 文字を超える", { cursor: "a".repeat(201) }],
    ["limit が 0", { limit: "0" }],
    ["limit が 51", { limit: "51" }],
    ["limit が数でない", { limit: "abc" }],
  ])("%s は 400 と MSG-019（DD-06 E01）", async (_name, query) => {
    for (const [segment, handler] of [
      ["inbox", listInbox],
      ["saved", listSaved],
    ] as const) {
      const response = await handler(context)(listRequest(segment, query));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: {
          code: "bad_request",
          message: formatMessage("MSG-019"),
          messageId: "MSG-019",
        },
      });
    }
  });

  it("端末の鍵が無ければ 401 と MSG-020（DD-06 E03）", async () => {
    for (const [segment, handler] of [
      ["inbox", listInbox],
      ["saved", listSaved],
    ] as const) {
      const response = await handler(context)(listRequest(segment, {}, null));
      expect(response.status).toBe(401);
      expect(
        ((await response.json()) as { error: { messageId: string } }).error
          .messageId,
      ).toBe("MSG-020");
    }
  });

  it("一覧を読む途中の失敗は 500 と MSG-019（DD-06 E16、読むだけの操作）", async () => {
    const cursor = encodeCursor({ value: NOW, id: 1 });
    const failing = {
      ...context,
      contents: {
        ...context.contents,
        listInbox: () => {
          throw new Error("予期しない失敗");
        },
      },
    };
    const response = await listInbox(failing)(listRequest("inbox", { cursor }));
    expect(response.status).toBe(500);
    expect(
      ((await response.json()) as { error: { messageId: string } }).error
        .messageId,
    ).toBe("MSG-019");
  });
});
