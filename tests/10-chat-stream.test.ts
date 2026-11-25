import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDeviceApiContext } from "../src/app/api/_entry/device-api";
import {
  type ReplyStreamApiContext,
  streamReply,
} from "../src/app/api/_entry/reply-stream";
import { createFakeAi, type FakeScriptSource } from "../src/runner/ai-provider";
import { createAiRunner } from "../src/runner/ai-runner";
import { createPurposes } from "../src/runner/purposes";
import { createAiQueue } from "../src/server/ai-jobs";
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
import { NOW, insertD1News, migrate } from "./fixtures/news";

// 10-chat の実装単位4: 応答の続きを流す `streamReply`（SSE、`Last-Event-ID`、`retry`、空のコメント行）。
// FN-015、ADR-013、DD-04 3.5、DD-02 FN-015 続きを流す。受け入れ基準は TC66、TC117。

const ORIGIN = "http://localhost:48401";

let dir: string;
let db: Database;
let clock: FakeClock;
let K1: string;
let C1: number;
let context: ReplyStreamApiContext;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-10-stream-"));
  clock = createFakeClock(NOW);
  db = openDatabase(databasePath(dir));
  migrate(db);
  const d1 = insertD1News(db);
  C1 = Number(
    db
      .prepare(
        "INSERT INTO conversation (target_content_id, question_target_json, started_at, last_spoken_at) VALUES (?, ?, ?, ?)",
      )
      .run(
        d1.A1,
        JSON.stringify({ kind: "article", contentId: d1.A1 }),
        NOW,
        NOW,
      ).lastInsertRowid,
  );
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
    chat: createChat({ db, clock }),
  };
});

afterEach(() => {
  if (db.isOpen) db.close();
  rmSync(dir, { recursive: true, force: true });
});

// 質問を受け、作成中の AI の発言の ID を返す。
function ask(text: string): number {
  const posted = createChat({ db, clock }).postQuestion(C1, text);
  expect(posted.kind).toBe("accepted");
  return posted.reply.messageId;
}

function latestRunId(messageId: number): number {
  const row = db
    .prepare(
      "SELECT MAX(ai_run_id) AS id FROM ai_run WHERE reply_message_id = ?",
    )
    .get(messageId) as { id: number };
  return Number(row.id);
}

// AI Runner を1回動かす（偽の AI とつなぐ。DD-10 1章）。拾った実行が終わるまでの Promise を返す。
function runOnce(source: FakeScriptSource): Promise<unknown> {
  const fake = createFakeAi(source, { dataDir: dir, brainHarnessDir: null });
  const logger = createLogger({
    process: "runner",
    clock,
    dir: join(dir, "logs"),
  });
  const runner = createAiRunner({
    queue: createAiQueue(db, clock),
    execute: createPurposes({ db, provider: fake.provider, clock, logger })
      .execute,
    logger,
  });
  return runner.runOnce();
}

function connect(
  messageId: number | string,
  options: {
    lastEventId?: string;
    cookie?: boolean;
    signal?: AbortSignal;
  } = {},
  ctx: ReplyStreamApiContext = context,
): Promise<Response> {
  const id = String(messageId);
  const headers: Record<string, string> = {};
  if (options.cookie !== false) headers.cookie = `nexus_device=${K1}`;
  if (options.lastEventId !== undefined) {
    headers["last-event-id"] = options.lastEventId;
  }
  return streamReply(ctx)(
    new Request(`${ORIGIN}/api/app/messages/${id}/stream`, {
      headers,
      signal: options.signal,
    }),
    { params: Promise.resolve({ messageId: id }) },
  );
}

// SSE の1つの塊（空行で区切られたもの）。
interface SseBlock {
  raw: string;
  event?: string;
  id?: string;
  data?: unknown;
  retry?: number;
  comment?: boolean;
}

function parseBlock(raw: string): SseBlock {
  const block: SseBlock = { raw };
  for (const line of raw.split("\n")) {
    if (line.startsWith(":")) {
      block.comment = true;
      continue;
    }
    const index = line.indexOf(":");
    const field = index < 0 ? line : line.slice(0, index);
    const value = index < 0 ? "" : line.slice(index + 1).replace(/^ /, "");
    if (field === "event") block.event = value;
    if (field === "id") block.id = value;
    if (field === "data") block.data = JSON.parse(value) as unknown;
    if (field === "retry") block.retry = Number(value);
  }
  return block;
}

// 応答の本文を塊ごとに読む。
function sseReader(response: Response) {
  const body = response.body;
  if (body === null) throw new Error("本文が無い");
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let ended = false;
  const blocks: SseBlock[] = [];

  const next = async (): Promise<SseBlock | null> => {
    for (;;) {
      const end = buffer.indexOf("\n\n");
      if (end >= 0) {
        const block = parseBlock(buffer.slice(0, end));
        buffer = buffer.slice(end + 2);
        blocks.push(block);
        return block;
      }
      if (ended) return null;
      const { done, value } = await reader.read();
      if (done) {
        ended = true;
        continue;
      }
      buffer += decoder.decode(value, { stream: true });
    }
  };

  return {
    blocks,
    next,
    // 閉じるまで読む。コメント行を除いた塊を返す。
    async readToEnd(): Promise<SseBlock[]> {
      while ((await next()) !== null);
      return blocks.filter((block) => block.comment !== true);
    },
    // 条件に合う塊が来るまで読む。
    async until(match: (block: SseBlock) => boolean): Promise<SseBlock> {
      for (;;) {
        const block = await next();
        if (block === null) throw new Error("条件に合う塊の前に閉じた");
        if (match(block)) return block;
      }
    },
    cancel: () => reader.cancel(),
  };
}

function deltaText(blocks: SseBlock[]): string {
  return blocks
    .filter((block) => block.event === "delta")
    .map((block) => (block.data as { text: string }).text)
    .join("");
}

describe("streamReply（FN-015 続きを流す、DD-04 3.5）", () => {
  it("TC66 最初に retry: 3000、delta の id は <実行ID>.<本文の長さ>。Last-Event-ID <実行ID>.2 でつなぎ直すと位置 2 より後だけが来て、完了の state で閉じる", async () => {
    const replyId = ask("今日の天気は？");
    const runId = latestRunId(replyId);

    const first = await connect(replyId);
    expect(first.status).toBe(200);
    expect(first.headers.get("content-type")).toMatch(/^text\/event-stream/);
    const firstReader = sseReader(first);
    // 最初の出来事の前に `retry: 3000`。
    const opening = await firstReader.next();
    expect(opening?.retry).toBe(3000);

    // 偽の AI は少しずつ返す。
    const running = runOnce({
      steps: [
        { text: "今日" },
        { wait: 600 },
        { text: "は晴れ" },
        { wait: 600 },
        { text: "です" },
        { result: "今日は晴れです" },
      ],
    });

    const firstDelta = await firstReader.until(
      (block) => block.event === "delta",
    );
    expect(firstDelta).toMatchObject({
      id: `${runId}.2`,
      data: { text: "今日" },
    });
    // 途中で切る。
    await firstReader.cancel();

    // `Last-Event-ID` を `<その実行ID>.2` にしてつなぎ直す。
    const second = await connect(replyId, { lastEventId: `${runId}.2` });
    expect(second.status).toBe(200);
    const events = await sseReader(second).readToEnd();
    await running;

    expect(events[0]?.retry).toBe(3000);
    // つなぎ直した後は位置 2 より後の続きだけが来る。reset は来ない。
    expect(events.some((block) => block.event === "reset")).toBe(false);
    const deltas = events.filter((block) => block.event === "delta");
    expect(deltas.length).toBeGreaterThanOrEqual(1);
    expect(deltaText(events)).toBe("は晴れです");
    let length = 2;
    for (const delta of deltas) {
      length += (delta.data as { text: string }).text.length;
      expect(delta.id).toBe(`${runId}.${length}`);
    }
    expect(deltas.at(-1)?.id).toBe(`${runId}.7`);
    // 完了で `state`（done）が来て閉じる。
    const last = events.at(-1);
    expect(last?.event).toBe("state");
    expect(last?.data).toEqual({
      replyState: "done",
      messageId: replyId,
      notice: null,
    });
  });

  it("TC66 完了した後に Last-Event-ID <実行ID>.2 でつなぐと、位置より後の本文を最初に1つの delta で送ってから state で閉じる", async () => {
    const replyId = ask("今日の天気は？");
    const runId = latestRunId(replyId);
    await runOnce({
      steps: [{ text: "今日は晴れです" }, { result: "今日は晴れです" }],
    });

    const response = await connect(replyId, { lastEventId: `${runId}.2` });
    const events = await sseReader(response).readToEnd();
    expect(events.map((block) => block.raw)).toEqual([
      "retry: 3000",
      `event: delta\nid: ${runId}.7\ndata: {"text":"は晴れです"}`,
      `event: state\ndata: {"replyState":"done","messageId":${replyId},"notice":null}`,
    ]);
  });

  it("TC117 1回目が 100 文字の後で止まり2回目が 50 文字で成功すると、100 文字の delta の後に reset が来て、続く delta は2回目の 50 文字だけで、done で閉じる。1回目の番号でつなぎ直すと最初に reset が来る", async () => {
    const replyId = ask("途中で止まる質問");
    const firstRunId = latestRunId(replyId);
    const firstText = "あ".repeat(100);
    const secondText = "い".repeat(50);

    const response = await connect(replyId);
    const reader = sseReader(response);

    // 1回目: 100 文字を返した後、`result` を出さずに 0 でない終了コードで終わる（E11）。
    await runOnce({
      steps: [{ text: firstText }, { wait: 600 }],
      exitCode: 1,
    });
    const secondRunId = latestRunId(replyId);
    expect(secondRunId).toBeGreaterThan(firstRunId);
    // 2回目: 50 文字を返して成功する。
    await runOnce({ steps: [{ text: secondText }, { result: secondText }] });

    const events = await reader.readToEnd();
    expect(events[0]?.retry).toBe(3000);
    const resetIndex = events.findIndex((block) => block.event === "reset");
    expect(resetIndex).toBeGreaterThan(0);
    const before = events.slice(1, resetIndex);
    const after = events.slice(resetIndex + 1);
    // reset の前は1回目の 100 文字の delta。
    expect(before).toEqual([
      expect.objectContaining({
        event: "delta",
        id: `${firstRunId}.100`,
        data: { text: firstText },
      }),
    ]);
    expect(events[resetIndex]?.data).toEqual({});
    // reset の後の delta は2回目の 50 文字だけで、番号は2回目の実行。
    expect(deltaText(after)).toBe(secondText);
    const afterDeltas = after.filter((block) => block.event === "delta");
    expect(afterDeltas.at(-1)?.id).toBe(`${secondRunId}.50`);
    for (const delta of afterDeltas) {
      expect(delta.id?.startsWith(`${secondRunId}.`)).toBe(true);
    }
    expect(after.at(-1)).toMatchObject({
      event: "state",
      data: { replyState: "done", messageId: replyId, notice: null },
    });

    // 1回目の実行の番号で `Last-Event-ID` を付けてつなぎ直す。
    const again = await connect(replyId, {
      lastEventId: `${firstRunId}.100`,
    });
    const resumed = await sseReader(again).readToEnd();
    expect(resumed.map((block) => block.raw)).toEqual([
      "retry: 3000",
      "event: reset\ndata: {}",
      `event: delta\nid: ${secondRunId}.50\ndata: {"text":"${secondText}"}`,
      `event: state\ndata: {"replyState":"done","messageId":${replyId},"notice":null}`,
    ]);
  });

  it("作成中のあいだ、空のコメント行を決まった間隔で送る（DD-04 3.5）", async () => {
    const replyId = ask("待つ質問");
    const response = await connect(
      replyId,
      {},
      { ...context, heartbeatIntervalMs: 50 },
    );
    const reader = sseReader(response);
    expect((await reader.next())?.retry).toBe(3000);
    const comment = await reader.until((block) => block.comment === true);
    expect(comment.raw).toBe(":");
    await reader.cancel();
  });

  it("失敗した応答には失敗の state と MSG-012 を送って閉じる", async () => {
    const replyId = ask("失敗する質問");
    // 送り直さない失敗（E16 相当）として発言と実行を failed にする。
    db.prepare(
      "UPDATE ai_run SET state = 'failed', started_at = ?, finished_at = ?, failure_reason = 'INTERNAL: x' WHERE reply_message_id = ?",
    ).run(NOW, NOW, replyId);
    db.prepare(
      "UPDATE message SET reply_state = 'failed', body_md = '途中' WHERE message_id = ?",
    ).run(replyId);
    const runId = latestRunId(replyId);
    const events = await sseReader(await connect(replyId)).readToEnd();
    expect(events.map((block) => block.raw)).toEqual([
      "retry: 3000",
      `event: delta\nid: ${runId}.2\ndata: {"text":"途中"}`,
      `event: state\ndata: {"replyState":"failed","messageId":${replyId},"notice":"MSG-012"}`,
    ]);
  });

  it("発言が無いか本人の発言なら 404、鍵が無ければ 401、送り始める前に DB が使えなければ 500", async () => {
    const replyId = ask("本人の発言");
    const questionId = replyId - 1;
    for (const id of [questionId, 99999, "abc"]) {
      const response = await connect(id);
      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({
        error: { code: "not_found", messageId: "MSG-019" },
      });
    }
    expect((await connect(replyId, { cookie: false })).status).toBe(401);

    const broken: ReplyStreamApiContext = {
      ...context,
      chat: {
        ...context.chat,
        readReply: () => {
          throw Object.assign(new Error("disk I/O error"), {
            code: "ERR_SQLITE_ERROR",
            errcode: 10,
          });
        },
      },
    };
    const failed = await connect(replyId, {}, broken);
    expect(failed.status).toBe(500);
    expect(await failed.json()).toMatchObject({
      error: { code: "internal", messageId: "MSG-019" },
    });
  });

  it("送り始めた後に読めなくなったら、出来事を送らずに閉じる（DD-04 3.5、RV16-10）", async () => {
    const replyId = ask("途中で DB が使えなくなる質問");
    let calls = 0;
    const flaky: ReplyStreamApiContext = {
      ...context,
      pollIntervalMs: 20,
      chat: {
        ...context.chat,
        readReply: (messageId) => {
          calls += 1;
          if (calls > 1) throw new Error("database is locked");
          return context.chat.readReply(messageId);
        },
      },
    };
    const response = await connect(replyId, {}, flaky);
    expect(response.status).toBe(200);
    const events = await sseReader(response).readToEnd();
    expect(events.map((block) => block.raw)).toEqual(["retry: 3000"]);
  });
});
