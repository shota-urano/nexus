import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PUT as putSaved } from "../src/app/api/app/contents/[contentId]/saved/route";
import { PUT as putRead } from "../src/app/api/app/contents/[contentId]/read/route";
import { POST as postOpened } from "../src/app/api/app/contents/[contentId]/opened/route";
import { POST as postConversation } from "../src/app/api/app/conversations/route";
import { POST as postQuestion } from "../src/app/api/app/conversations/[conversationId]/questions/route";
import { PUT as putEnglishAnswer } from "../src/app/api/app/english/sets/[contentId]/answer/route";
import { POST as postRetry } from "../src/app/api/app/messages/[messageId]/retry/route";
import { POST as postStop } from "../src/app/api/app/messages/[messageId]/stop/route";
import { POST as postDismiss } from "../src/app/api/app/messages/[messageId]/dismiss/route";
import {
  type Database,
  databasePath,
  openDatabase,
} from "../src/server/db/connection";
import { formatMessage } from "../src/server/shared/messages";
import { createSecret, hashSecret } from "../src/server/shared/secret";
import { insertD1News, migrate } from "./fixtures/news";

// 11-home の実装単位3: データを変える端末の API（POST と PUT）の全ての道で、
// 送り元のオリジンの確かめ（DD-04 3.1、DD-02 3章 P01 手順 3、BD-10 T17、DD-06 E04）が効くことを、
// 本物の道（src/app/api/app/**/route.ts）から Web サーバと同じ部品（環境変数の設定で開く DB）まで
// 通して確かめる。受け入れ基準は DD-10 TC28。

// 試験の NEXUS のオリジン（DD-09 2.2）。
const ORIGIN = "http://localhost:48401";
const OTHER_ORIGIN = "https://evil.example";
const ENV_NAMES = [
  "NEXUS_ENV",
  "NEXUS_DATA_DIR",
  "NEXUS_LOG_DIR",
  "NEXUS_ORIGIN",
] as const;
const REGISTERED_AT = "2026-11-20T09:00:00.000+09:00";
const SENT_AT = "2026-11-30T21:00:00.000+09:00";

let dataDir: string;
let db: Database;
const savedEnv: Record<string, string | undefined> = {};
let K1: string;
// D1 の記事 A1、英語の教材 E1、会話 C1、失敗した AI の発言 M1。
let A1: number;
let E1: number;
let C1: number;
let M1: number;

const run = (sql: string, ...params: (string | number | null)[]) =>
  Number(db.prepare(sql).run(...params).lastInsertRowid);

function seed(): void {
  ({ A1 } = insertD1News(db));
  run(
    "INSERT INTO device (device_name, device_key_hash, registered_at, last_used_at) VALUES ('ipad', ?, ?, ?)",
    hashSecret(K1),
    REGISTERED_AT,
    REGISTERED_AT,
  );
  const englishDelivery = run(
    "INSERT INTO delivery (sender, target_date, received_at, item_count, result) VALUES ('sharpen', '2026-12-01', ?, 1, 'accepted')",
    SENT_AT,
  );
  E1 = run(
    "INSERT INTO content (kind, title, target_date, received_at, delivery_id) VALUES ('english', '現在形の使い方', '2026-12-01', ?, ?)",
    SENT_AT,
    englishDelivery,
  );
  run(
    "INSERT INTO english_set (content_id, learning_theme, lesson_body_md, problems_json, raw_payload_json) VALUES (?, '現在形', '本文', ?, '{}')",
    E1,
    JSON.stringify([{ no: 1, type: "choice", question: "問1" }]),
  );
  C1 = run(
    "INSERT INTO conversation (target_content_id, question_target_json, started_at, last_spoken_at) VALUES (?, ?, ?, ?)",
    A1,
    JSON.stringify({ kind: "article", contentId: A1 }),
    SENT_AT,
    SENT_AT,
  );
  const question = run(
    "INSERT INTO message (conversation_id, speaker, body_md, sent_at) VALUES (?, 'owner', '質問', ?)",
    C1,
    SENT_AT,
  );
  M1 = run(
    "INSERT INTO message (conversation_id, speaker, body_md, sent_at, reply_state, reply_to_message_id) VALUES (?, 'ai', '', ?, 'failed', ?)",
    C1,
    SENT_AT,
    question,
  );
}

// DB の全ての表の全ての行（行の順は並べ替えて揃える。rowid の無い表もあるため）。端末の `last_used_at` は鍵が通るたびに今にする（P01 手順 2）ので除く。
function snapshot(): Record<string, unknown[]> {
  const tables = db
    .prepare(
      "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all()
    .map((row) => String(row.name));
  const result: Record<string, unknown[]> = {};
  for (const table of tables) {
    result[table] = db
      .prepare(`SELECT * FROM "${table}"`)
      .all()
      .map((row) => {
        if (table !== "device") return JSON.stringify(row);
        const { last_used_at: _ignored, ...rest } = row;
        return JSON.stringify(rest);
      })
      .sort();
  }
  return result;
}

const params = <T extends Record<string, string>>(value: T) => ({
  params: Promise.resolve(value),
});

function request(
  method: "POST" | "PUT",
  path: string,
  body: unknown,
  origin: string | null,
): Request {
  const headers = new Headers({
    cookie: `nexus_device=${K1}`,
    "content-type": "application/json",
  });
  if (origin !== null) headers.set("origin", origin);
  return new Request(`${ORIGIN}${path}`, {
    method,
    headers,
    body: JSON.stringify(body),
  });
}

interface Operation {
  name: string;
  call: (origin: string | null) => Promise<Response>;
}

// データを変える端末の API の全て（DD-04 の POST と PUT。`/api/app/` の route.ts）。
function operations(): Operation[] {
  return [
    {
      name: "setSaved",
      call: (origin) =>
        putSaved(
          request(
            "PUT",
            `/api/app/contents/${A1}/saved`,
            { isSaved: true },
            origin,
          ),
          params({ contentId: String(A1) }),
        ),
    },
    {
      name: "setRead",
      call: (origin) =>
        putRead(
          request(
            "PUT",
            `/api/app/contents/${A1}/read`,
            { isRead: true },
            origin,
          ),
          params({ contentId: String(A1) }),
        ),
    },
    {
      name: "postQuestion",
      call: (origin) =>
        postQuestion(
          request(
            "POST",
            `/api/app/conversations/${C1}/questions`,
            { text: "この記事の要点は？" },
            origin,
          ),
          params({ conversationId: String(C1) }),
        ),
    },
    {
      name: "putEnglishAnswer",
      call: (origin) =>
        putEnglishAnswer(
          request(
            "PUT",
            `/api/app/english/sets/${E1}/answer`,
            { grades: [{ no: 1, grade: "o", answer: "b" }] },
            origin,
          ),
          params({ contentId: String(E1) }),
        ),
    },
    {
      name: "markOpened",
      call: (origin) =>
        postOpened(
          request("POST", `/api/app/contents/${A1}/opened`, {}, origin),
          params({ contentId: String(A1) }),
        ),
    },
    {
      name: "createConversation",
      call: (origin) =>
        postConversation(
          request(
            "POST",
            "/api/app/conversations",
            { target: { kind: "article", contentId: A1 } },
            origin,
          ),
        ),
    },
    {
      name: "retryReply",
      call: (origin) =>
        postRetry(
          request("POST", `/api/app/messages/${M1}/retry`, {}, origin),
          params({ messageId: String(M1) }),
        ),
    },
    {
      name: "stopReply",
      call: (origin) =>
        postStop(
          request("POST", `/api/app/messages/${M1}/stop`, {}, origin),
          params({ messageId: String(M1) }),
        ),
    },
    {
      name: "dismissReply",
      call: (origin) =>
        postDismiss(
          request("POST", `/api/app/messages/${M1}/dismiss`, {}, origin),
          params({ messageId: String(M1) }),
        ),
    },
  ];
}

const operation = (name: string): Operation => {
  const found = operations().find((op) => op.name === name);
  if (found === undefined) throw new Error(name);
  return found;
};

async function expectForbidden(response: Response): Promise<void> {
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({
    error: {
      code: "forbidden_origin",
      messageId: "MSG-019",
      message: formatMessage("MSG-019"),
    },
  });
}

beforeAll(() => {
  dataDir = mkdtempSync(join(tmpdir(), "nexus-11-origin-"));
  for (const name of ENV_NAMES) savedEnv[name] = process.env[name];
  process.env.NEXUS_ENV = "test";
  process.env.NEXUS_DATA_DIR = dataDir;
  process.env.NEXUS_LOG_DIR = join(dataDir, "logs");
  process.env.NEXUS_ORIGIN = ORIGIN;
  db = openDatabase(databasePath(dataDir));
  migrate(db);
  K1 = createSecret();
  seed();
});
afterAll(() => {
  db.close();
  for (const name of ENV_NAMES) {
    if (savedEnv[name] === undefined) delete process.env[name];
    else process.env[name] = savedEnv[name];
  }
  rmSync(dataDir, { recursive: true, force: true });
});

describe("TC28 データを変える端末の API は、Origin が NEXUS のオリジンと違うか無いと 403 と MSG-019 で、データを変えない（DD-04 3.1、BD-10 T17、DD-06 E04）", () => {
  it("Origin を別のオリジンにした setSaved、setRead、postQuestion、putEnglishAnswer と、Origin なしの setSaved は、どれも 403 と MSG-019 で、データは変わらない", async () => {
    const before = snapshot();
    for (const name of [
      "setSaved",
      "setRead",
      "postQuestion",
      "putEnglishAnswer",
    ]) {
      await expectForbidden(await operation(name).call(OTHER_ORIGIN));
    }
    await expectForbidden(await operation("setSaved").call(null));
    expect(snapshot()).toEqual(before);
  });

  it("ほかのデータを変える端末の API（markOpened、createConversation、retryReply、stopReply、dismissReply）も、Origin が違うか無いと 403 と MSG-019 で、データは変わらない", async () => {
    const before = snapshot();
    for (const op of operations()) {
      for (const origin of [OTHER_ORIGIN, null]) {
        await expectForbidden(await op.call(origin));
      }
    }
    expect(snapshot()).toEqual(before);
  });

  it("同じオリジンの setSaved は通ってデータを変える（同じ道と DB で、確かめが要求を全て止めているのではないこと）", async () => {
    const response = await operation("setSaved").call(ORIGIN);
    expect(response.status).toBe(200);
    const state = db
      .prepare("SELECT is_saved FROM content_state WHERE content_id = ?")
      .get(A1);
    expect(state?.is_saved).toBe(1);
  });
});
