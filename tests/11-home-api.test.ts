import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDeviceApiContext } from "../src/app/api/_entry/device-api";
import { type HomeApiContext, getHome } from "../src/app/api/_entry/home";
import { dismissReply } from "../src/app/api/_entry/reply-action";
import { createDeviceKeyVerifier } from "../src/server/auth/device-key";
import { createChat } from "../src/server/chat";
import {
  type Database,
  databasePath,
  openDatabase,
} from "../src/server/db/connection";
import { type Home, createHomeView } from "../src/server/home";
import { type FakeClock, createFakeClock } from "../src/server/shared/clock";
import { createLogger } from "../src/server/shared/logger";
import { createSecret, hashSecret } from "../src/server/shared/secret";
import {
  NOW,
  insertArticle,
  insertDelivery,
  insertRelation,
  migrate,
} from "./fixtures/news";

// 11-home の実装単位1: ホームの表示 `getHome`（FN-020、DD-01 M19、DD-02 FN-020、BD-11 M01・M02）。
// 受け入れ基準は DD-10 TC80、TC81、TC82、TC83、TC73。
// 日本時間の今は 2026-12-01 08:00（DD-10 2章の共通）。端末 `ipad` の鍵 K1 を Cookie に持つ。
// データはテストごとに空の DB に、そのテストの前提の分だけを入れる。

const ORIGIN = "http://localhost:48401";
const URL_HOME = `${ORIGIN}/api/app/home`;
const TODAY = "2026-12-01";
const HOURS_AGO_23 = "2026-11-30T09:00:00.000+09:00";
const HOURS_AGO_25 = "2026-11-30T07:00:00.000+09:00";
const HOUR_AGO_1 = "2026-12-01T07:00:00.000+09:00";

let dir: string;
let db: Database;
let clock: FakeClock;
let K1: string;
let context: HomeApiContext;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-11-home-"));
  clock = createFakeClock(NOW);
  db = openDatabase(databasePath(dir));
  migrate(db);
  K1 = createSecret();
  db.prepare(
    "INSERT INTO device (device_name, device_key_hash, registered_at, last_used_at) VALUES ('ipad', ?, ?, ?)",
  ).run(hashSecret(K1), "2026-11-20T09:00:00.000+09:00", NOW);
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

async function callHome(
  cookie: string | null = `nexus_device=${K1}`,
): Promise<{ status: number; json: unknown }> {
  const headers = new Headers();
  if (cookie !== null) headers.set("cookie", cookie);
  const response = await getHome(context)(
    new Request(URL_HOME, { method: "GET", headers }),
  );
  return { status: response.status, json: await response.json() };
}

async function home(): Promise<Home> {
  const { status, json } = await callHome();
  expect(status).toBe(200);
  return json as Home;
}

// 配信元ごとの受け取りの記録。
function insertSenderDelivery(
  sender: "brain-harness" | "sharpen",
  result: "accepted" | "rejected",
  targetDate: string = TODAY,
): number {
  return Number(
    db
      .prepare(
        "INSERT INTO delivery (sender, target_date, received_at, item_count, result, rejection_reason) VALUES (?, ?, ?, 0, ?, ?)",
      )
      .run(
        sender,
        targetDate,
        `${targetDate}T06:00:00.000+09:00`,
        result,
        result === "rejected" ? "形が違う" : null,
      ).lastInsertRowid,
  );
}

function insertEnglish(targetDate: string, learningTheme: string): number {
  const contentId = Number(
    db
      .prepare(
        "INSERT INTO content (kind, title, target_date, received_at) VALUES ('english', ?, ?, ?)",
      )
      .run(`英語 ${targetDate}`, targetDate, `${targetDate}T07:30:00.000+09:00`)
      .lastInsertRowid,
  );
  db.prepare(
    "INSERT INTO english_set (content_id, learning_theme, lesson_body_md, problems_json, raw_payload_json) VALUES (?, ?, '本文', ?, '{}')",
  ).run(contentId, learningTheme, JSON.stringify([{ no: 1 }]));
  return contentId;
}

function complete(contentId: number): void {
  db.prepare(
    "INSERT INTO english_answer (content_id, answers_json, completed_at) VALUES (?, '[]', ?)",
  ).run(contentId, HOUR_AGO_1);
}

// 開いた。`read` なら「読んだ」も押した。
function open(contentId: number, read = false): void {
  db.prepare(
    "INSERT INTO content_state (content_id, opened_at, is_read, read_at) VALUES (?, ?, ?, ?)",
  ).run(contentId, HOUR_AGO_1, read ? 1 : 0, read ? HOUR_AGO_1 : null);
}

// 会話と本人の発言と AI の発言を作り、AI の発言ID を返す。
function insertReply(replyState: string): number {
  const conversationId = Number(
    db
      .prepare(
        "INSERT INTO conversation (started_at, last_spoken_at) VALUES (?, ?)",
      )
      .run(HOURS_AGO_25, HOURS_AGO_25).lastInsertRowid,
  );
  const ownerId = Number(
    db
      .prepare(
        "INSERT INTO message (conversation_id, speaker, body_md, sent_at) VALUES (?, 'owner', '質問', ?)",
      )
      .run(conversationId, HOURS_AGO_25).lastInsertRowid,
  );
  return Number(
    db
      .prepare(
        "INSERT INTO message (conversation_id, speaker, body_md, sent_at, reply_state, reply_to_message_id) VALUES (?, 'ai', '', ?, ?, ?)",
      )
      .run(conversationId, HOURS_AGO_25, replyState, ownerId).lastInsertRowid,
  );
}

function insertRun(input: {
  purpose: "answer" | "relate";
  state: "done" | "failed";
  attempt: number;
  finishedAt: string;
  replyMessageId?: number;
  relateDeliveryId?: number;
}): void {
  db.prepare(
    `INSERT INTO ai_run (purpose, state, reply_message_id, relate_delivery_id, attempt, created_at, started_at, finished_at, failure_reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.purpose,
    input.state,
    input.replyMessageId ?? null,
    input.relateDeliveryId ?? null,
    input.attempt,
    input.finishedAt,
    input.finishedAt,
    input.finishedAt,
    input.state === "failed" ? "AI_UNAVAILABLE" : null,
  );
}

describe("ホームの表示 getHome（FN-020）", () => {
  it("TC80 newCount 3、unreadCount 6、picks は関係の数の多い順に3件、learning は一番新しい教材", async () => {
    // AC17 のデータ。今日の記事 T1〜T4 と前の日の記事 P。
    const deliveryId = insertDelivery(
      db,
      TODAY,
      `${TODAY}T07:00:00.000+09:00`,
      4,
    );
    const article = (title: string, targetDate: string, receivedAt: string) =>
      insertArticle(db, {
        title,
        theme: "AI",
        guideMd: `${title} の案内`,
        targetDate,
        receivedAt,
        deliveryId,
      });
    const P = article(
      "前の日の記事 P",
      "2026-11-30",
      "2026-11-30T07:00:00.000+09:00",
    );
    // T4 を T3 より先に届けた（関係の数を誤って数えると、同じ数で届いた順の T4 が先に出る）。
    const T4 = article("今日の記事 T4", TODAY, "2026-12-01T07:00:01.000+09:00");
    const T1 = article("今日の記事 T1", TODAY, "2026-12-01T07:00:02.000+09:00");
    const T2 = article("今日の記事 T2", TODAY, "2026-12-01T07:00:03.000+09:00");
    const T3 = article("今日の記事 T3", TODAY, "2026-12-01T07:00:04.000+09:00");
    // 関係の数: T1 は 3、T2 は 2、T3 は 1、T4 は 0（無効の関係は数えない）。
    insertRelation(db, T1, T2);
    insertRelation(db, T3, T1);
    insertRelation(db, T1, P);
    insertRelation(db, P, T2);
    insertRelation(db, T4, P, "related_topic", 0);
    // 開いていない記事3件（T1、T2、T4）と、開いたが未読の記事2件（T3、P）。
    open(T3);
    open(P);
    // 開いたが未完了の教材1件（一番新しい）。前の日の教材は完了して既読。
    const older = insertEnglish("2026-11-30", "前の日のテーマ");
    open(older, true);
    complete(older);
    const latest = insertEnglish(TODAY, "今日のテーマ");
    open(latest);

    const result = await home();
    expect(result.newCount).toBe(3);
    expect(result.unreadCount).toBe(6);
    expect(result.picks).toEqual([
      { contentId: T1, title: "今日の記事 T1", theme: "AI", imageUrl: null },
      { contentId: T2, title: "今日の記事 T2", theme: "AI", imageUrl: null },
      { contentId: T3, title: "今日の記事 T3", theme: "AI", imageUrl: null },
    ]);
    expect(result.learning).toEqual({
      contentId: latest,
      learningTheme: "今日のテーマ",
      isCompleted: false,
    });
    expect(result.ai).toEqual({ writingCount: 0, hasFailure: false });
  });

  it("関係の数が同じ記事は届いた日時の古い順。一番新しい教材が完了していれば isCompleted が真。作成中の AI の発言を数える", async () => {
    const deliveryId = insertDelivery(
      db,
      TODAY,
      `${TODAY}T07:00:00.000+09:00`,
      4,
    );
    const article = (title: string, receivedAt: string) =>
      insertArticle(db, {
        title,
        theme: "半導体",
        guideMd: "案内",
        targetDate: TODAY,
        receivedAt,
        deliveryId,
      });
    const late = article("遅い", "2026-12-01T07:00:09.000+09:00");
    const early = article("早い", "2026-12-01T07:00:01.000+09:00");
    const middle = article("中ほど", "2026-12-01T07:00:05.000+09:00");
    const last = article("最後", "2026-12-01T07:00:10.000+09:00");
    db.prepare("UPDATE article SET image_url = ? WHERE content_id = ?").run(
      "https://example.com/early.png",
      early,
    );
    const E = insertEnglish(TODAY, "完了したテーマ");
    complete(E);
    insertReply("writing");
    insertReply("writing");
    insertReply("done");

    const result = await home();
    expect(result.picks.map((pick) => pick.contentId)).toEqual([
      early,
      middle,
      late,
    ]);
    expect(result.picks.map((pick) => pick.contentId)).not.toContain(last);
    expect(result.picks[0].imageUrl).toBe("https://example.com/early.png");
    expect(result.learning).toEqual({
      contentId: E,
      learningTheme: "完了したテーマ",
      isCompleted: true,
    });
    expect(result.ai.writingCount).toBe(2);
  });

  it("TC81 今日の brain-harness の受け取りが rejected だけなら、06:59 は notices が空、07:00 は MSG-015 だけ", async () => {
    insertSenderDelivery("brain-harness", "rejected");
    insertSenderDelivery("sharpen", "accepted");

    clock.set("2026-12-01T06:59:59.999+09:00");
    expect((await home()).notices).toEqual([]);

    clock.set("2026-12-01T07:00:00.000+09:00");
    expect((await home()).notices).toEqual(["MSG-015"]);
  });

  it("07:00 以後で、sharpen だけに今日の accepted が無ければ MSG-016 だけ。前の日の accepted は数えない", async () => {
    insertSenderDelivery("brain-harness", "accepted");
    insertSenderDelivery("sharpen", "accepted", "2026-11-30");
    expect((await home()).notices).toEqual(["MSG-016"]);
  });

  describe("TC82 AI の失敗（Q-078 の答え。BD-11 M02）", () => {
    beforeEach(() => {
      // 未着の知らせを出さない。
      insertSenderDelivery("brain-harness", "accepted");
      insertSenderDelivery("sharpen", "accepted");
    });

    it("(a) 23 時間前に failed の answer（attempt 1）で、attempt 2 が done なら MSG-017 なし", async () => {
      const replyId = insertReply("done");
      insertRun({
        purpose: "answer",
        state: "failed",
        attempt: 1,
        finishedAt: HOURS_AGO_23,
        replyMessageId: replyId,
      });
      insertRun({
        purpose: "answer",
        state: "done",
        attempt: 2,
        finishedAt: HOUR_AGO_1,
        replyMessageId: replyId,
      });
      const result = await home();
      expect(result.ai.hasFailure).toBe(false);
      expect(result.notices).not.toContain("MSG-017");
    });

    it("(b) 23 時間前に failed の relate で後が無ければ MSG-017", async () => {
      const deliveryId = insertDelivery(db, "2026-11-30", HOURS_AGO_25, 0);
      insertRun({
        purpose: "relate",
        state: "failed",
        attempt: 1,
        finishedAt: HOURS_AGO_23,
        relateDeliveryId: deliveryId,
      });
      const result = await home();
      expect(result.ai.hasFailure).toBe(true);
      expect(result.notices).toEqual(["MSG-017"]);
    });

    it("(c) 25 時間前に failed なら MSG-017 なし", async () => {
      const deliveryId = insertDelivery(db, "2026-11-30", HOURS_AGO_25, 0);
      insertRun({
        purpose: "relate",
        state: "failed",
        attempt: 1,
        finishedAt: HOURS_AGO_25,
        relateDeliveryId: deliveryId,
      });
      const result = await home();
      expect(result.ai.hasFailure).toBe(false);
      expect(result.notices).not.toContain("MSG-017");
    });

    it("attempt 2 も failed なら MSG-017", async () => {
      const deliveryId = insertDelivery(db, "2026-11-30", HOURS_AGO_25, 0);
      for (const attempt of [1, 2]) {
        insertRun({
          purpose: "relate",
          state: "failed",
          attempt,
          finishedAt: HOURS_AGO_23,
          relateDeliveryId: deliveryId,
        });
      }
      expect((await home()).notices).toEqual(["MSG-017"]);
    });
  });

  it("TC83 空の DB では数は 0、learning は null、picks は空。7:00 以後なので notices は MSG-015 と MSG-016", async () => {
    expect(await home()).toEqual({
      newCount: 0,
      unreadCount: 0,
      learning: null,
      ai: { writingCount: 0, hasFailure: false },
      picks: [],
      notices: ["MSG-015", "MSG-016"],
    });
  });

  it("TC73 1時間前に失敗した応答を dismissReply でやめても、getHome の notices に MSG-017 が残る", async () => {
    insertSenderDelivery("brain-harness", "accepted");
    insertSenderDelivery("sharpen", "accepted");
    const replyId = insertReply("failed");
    insertRun({
      purpose: "answer",
      state: "failed",
      attempt: 1,
      finishedAt: HOUR_AGO_1,
      replyMessageId: replyId,
    });

    const response = await dismissReply({
      deviceApi: context.deviceApi,
      chat: createChat({ db, clock }),
    })(
      new Request(`${ORIGIN}/api/app/messages/${replyId}/dismiss`, {
        method: "POST",
        headers: { cookie: `nexus_device=${K1}`, origin: ORIGIN },
      }),
      { params: Promise.resolve({ messageId: String(replyId) }) },
    );
    expect(response.status).toBe(200);
    expect(
      db
        .prepare("SELECT reply_state FROM message WHERE message_id = ?")
        .get(replyId),
    ).toEqual({ reply_state: "cancelled" });

    expect((await home()).notices).toEqual(["MSG-017"]);
  });

  it("鍵が無ければ 401 と MSG-020", async () => {
    const { status, json } = await callHome(null);
    expect(status).toBe(401);
    expect(json).toMatchObject({ error: { messageId: "MSG-020" } });
  });

  it("読めなければ 500 と MSG-019（FN-020 手順 8）", async () => {
    context = {
      ...context,
      home: {
        getHome() {
          throw new Error("読めない");
        },
      },
    };
    const { status, json } = await callHome();
    expect(status).toBe(500);
    expect(json).toMatchObject({
      error: { code: "internal", messageId: "MSG-019" },
    });
  });
});
