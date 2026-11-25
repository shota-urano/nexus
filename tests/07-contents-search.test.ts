import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type ContentListApiContext,
  searchContents,
} from "../src/app/api/_entry/content-list";
import { createDeviceApiContext } from "../src/app/api/_entry/device-api";
import { createDeviceKeyVerifier } from "../src/server/auth/device-key";
import { createContents, toSearchCondition } from "../src/server/contents";
import {
  type Database,
  databasePath,
  openDatabase,
} from "../src/server/db/connection";
import { searchIndexBody } from "../src/server/ingest";
import { replaceSearchIndexRow } from "../src/server/repositories/search-index";
import { createFakeClock } from "../src/server/shared/clock";
import { createLogger } from "../src/server/shared/logger";
import { formatMessage } from "../src/server/shared/messages";
import { createSecret, hashSecret } from "../src/server/shared/secret";
import { NOW, insertArticle, insertDelivery, migrate } from "./fixtures/news";

// 07-contents の実装単位3: 検索 `searchContents`（NFKC と小文字、3文字以上は FTS5、2文字以下は部分の一致）。
// FN-018、DD-01 M17、DD-02 FN-018、DD-03 3章。受け入れ基準は TC77、TC78、TC79。
// 検索の索引は、受け取り（DD-02 3章 P08）と同じ関数（`searchIndexBody`、`replaceSearchIndexRow`）で作る。

const ORIGIN = "http://localhost:48401";
const URL_SEARCH = `${ORIGIN}/api/app/contents/search`;
const TODAY = "2026-12-01";

let dir: string;
let db: Database;
let K1: string;
let context: ContentListApiContext;
let deliveryId: number;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-07-search-"));
  const clock = createFakeClock(NOW);
  db = openDatabase(databasePath(dir));
  migrate(db);
  K1 = createSecret();
  db.prepare(
    "INSERT INTO device (device_name, device_key_hash, registered_at, last_used_at) VALUES ('ipad', ?, ?, ?)",
  ).run(hashSecret(K1), "2026-11-20T09:00:00.000+09:00", NOW);
  deliveryId = insertDelivery(db, TODAY, "2026-12-01T06:00:00.000+09:00", 0);
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

// 記事を入れ、見出しと案内で検索の索引を作る（DD-02 3章 P08）。
function addArticle(title: string, guideMd: string, receivedAt: string) {
  const contentId = insertArticle(db, {
    title,
    theme: "AI",
    guideMd,
    targetDate: TODAY,
    receivedAt,
    deliveryId,
  });
  replaceSearchIndexRow(db, contentId, searchIndexBody(title, guideMd));
  return contentId;
}

// 英語の教材を入れ、見出しと教材の本文で検索の索引を作る（DD-02 3章 P08）。
function addEnglish(title: string, lessonBodyMd: string, receivedAt: string) {
  const result = db
    .prepare(
      "INSERT INTO content (kind, title, target_date, received_at) VALUES ('english', ?, ?, ?)",
    )
    .run(title, TODAY, receivedAt);
  const contentId = Number(result.lastInsertRowid);
  db.prepare(
    "INSERT INTO english_set (content_id, learning_theme, lesson_body_md, problems_json, raw_payload_json) VALUES (?, ?, ?, ?, ?)",
  ).run(contentId, title, lessonBodyMd, JSON.stringify([{ no: 1 }]), "{}");
  replaceSearchIndexRow(db, contentId, searchIndexBody(title, lessonBodyMd));
  return contentId;
}

// 会話と発言を入れる（検索の索引には入らない。RD-03 R19）。
function addConversation(body: string) {
  const conversationId = Number(
    db
      .prepare(
        "INSERT INTO conversation (started_at, last_spoken_at) VALUES (?, ?)",
      )
      .run(NOW, NOW).lastInsertRowid,
  );
  db.prepare(
    "INSERT INTO message (conversation_id, speaker, body_md, sent_at) VALUES (?, 'owner', ?, ?)",
  ).run(conversationId, body, NOW);
}

function searchRequest(
  query: Record<string, string>,
  cookie: string | null = `nexus_device=${K1}`,
): Request {
  const url = new URL(URL_SEARCH);
  for (const [name, value] of Object.entries(query)) {
    url.searchParams.set(name, value);
  }
  const headers = new Headers();
  if (cookie !== null) headers.set("cookie", cookie);
  return new Request(url, { method: "GET", headers });
}

interface ContentPage {
  items: { contentId: number; kind: string; title: string }[];
  nextCursor: string | null;
}

async function search(
  query: Record<string, string>,
): Promise<{ status: number; json: unknown }> {
  const response = await searchContents(context)(searchRequest(query));
  return { status: response.status, json: await response.json() };
}

async function found(q: string): Promise<number[]> {
  const { status, json } = await search({ q });
  expect(status).toBe(200);
  return (json as ContentPage).items.map((item) => item.contentId);
}

const BAD_REQUEST = {
  error: {
    code: "bad_request",
    message: formatMessage("MSG-019"),
    messageId: "MSG-019",
  },
};

describe("TC77 AC16 のデータで searchContents（FN-018、DD-02 FN-018、DD-03 3章）", () => {
  it("「半導体」「規制」「be動詞」はそれぞれの内容が見つかり、「宇宙」は空", async () => {
    const semiconductor = addArticle(
      "半導体の新しい工場",
      "工場の建設が始まった。",
      "2026-12-01T06:00:00.000+09:00",
    );
    const regulation = addArticle(
      "各国の動き",
      "新しい規制の案が出た。",
      "2026-12-01T06:00:01.000+09:00",
    );
    const english = addEnglish(
      "Lesson 1",
      "今日は be動詞 を学ぶ。",
      "2026-12-01T07:00:00.000+09:00",
    );
    addConversation("宇宙の話をしたい");

    expect(await found("半導体")).toEqual([semiconductor]);
    // 「規制」は2文字なので部分の一致で探す。
    expect(toSearchCondition("規制")).toEqual({
      match: null,
      likes: ["%規制%"],
    });
    expect(await found("規制")).toEqual([regulation]);
    expect(await found("be動詞")).toEqual([english]);
    // 会話は探さない（RD-03 R19）。
    expect(await found("宇宙")).toEqual([]);
  });
});

describe("TC78 大文字と小文字、全角と半角を区別せず、全ての言葉を含むものだけ（Q-081 の答え）", () => {
  it("「ａｉ　規制」「Ai 規制」は見つかり、「AI 宇宙」は空", async () => {
    const target = addArticle(
      "AI 規制の議論",
      "各国で議論が進む。",
      "2026-12-01T06:00:00.000+09:00",
    );
    addArticle(
      "AI の新しい道具",
      "便利になる。",
      "2026-12-01T06:00:01.000+09:00",
    );
    addArticle("規制の緩和", "手続きが減る。", "2026-12-01T06:00:02.000+09:00");

    expect(await found("ａｉ　規制")).toEqual([target]);
    expect(await found("Ai 規制")).toEqual([target]);
    expect(await found("AI 宇宙")).toEqual([]);
  });
});

describe("TC79 q の長さの境界と空白だけ（DD-02 2章 C06）", () => {
  it("200 文字は 200、201 文字と全角の空白だけは 400 と MSG-019", async () => {
    addArticle("見出し", "案内", "2026-12-01T06:00:00.000+09:00");
    expect((await search({ q: "あ".repeat(200) })).status).toBe(200);
    expect(await search({ q: "あ".repeat(201) })).toEqual({
      status: 400,
      json: BAD_REQUEST,
    });
    expect(await search({ q: "　　" })).toEqual({
      status: 400,
      json: BAD_REQUEST,
    });
  });

  it("q が無いか空なら 400 と MSG-019", async () => {
    expect(await search({})).toEqual({ status: 400, json: BAD_REQUEST });
    expect(await search({ q: "" })).toEqual({ status: 400, json: BAD_REQUEST });
  });
});

describe("FN-018 の探し方の細部（DD-02 FN-018 手順 2〜4）", () => {
  it("言葉を NFKC で正規化して小文字にし、3文字以上は FTS5 の句、2文字以下は逃がした LIKE にする", () => {
    expect(toSearchCondition(' ＡＢＣ  a"b"c  %_  \\x ')).toEqual({
      match: '"abc" "a""b""c"',
      likes: ["%\\%\\_%", "%\\\\x%"],
    });
    expect(toSearchCondition(" 　 ")).toBeNull();
  });

  it("2文字以下の言葉の % と _ は文字として探す", async () => {
    const percent = addArticle(
      "100% の達成",
      "案内",
      "2026-12-01T06:00:00.000+09:00",
    );
    addArticle("1000 の達成", "案内", "2026-12-01T06:00:01.000+09:00");
    expect(await found("0%")).toEqual([percent]);
    expect(await found("_")).toEqual([]);
  });

  it("二重引用符を含む3文字以上の言葉も探せる", async () => {
    const quoted = addArticle(
      '彼は"OK"と言った',
      "案内",
      "2026-12-01T06:00:00.000+09:00",
    );
    expect(await found('"ok"')).toEqual([quoted]);
  });

  it("見つかった内容を届いた日時と ID の大きい順に、nextCursor で続けて返す", async () => {
    const ids = [
      addArticle("規制 1", "案内", "2026-12-01T06:00:00.000+09:00"),
      addArticle("規制 2", "案内", "2026-12-01T06:00:00.000+09:00"),
      addEnglish("規制 3", "本文", "2026-12-01T07:00:00.000+09:00"),
      addArticle("規制 4", "案内", "2026-12-01T05:00:00.000+09:00"),
    ];
    addArticle("関係の無い記事", "案内", "2026-12-01T08:00:00.000+09:00");

    const seen: number[] = [];
    let cursor: string | null = null;
    do {
      const query: Record<string, string> = { q: "規制", limit: "3" };
      if (cursor !== null) query.cursor = cursor;
      const { status, json } = await search(query);
      expect(status).toBe(200);
      const page = json as ContentPage;
      seen.push(...page.items.map((item) => item.contentId));
      cursor = page.nextCursor;
    } while (cursor !== null);
    expect(seen).toEqual([ids[2], ids[1], ids[0], ids[3]]);
  });

  it("limit と cursor の形が違えば 400 と MSG-019", async () => {
    expect(await search({ q: "規制", limit: "51" })).toEqual({
      status: 400,
      json: BAD_REQUEST,
    });
    expect(await search({ q: "規制", cursor: "!!" })).toEqual({
      status: 400,
      json: BAD_REQUEST,
    });
  });

  it("端末の鍵が無ければ 401 と MSG-020（DD-06 E03）", async () => {
    const response = await searchContents(context)(
      searchRequest({ q: "規制" }, null),
    );
    expect(response.status).toBe(401);
    expect(
      ((await response.json()) as { error: { messageId: string } }).error
        .messageId,
    ).toBe("MSG-020");
  });

  it("検索の途中の失敗は 500 と MSG-019（DD-06 E16、読むだけの操作）", async () => {
    const failing = {
      ...context,
      contents: {
        ...context.contents,
        searchContents: () => {
          throw new Error("予期しない失敗");
        },
      },
    };
    const response = await searchContents(failing)(
      searchRequest({ q: "規制" }),
    );
    expect(response.status).toBe(500);
    expect(
      ((await response.json()) as { error: { messageId: string } }).error
        .messageId,
    ).toBe("MSG-019");
  });
});
