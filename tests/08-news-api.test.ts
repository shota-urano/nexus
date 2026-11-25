import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { markOpened } from "../src/app/api/_entry/content-state";
import { createDeviceApiContext } from "../src/app/api/_entry/device-api";
import {
  type NewsApiContext,
  getArticle,
  getGalaxy,
} from "../src/app/api/_entry/news";
import { createDeviceKeyVerifier } from "../src/server/auth/device-key";
import { createContents } from "../src/server/contents";
import {
  type Database,
  databasePath,
  openDatabase,
} from "../src/server/db/connection";
import type { ArticleDetail, Galaxy } from "../src/server/kinds/news/view";
import { createNewsView } from "../src/server/kinds/news/view";
import { createFakeClock } from "../src/server/shared/clock";
import { createLogger } from "../src/server/shared/logger";
import { formatMessage } from "../src/server/shared/messages";
import { createSecret, hashSecret } from "../src/server/shared/secret";
import {
  type D1News,
  NOW,
  insertD1News,
  insertRelation,
  migrate,
} from "./fixtures/news";

// 08-news の実装単位1: 記事の図 `getGalaxy` と記事の案内 `getArticle`（FN-003、FN-004、DD-01 M15、
// DD-02 FN-003・FN-004）。受け入れ基準は DD-10 TC19、TC20、TC22、TC23。
// 前提の「共通」は D1（DD-10 3章）を入れた一時の DB で、日本時間の今を 2026-12-01 08:00 とし、
// 端末 `ipad` の鍵 K1 を Cookie に持つ状態である。

const ORIGIN = "http://localhost:48401";
const URL_GALAXY = `${ORIGIN}/api/app/news/galaxy`;
const urlArticle = (id: string | number) =>
  `${ORIGIN}/api/app/news/articles/${id}`;

let dir: string;
let db: Database;
let K1: string;
let context: NewsApiContext;
let contents: ReturnType<typeof createContents>;
let d1: D1News;
let E1: number;
let E2: number;

function insertEnglish(targetDate: string, receivedAt: string): number {
  const contentId = Number(
    db
      .prepare(
        "INSERT INTO content (kind, title, target_date, received_at) VALUES ('english', ?, ?, ?)",
      )
      .run(`英語 ${targetDate}`, targetDate, receivedAt).lastInsertRowid,
  );
  db.prepare(
    "INSERT INTO english_set (content_id, learning_theme, lesson_body_md, problems_json, raw_payload_json) VALUES (?, ?, ?, ?, ?)",
  ).run(contentId, "テーマ", "本文", JSON.stringify([{ no: 1 }]), "{}");
  return contentId;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-08-news-"));
  const clock = createFakeClock(NOW);
  db = openDatabase(databasePath(dir));
  migrate(db);
  K1 = createSecret();
  db.prepare(
    "INSERT INTO device (device_name, device_key_hash, registered_at, last_used_at) VALUES ('ipad', ?, ?, ?)",
  ).run(hashSecret(K1), "2026-11-20T09:00:00.000+09:00", NOW);
  d1 = insertD1News(db);
  E1 = insertEnglish("2026-12-01", "2026-12-01T07:30:00.000+09:00");
  E2 = insertEnglish("2026-11-30", "2026-11-30T07:30:00.000+09:00");
  // TC19 の前提: A1→A2、A1→P1 が有効、A2→A3 が無効。
  insertRelation(db, d1.A1, d1.A2, "follow_up");
  insertRelation(db, d1.A1, d1.P1, "background");
  insertRelation(db, d1.A2, d1.A3, "same_actor", 0);

  const logger = createLogger({
    process: "web",
    clock,
    dir: join(dir, "logs"),
  });
  contents = createContents({ db, clock });
  context = {
    deviceApi: createDeviceApiContext({
      clock,
      logger,
      origin: ORIGIN,
      deviceKeys: createDeviceKeyVerifier({ db, clock }),
    }),
    news: createNewsView({ db }),
  };
});

afterEach(() => {
  if (db.isOpen) db.close();
  rmSync(dir, { recursive: true, force: true });
});

function getRequest(
  url: string,
  cookie: string | null = `nexus_device=${K1}`,
): Request {
  const headers = new Headers();
  if (cookie !== null) headers.set("cookie", cookie);
  return new Request(url, { method: "GET", headers });
}

async function galaxy(
  date?: string,
  cookie?: string | null,
): Promise<{ status: number; json: unknown }> {
  const url = new URL(URL_GALAXY);
  if (date !== undefined) url.searchParams.set("date", date);
  const response = await getGalaxy(context)(getRequest(url.href, cookie));
  return { status: response.status, json: await response.json() };
}

async function article(
  id: string | number,
  cookie?: string | null,
): Promise<{ status: number; json: unknown }> {
  const response = await getArticle(context)(
    getRequest(urlArticle(id), cookie),
    { params: Promise.resolve({ contentId: String(id) }) },
  );
  return { status: response.status, json: await response.json() };
}

function errorOf(json: unknown) {
  return (
    json as { error: { code: string; messageId: string; message: string } }
  ).error;
}

describe("getGalaxy（FN-003）", () => {
  it("TC19 date を省くと今日の記事と有効な関係と関係の先の記事を返す", async () => {
    const { status, json } = await galaxy();
    expect(status).toBe(200);
    const body = json as Galaxy;
    expect(body.date).toBe("2026-12-01");
    expect(
      body.nodes.map((node) => node.contentId).sort((a, b) => a - b),
    ).toEqual([d1.A1, d1.A2, d1.A3, d1.P1].sort((a, b) => a - b));
    // 記事でないノード（英語の教材）は0個。
    const englishIds = new Set([E1, E2]);
    expect(body.nodes.filter((node) => englishIds.has(node.contentId))).toEqual(
      [],
    );
    // 線は有効な2本だけで、無効の A2→A3 は出ない。
    expect(
      body.links
        .map((link) => [
          link.fromContentId,
          link.toContentId,
          link.relationType,
        ])
        .sort(),
    ).toEqual(
      [
        [d1.A1, d1.A2, "follow_up"],
        [d1.A1, d1.P1, "background"],
      ].sort(),
    );
    // テーマは今日の記事のテーマ（P1 のテーマは数えない）。
    expect([...body.themes].sort()).toEqual(["AI", "半導体"].sort());
    // 日付の選択肢は記事のある日の新しい順（英語だけの日は含めない）。
    expect(body.availableDates).toEqual([
      "2026-12-01",
      "2026-11-28",
      "2026-11-23",
    ]);
  });

  it("TC19 ノードは見出し、テーマ、画像の URL、対象日、新着と既読の印を持つ", async () => {
    contents.markOpened(d1.A1);
    contents.setRead(d1.A1, true);
    const body = (await galaxy()).json as Galaxy;
    const a1 = body.nodes.find((node) => node.contentId === d1.A1);
    expect(a1).toEqual({
      contentId: d1.A1,
      title: "今日の記事 A1",
      theme: "AI",
      imageUrl: null,
      targetDate: "2026-12-01",
      isNew: false,
      isRead: true,
    });
    const p1 = body.nodes.find((node) => node.contentId === d1.P1);
    expect(p1).toMatchObject({
      targetDate: "2026-11-28",
      isNew: true,
      isRead: false,
    });
  });

  it("TC19 date を渡すとその日の図を返す（関係の先の今日の記事を含む）", async () => {
    const { status, json } = await galaxy("2026-11-28");
    expect(status).toBe(200);
    const body = json as Galaxy;
    expect(body.date).toBe("2026-11-28");
    expect(
      body.nodes.map((node) => node.contentId).sort((a, b) => a - b),
    ).toEqual([d1.P1, d1.P2, d1.A1].sort((a, b) => a - b));
    expect(body.links).toEqual([
      { fromContentId: d1.A1, toContentId: d1.P1, relationType: "background" },
    ]);
    expect([...body.themes].sort()).toEqual(["AI", "半導体"].sort());
  });

  it("TC20 記事の無い日は 200 で nodes が空", async () => {
    const { status, json } = await galaxy("2026-11-30");
    expect(status).toBe(200);
    const body = json as Galaxy;
    expect(body.date).toBe("2026-11-30");
    expect(body.nodes).toEqual([]);
    expect(body.links).toEqual([]);
    expect(body.themes).toEqual([]);
    expect(body.availableDates).toEqual([
      "2026-12-01",
      "2026-11-28",
      "2026-11-23",
    ]);
  });

  it("TC20 明日は 400 と MSG-019", async () => {
    const { status, json } = await galaxy("2026-12-02");
    expect(status).toBe(400);
    expect(errorOf(json)).toEqual({
      code: "bad_request",
      messageId: "MSG-019",
      message: formatMessage("MSG-019"),
    });
  });

  it("TC20 日付の形でない値と存在しない日付は 400", async () => {
    for (const date of [
      "",
      "2026-1-01",
      "2026-02-30",
      "today",
      "2026-12-01x",
    ]) {
      const { status, json } = await galaxy(date);
      expect(status, date).toBe(400);
      expect(errorOf(json).messageId).toBe("MSG-019");
    }
  });

  it("日付の選択肢は新しい順に 60 件まで", async () => {
    const insert = db.prepare(
      "INSERT INTO content (kind, title, target_date, received_at) VALUES ('news', ?, ?, ?)",
    );
    for (let day = 1; day <= 70; day += 1) {
      const date = new Date(Date.UTC(2026, 0, day)).toISOString().slice(0, 10);
      insert.run(`記事 ${date}`, date, "2026-11-01T07:00:00.000+09:00");
    }
    const body = (await galaxy()).json as Galaxy;
    expect(body.availableDates).toHaveLength(60);
    expect(body.availableDates[0]).toBe("2026-12-01");
    expect([...body.availableDates]).toEqual(
      [...body.availableDates].sort().reverse(),
    );
  });

  it("鍵が無ければ 401 と MSG-020", async () => {
    const { status, json } = await galaxy(undefined, null);
    expect(status).toBe(401);
    expect(errorOf(json).messageId).toBe("MSG-020");
  });

  it("DB が使えなければ 500 と MSG-019", async () => {
    const verify = context.deviceApi.deviceKeys.verify;
    context.deviceApi.deviceKeys.verify = (key) => {
      const result = verify(key);
      db.close();
      return result;
    };
    const { status, json } = await galaxy();
    expect(status).toBe(500);
    expect(errorOf(json)).toMatchObject({
      code: "internal",
      messageId: "MSG-019",
    });
  });
});

describe("getArticle（FN-004）", () => {
  it("TC22 getArticle（A1）の後に markOpened（A1）で、案内と関係と開いた日時を返す", async () => {
    const { status, json } = await article(d1.A1);
    expect(status).toBe(200);
    const body = json as ArticleDetail;
    expect(body).toMatchObject({
      contentId: d1.A1,
      title: "今日の記事 A1",
      theme: "AI",
      guideMd: "今日の記事 A1 の案内",
      sourceUrl: `https://example.com/news/${d1.A1}`,
      imageUrl: null,
      targetDate: "2026-12-01",
      receivedAt: "2026-12-01T07:00:00.000+09:00",
      state: {
        contentId: d1.A1,
        isNew: true,
        isRead: false,
        isSaved: false,
        savedAt: null,
      },
    });
    const related = [...body.related].sort(
      (a, b) => a.node.contentId - b.node.contentId,
    );
    expect(
      related.map((item) => ({
        id: item.node.contentId,
        relationType: item.relationType,
        reason: item.reason,
        direction: item.direction,
      })),
    ).toEqual(
      [
        {
          id: d1.P1,
          relationType: "background",
          reason: "前の判定の根拠",
          direction: "from",
        },
        {
          id: d1.A2,
          relationType: "follow_up",
          reason: "前の判定の根拠",
          direction: "from",
        },
      ].sort((a, b) => a.id - b.id),
    );
    const p1 = related.find((item) => item.node.contentId === d1.P1);
    expect(p1?.node).toEqual({
      contentId: d1.P1,
      title: "3日前の記事 P1",
      theme: "AI",
      imageUrl: null,
      targetDate: "2026-11-28",
      isNew: true,
      isRead: false,
    });

    // 案内を出した後に画面が markOpened を呼ぶ（DD-02 FN-004 手順 4）。
    const opened = await markOpened({ deviceApi: context.deviceApi, contents })(
      new Request(`${ORIGIN}/api/app/contents/${d1.A1}/opened`, {
        method: "POST",
        headers: { cookie: `nexus_device=${K1}`, origin: ORIGIN },
      }),
      { params: Promise.resolve({ contentId: String(d1.A1) }) },
    );
    expect(opened.status).toBe(200);
    const row = db
      .prepare(
        "SELECT opened_at, is_read FROM content_state WHERE content_id = ?",
      )
      .get(d1.A1);
    expect(row?.opened_at).toBe(NOW);
    expect(Number(row?.is_read)).toBe(0);

    // 開いた後の案内は新着でない。
    const after = (await article(d1.A1)).json as ArticleDetail;
    expect(after.state.isNew).toBe(false);
    expect(after.state.isRead).toBe(false);
  });

  it("TC22 関係の先から読むと direction は to で、無効の関係は出ない", async () => {
    const body = (await article(d1.A2)).json as ArticleDetail;
    expect(
      body.related.map((item) => [item.node.contentId, item.direction]),
    ).toEqual([[d1.A1, "to"]]);
  });

  it("TC23 英語の内容 ID と無い内容 ID は、どちらも 404 と MSG-002", async () => {
    for (const id of [E1, 999_999]) {
      const { status, json } = await article(id);
      expect(status, String(id)).toBe(404);
      expect(errorOf(json)).toEqual({
        code: "not_found",
        messageId: "MSG-002",
        message: formatMessage("MSG-002"),
      });
    }
  });

  it("内容 ID の形でない値も 404 と MSG-002", async () => {
    for (const id of ["abc", "0", "-1", "1.5", "99999999999999999999"]) {
      const { status, json } = await article(id);
      expect(status, id).toBe(404);
      expect(errorOf(json).messageId).toBe("MSG-002");
    }
  });

  it("鍵が無ければ 401 と MSG-020", async () => {
    const { status, json } = await article(d1.A1, null);
    expect(status).toBe(401);
    expect(errorOf(json).messageId).toBe("MSG-020");
  });
});
