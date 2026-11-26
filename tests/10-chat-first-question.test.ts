import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type ConversationApiContext,
  createConversation,
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
import { createSecret, hashSecret } from "../src/server/shared/secret";
import { NOW, type D1News, insertD1News, migrate } from "./fixtures/news";

// 10-chat の実装単位9: `listConversations` と `createConversation` の応答の会話に
// `firstQuestionText`（最初の本人の発言の本文。無ければ null）を添える。
// DD-02 FN-014、DD-04（openapi.yaml の Conversation）、X-04 CR-017。
// 受け入れ基準: DD-10 TC102 が通る（tests/13-release-contract.test.ts）。
// 発言のある会話を listConversations で読むと firstQuestionText が最初の本人の発言の本文で、
// 発言の無い会話では null である（この試験）。

const ORIGIN = "http://localhost:48401";
const BASE = `${ORIGIN}/api/app/conversations`;

let dir: string;
let db: Database;
let clock: FakeClock;
let K1: string;
let d1: D1News;
let context: ConversationApiContext;

interface Conversation {
  conversationId: number;
  firstQuestionText?: string | null;
}

function insertConversationRow(
  targetContentId: number | null,
  lastSpokenAt: string,
): number {
  const target =
    targetContentId === null
      ? null
      : JSON.stringify({ kind: "article", contentId: targetContentId });
  return Number(
    db
      .prepare(
        "INSERT INTO conversation (target_content_id, question_target_json, started_at, last_spoken_at) VALUES (?, ?, ?, ?)",
      )
      .run(targetContentId, target, lastSpokenAt, lastSpokenAt).lastInsertRowid,
  );
}

function insertOwner(
  conversationId: number,
  body: string,
  sentAt: string,
): number {
  return Number(
    db
      .prepare(
        "INSERT INTO message (conversation_id, speaker, body_md, sent_at) VALUES (?, 'owner', ?, ?)",
      )
      .run(conversationId, body, sentAt).lastInsertRowid,
  );
}

function insertAi(
  conversationId: number,
  body: string,
  sentAt: string,
  replyTo: number,
): number {
  return Number(
    db
      .prepare(
        "INSERT INTO message (conversation_id, speaker, body_md, sent_at, reply_state, reply_to_message_id) VALUES (?, 'ai', ?, ?, 'done', ?)",
      )
      .run(conversationId, body, sentAt, replyTo).lastInsertRowid,
  );
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-10-first-question-"));
  clock = createFakeClock(NOW);
  db = openDatabase(databasePath(dir));
  migrate(db);
  d1 = insertD1News(db);
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

async function callList(
  query: Record<string, string> = {},
): Promise<Conversation[]> {
  const url = new URL(BASE);
  for (const [name, value] of Object.entries(query)) {
    url.searchParams.set(name, value);
  }
  const response = await listConversations(context)(
    new Request(url, {
      method: "GET",
      headers: { cookie: `nexus_device=${K1}` },
    }),
  );
  expect(response.status).toBe(200);
  return ((await response.json()) as { items: Conversation[] }).items;
}

function byId(items: Conversation[], conversationId: number): Conversation {
  const found = items.find((item) => item.conversationId === conversationId);
  if (found === undefined) {
    throw new Error(`一覧に会話 ${conversationId} が無い`);
  }
  return found;
}

describe("会話の firstQuestionText（DD-02 FN-014、CR-017）", () => {
  it("発言のある会話は、最初の本人の発言の本文を firstQuestionText に添える", async () => {
    const spoken = insertConversationRow(
      d1.A1,
      "2026-12-01T07:40:00.000+09:00",
    );
    const q1 = insertOwner(
      spoken,
      "この記事の要点は？",
      "2026-12-01T07:10:00.000+09:00",
    );
    insertAi(spoken, "要点は3つある。", "2026-12-01T07:11:00.000+09:00", q1);
    const q2 = insertOwner(
      spoken,
      "2つ目を詳しく",
      "2026-12-01T07:20:00.000+09:00",
    );
    insertAi(spoken, "2つ目は…", "2026-12-01T07:21:00.000+09:00", q2);

    const items = await callList({ targetContentId: String(d1.A1) });
    expect(byId(items, spoken).firstQuestionText).toBe("この記事の要点は？");
  });

  it("発言の無い会話は firstQuestionText が null（項目を省かない）", async () => {
    const empty = insertConversationRow(d1.A1, "2026-12-01T07:30:00.000+09:00");

    const items = await callList({ targetContentId: String(d1.A1) });
    const item = byId(items, empty);
    expect(item).toHaveProperty("firstQuestionText");
    expect(item.firstQuestionText).toBeNull();
  });

  it("一覧の会話ごとに、その会話の発言から書き出しを取る（ほかの会話の発言を混ぜない）", async () => {
    // 発言のある会話と無い会話を同じ一覧に並べる。
    const first = insertConversationRow(d1.A1, "2026-12-01T07:00:00.000+09:00");
    insertOwner(first, "1つ目の会話の質問", "2026-12-01T06:50:00.000+09:00");
    const empty = insertConversationRow(d1.A1, "2026-12-01T07:10:00.000+09:00");
    const second = insertConversationRow(
      d1.A1,
      "2026-12-01T07:20:00.000+09:00",
    );
    insertOwner(second, "2つ目の会話の質問", "2026-12-01T07:15:00.000+09:00");
    insertOwner(second, "2つ目の会話の続き", "2026-12-01T07:18:00.000+09:00");

    const items = await callList({ targetContentId: String(d1.A1) });
    expect(
      items.map((item) => [item.conversationId, item.firstQuestionText]),
    ).toEqual([
      [second, "2つ目の会話の質問"],
      [empty, null],
      [first, "1つ目の会話の質問"],
    ]);
  });

  it("対象の無い会話の一覧（ホームから）でも firstQuestionText を添える", async () => {
    const spoken = insertConversationRow(null, "2026-12-01T07:30:00.000+09:00");
    insertOwner(spoken, "今日の予定は？", "2026-12-01T07:25:00.000+09:00");
    const empty = insertConversationRow(null, "2026-12-01T07:00:00.000+09:00");

    const items = await callList();
    expect(
      items.map((item) => [item.conversationId, item.firstQuestionText]),
    ).toEqual([
      [spoken, "今日の予定は？"],
      [empty, null],
    ]);
  });

  it("createConversation の応答の会話は、発言がまだ無いので firstQuestionText が null", async () => {
    const response = await createConversation(context)(
      new Request(BASE, {
        method: "POST",
        headers: {
          cookie: `nexus_device=${K1}`,
          origin: ORIGIN,
          "content-type": "application/json",
        },
        body: JSON.stringify({ target: { kind: "article", contentId: d1.A1 } }),
      }),
    );
    expect(response.status).toBe(201);
    const created = (await response.json()) as { conversation: Conversation };
    expect(created.conversation).toHaveProperty("firstQuestionText");
    expect(created.conversation.firstQuestionText).toBeNull();
  });
});
