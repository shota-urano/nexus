import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type ConversationApiContext,
  createConversation,
  getConversation,
  listConversations,
} from "../src/app/api/_entry/conversation";
import { createDeviceApiContext } from "../src/app/api/_entry/device-api";
import { createDeviceKeyVerifier } from "../src/server/auth/device-key";
import { createChat } from "../src/server/chat";
import {
  type Database,
  databasePath,
  openDatabase,
} from "../src/server/db/connection";
import { createFakeClock, type FakeClock } from "../src/server/shared/clock";
import { createLogger } from "../src/server/shared/logger";
import { formatMessage } from "../src/server/shared/messages";
import { createSecret, hashSecret } from "../src/server/shared/secret";
import { NOW, type D1News, insertD1News, migrate } from "./fixtures/news";

// 10-chat の実装単位1: 会話の API `listConversations`、`createConversation`、`getConversation`。
// FN-014、DD-01 M18、DD-02 FN-014。受け入れ基準は TC50、TC51、TC52、TC53。

const ORIGIN = "http://localhost:48401";
const BASE = `${ORIGIN}/api/app/conversations`;

let dir: string;
let db: Database;
let clock: FakeClock;
let K1: string;
let d1: D1News;
let C1: number;
let context: ConversationApiContext;

interface Conversation {
  conversationId: number;
  target: Record<string, unknown> | null;
  targetTitle: string | null;
  startedAt: string;
  lastSpokenAt: string;
}

interface ConversationPage {
  items: Conversation[];
  nextCursor: string | null;
}

interface ConversationDetail {
  conversation: Conversation;
  messages: {
    messageId: number;
    conversationId: number;
    speaker: string;
    bodyMd: string;
    sentAt: string;
    replyState: string | null;
    replyToMessageId: number | null;
    notice: string | null;
  }[];
}

function insertConversationRow(
  targetContentId: number | null,
  lastSpokenAt: string,
): number {
  const target =
    targetContentId === null
      ? null
      : JSON.stringify({ kind: "article", contentId: targetContentId });
  const result = db
    .prepare(
      "INSERT INTO conversation (target_content_id, question_target_json, started_at, last_spoken_at) VALUES (?, ?, ?, ?)",
    )
    .run(targetContentId, target, lastSpokenAt, lastSpokenAt);
  return Number(result.lastInsertRowid);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-10-conversation-"));
  clock = createFakeClock(NOW);
  db = openDatabase(databasePath(dir));
  migrate(db);
  d1 = insertD1News(db);
  // D1 の会話: A1 の会話 C1（発言なし）。DD-10 3章。
  C1 = insertConversationRow(d1.A1, "2026-11-30T21:00:00.000+09:00");
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
    chat: createChat({ db, clock }),
  };
});

afterEach(() => {
  if (db.isOpen) db.close();
  rmSync(dir, { recursive: true, force: true });
});

function listRequest(query: Record<string, string> = {}): Request {
  const url = new URL(BASE);
  for (const [name, value] of Object.entries(query)) {
    url.searchParams.set(name, value);
  }
  return new Request(url, {
    method: "GET",
    headers: { cookie: `nexus_device=${K1}` },
  });
}

function createRequest(body: string, origin: string = ORIGIN): Request {
  return new Request(BASE, {
    method: "POST",
    headers: {
      cookie: `nexus_device=${K1}`,
      origin,
      "content-type": "application/json",
    },
    body,
  });
}

async function callList(
  query: Record<string, string> = {},
): Promise<ConversationPage> {
  const response = await listConversations(context)(listRequest(query));
  expect(response.status).toBe(200);
  return (await response.json()) as ConversationPage;
}

function callGet(conversationId: string): Promise<Response> {
  return getConversation(context)(
    new Request(`${BASE}/${conversationId}`, {
      method: "GET",
      headers: { cookie: `nexus_device=${K1}` },
    }),
    { params: Promise.resolve({ conversationId }) },
  );
}

async function expectError(
  response: Response,
  status: number,
  code: string,
): Promise<void> {
  expect(response.status).toBe(status);
  const body = (await response.json()) as {
    error: { code: string; messageId: string; message: string };
  };
  expect(body.error.code).toBe(code);
  expect(body.error.messageId).toBe("MSG-019");
  expect(body.error.message).toBe(formatMessage("MSG-019"));
}

function countConversations(): number {
  return Number(
    (
      db.prepare("SELECT COUNT(*) AS n FROM conversation").get() as {
        n: number;
      }
    ).n,
  );
}

describe("listConversations、createConversation、getConversation（FN-014）", () => {
  it("TC50 A1 の会話の一覧は最後に話した日時の新しい順で、古い方を開け、作った後は3件になる", async () => {
    // 前提: A1 の会話が2つ（古い方と新しい方）。D1 の C1 を古い方にする。
    const older = C1;
    const newer = insertConversationRow(d1.A1, "2026-12-01T07:30:00.000+09:00");
    // ほかの対象の会話と対象の無い会話は、A1 の一覧に出ない。
    insertConversationRow(d1.A2, "2026-12-01T07:45:00.000+09:00");
    insertConversationRow(null, "2026-12-01T07:50:00.000+09:00");

    const first = await callList({ targetContentId: String(d1.A1) });
    expect(first.items.map((item) => item.conversationId)).toEqual([
      newer,
      older,
    ]);
    expect(first.nextCursor).toBeNull();
    expect(first.items[0]).toEqual({
      conversationId: newer,
      target: { kind: "article", contentId: d1.A1 },
      targetTitle: "今日の記事 A1",
      firstQuestionText: null,
      startedAt: "2026-12-01T07:30:00.000+09:00",
      lastSpokenAt: "2026-12-01T07:30:00.000+09:00",
    });

    // 古い方で getConversation。発言は無い。
    const opened = await callGet(String(older));
    expect(opened.status).toBe(200);
    const detail = (await opened.json()) as ConversationDetail;
    expect(detail.conversation.conversationId).toBe(older);
    expect(detail.conversation.target).toEqual({
      kind: "article",
      contentId: d1.A1,
    });
    expect(detail.conversation.targetTitle).toBe("今日の記事 A1");
    expect(detail.messages).toEqual([]);

    // A1 の article で createConversation。
    clock.set(new Date("2026-12-01T08:05:00.000+09:00"));
    const response = await createConversation(context)(
      createRequest(
        JSON.stringify({ target: { kind: "article", contentId: d1.A1 } }),
      ),
    );
    expect(response.status).toBe(201);
    const created = (await response.json()) as {
      conversation: Conversation;
      notice: string | null;
    };
    expect(created.notice).toBeNull();
    expect(created.conversation.target).toEqual({
      kind: "article",
      contentId: d1.A1,
    });
    expect(created.conversation.targetTitle).toBe("今日の記事 A1");
    expect(created.conversation.startedAt).toBe(
      "2026-12-01T08:05:00.000+09:00",
    );
    expect(created.conversation.lastSpokenAt).toBe(
      "2026-12-01T08:05:00.000+09:00",
    );

    const after = await callList({ targetContentId: String(d1.A1) });
    expect(after.items.map((item) => item.conversationId)).toEqual([
      created.conversation.conversationId,
      newer,
      older,
    ]);
  });

  it("TC51 無い内容 ID の対象で createConversation すると、201 で対象の無い会話になり notice が MSG-011", async () => {
    const response = await createConversation(context)(
      createRequest(
        JSON.stringify({ target: { kind: "article", contentId: 999 } }),
      ),
    );
    expect(response.status).toBe(201);
    const created = (await response.json()) as {
      conversation: Conversation;
      notice: string | null;
    };
    expect(created.notice).toBe("MSG-011");
    expect(created.conversation.target).toBeNull();
    expect(created.conversation.targetTitle).toBeNull();
    const row = db
      .prepare(
        "SELECT target_content_id, question_target_json FROM conversation WHERE conversation_id = ?",
      )
      .get(created.conversation.conversationId) as Record<string, unknown>;
    expect(row.target_content_id).toBeNull();
    expect(row.question_target_json).toBeNull();
    // 対象の無い会話の一覧に出る。
    const list = await callList();
    expect(list.items.map((item) => item.conversationId)).toEqual([
      created.conversation.conversationId,
    ]);
  });

  it("TC52 phrase で sentence の無い対象は 400 で、会話を作らない", async () => {
    const before = countConversations();
    const response = await createConversation(context)(
      createRequest(
        JSON.stringify({
          target: {
            kind: "phrase",
            contentId: d1.A1,
            phrase: "半導体",
            position: { part: "reading", paragraphIndex: 0, sentenceIndex: 1 },
          },
        }),
      ),
    );
    await expectError(response, 400, "bad_request");
    expect(countConversations()).toBe(before);
  });

  it("TC52 phrase で語句、文、位置が揃えば作れる。位置か語句が無ければ 400", async () => {
    const full = {
      kind: "phrase",
      contentId: d1.A1,
      phrase: "半導体",
      sentence: "半導体の話をする。",
      position: { part: "reading", paragraphIndex: 0, sentenceIndex: 1 },
    };
    const ok = await createConversation(context)(
      createRequest(JSON.stringify({ target: full })),
    );
    expect(ok.status).toBe(201);
    const created = (await ok.json()) as { conversation: Conversation };
    expect(created.conversation.target).toEqual(full);

    for (const missing of ["phrase", "position"] as const) {
      const target: Record<string, unknown> = { ...full };
      delete target[missing];
      const response = await createConversation(context)(
        createRequest(JSON.stringify({ target })),
      );
      await expectError(response, 400, "bad_request");
    }
  });

  it("TC53 targetContentId を省くと、対象の無い会話だけを返す", async () => {
    // 前提: 対象の無い会話が1つ、A1 の会話が2つ（C1 と、もう1つ）。
    const homeConversation = insertConversationRow(
      null,
      "2026-11-30T20:00:00.000+09:00",
    );
    insertConversationRow(d1.A1, "2026-12-01T07:30:00.000+09:00");

    const list = await callList();
    expect(list.items).toEqual([
      {
        conversationId: homeConversation,
        target: null,
        targetTitle: null,
        firstQuestionText: null,
        startedAt: "2026-11-30T20:00:00.000+09:00",
        lastSpokenAt: "2026-11-30T20:00:00.000+09:00",
      },
    ]);
    expect(list.nextCursor).toBeNull();
  });

  it("本文が {} なら対象の無い会話を作る（ホームから）", async () => {
    const response = await createConversation(context)(createRequest("{}"));
    expect(response.status).toBe(201);
    const created = (await response.json()) as {
      conversation: Conversation;
      notice: string | null;
    };
    expect(created.notice).toBeNull();
    expect(created.conversation.target).toBeNull();
  });

  it("createConversation の本文の形が違えば 400、オリジンが違えば 403 で、会話を作らない", async () => {
    const before = countConversations();
    for (const body of [
      "not json",
      "[]",
      JSON.stringify({ target: { kind: "article" } }),
      JSON.stringify({ target: { kind: "video", contentId: d1.A1 } }),
      JSON.stringify({ target: { kind: "article", contentId: 0 } }),
      JSON.stringify({ target: { kind: "article", contentId: d1.A1, x: 1 } }),
      JSON.stringify({ other: 1 }),
      JSON.stringify({
        target: { kind: "phrase", contentId: d1.A1, phrase: "a".repeat(201) },
      }),
    ]) {
      const response = await createConversation(context)(createRequest(body));
      await expectError(response, 400, "bad_request");
    }
    const forbidden = await createConversation(context)(
      createRequest("{}", "https://evil.example"),
    );
    await expectError(forbidden, 403, "forbidden_origin");
    expect(countConversations()).toBe(before);
  });

  it("listConversations は続きのトークンでページを分け、形の違う問い合わせは 400", async () => {
    const second = insertConversationRow(
      d1.A1,
      "2026-12-01T07:00:00.000+09:00",
    );
    const third = insertConversationRow(d1.A1, "2026-12-01T07:00:00.000+09:00");
    const firstPage = await callList({
      targetContentId: String(d1.A1),
      limit: "2",
    });
    // 同じ日時は ID の大きい順。
    expect(firstPage.items.map((item) => item.conversationId)).toEqual([
      third,
      second,
    ]);
    expect(firstPage.nextCursor).not.toBeNull();
    const nextPage = await callList({
      targetContentId: String(d1.A1),
      limit: "2",
      cursor: firstPage.nextCursor ?? "",
    });
    expect(nextPage.items.map((item) => item.conversationId)).toEqual([C1]);
    expect(nextPage.nextCursor).toBeNull();

    const invalidQueries: Record<string, string>[] = [
      { targetContentId: "0" },
      { targetContentId: "abc" },
      { limit: "51" },
      { cursor: "!!" },
    ];
    for (const query of invalidQueries) {
      const response = await listConversations(context)(listRequest(query));
      await expectError(response, 400, "bad_request");
    }
  });

  it("getConversation は発言を順に返し、AI の発言の知らせを決める。無い会話は 404", async () => {
    const sent = "2026-12-01T07:10:00.000+09:00";
    const owner = (body: string): number =>
      Number(
        db
          .prepare(
            "INSERT INTO message (conversation_id, speaker, body_md, sent_at) VALUES (?, 'owner', ?, ?)",
          )
          .run(C1, body, sent).lastInsertRowid,
      );
    const ai = (replyTo: number, state: string): number =>
      Number(
        db
          .prepare(
            "INSERT INTO message (conversation_id, speaker, body_md, sent_at, reply_state, reply_to_message_id) VALUES (?, 'ai', '', ?, ?, ?)",
          )
          .run(C1, sent, state, replyTo).lastInsertRowid,
      );
    const run = (replyId: number, state: string, reason: string | null) =>
      db
        .prepare(
          "INSERT INTO ai_run (purpose, state, reply_message_id, created_at, started_at, finished_at, failure_reason) VALUES ('answer', ?, ?, ?, ?, ?, ?)",
        )
        .run(state, replyId, sent, sent, sent, reason);

    const q1 = owner("質問1");
    const doneReply = ai(q1, "done");
    run(doneReply, "done", null);
    const q2 = owner("質問2");
    const unavailable = ai(q2, "failed");
    // 1回目は別の失敗、一番新しい実行が E12。
    run(unavailable, "failed", "AI_TIMEOUT: 時間の上限を超えたので止めた");
    run(unavailable, "failed", "AI_UNAVAILABLE: CLI を起動できない");
    const q3 = owner("質問3");
    const otherFailure = ai(q3, "failed");
    // 1回目が E12 でも、一番新しい実行が別の失敗なら MSG-012。
    run(otherFailure, "failed", "AI_UNAVAILABLE: CLI を起動できない");
    run(otherFailure, "failed", "AI_BAD_OUTPUT: 形が読めない");
    const q4 = owner("質問4");
    const noRun = ai(q4, "failed");
    const q5 = owner("質問5");
    const cancelled = ai(q5, "cancelled");
    const q6 = owner("質問6");
    const writing = ai(q6, "writing");

    const response = await callGet(String(C1));
    expect(response.status).toBe(200);
    const detail = (await response.json()) as ConversationDetail;
    expect(
      detail.messages.map((m) => [m.messageId, m.speaker, m.notice]),
    ).toEqual([
      [q1, "owner", null],
      [doneReply, "ai", null],
      [q2, "owner", null],
      [unavailable, "ai", "MSG-013"],
      [q3, "owner", null],
      [otherFailure, "ai", "MSG-012"],
      [q4, "owner", null],
      [noRun, "ai", "MSG-012"],
      [q5, "owner", null],
      [cancelled, "ai", "MSG-014"],
      [q6, "owner", null],
      [writing, "ai", null],
    ]);
    expect(detail.messages[0]).toEqual({
      messageId: q1,
      conversationId: C1,
      speaker: "owner",
      bodyMd: "質問1",
      sentAt: sent,
      replyState: null,
      replyToMessageId: null,
      notice: null,
    });
    expect(detail.messages[1]?.replyToMessageId).toBe(q1);
    expect(detail.messages[1]?.replyState).toBe("done");

    await expectError(await callGet("999"), 404, "not_found");
    await expectError(await callGet("abc"), 404, "not_found");
  });

  it("鍵が無ければ 401 と MSG-020", async () => {
    const response = await listConversations(context)(
      new Request(BASE, { method: "GET" }),
    );
    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: { messageId: string } };
    expect(body.error.messageId).toBe("MSG-020");
  });
});
