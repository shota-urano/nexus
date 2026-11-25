import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFakeAi, type FakeScriptSource } from "../src/runner/ai-provider";
import {
  AI_RUNNER_SLOTS,
  createAiRunner,
  failInterruptedRuns,
} from "../src/runner/ai-runner";
import { createPurposes } from "../src/runner/purposes";
import { createAiQueue } from "../src/server/ai-jobs";
import { createChat } from "../src/server/chat";
import {
  type Database,
  databasePath,
  openDatabase,
} from "../src/server/db/connection";
import { createFakeClock, type FakeClock } from "../src/server/shared/clock";
import { createLogger } from "../src/server/shared/logger";
import {
  NOW,
  type D1News,
  insertD1News,
  migrate,
  queueRelate,
} from "./fixtures/news";

// 10-chat の実装単位3: 質問の応答の失敗の扱いと、拾う順と同時に動かす数。
// FN-015、DD-02 3章 P06、NFR-017、DD-06 E09・E11・E12。
// 受け入れ基準は TC60、TC61、TC62、TC63、TC64、TC65、TC129。

let dir: string;
let db: Database;
let clock: FakeClock;
let d1: D1News;

interface AiRunRecord {
  ai_run_id: number;
  purpose: string;
  state: string;
  reply_message_id: number | null;
  relate_delivery_id: number | null;
  attempt: number;
  failure_reason: string | null;
}

interface MessageRecord {
  message_id: number;
  body_md: string;
  reply_state: string | null;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-10-answer-failure-"));
  clock = createFakeClock(NOW);
  db = openDatabase(databasePath(dir));
  migrate(db);
  d1 = insertD1News(db);
});

afterEach(() => {
  if (db.isOpen) db.close();
  rmSync(dir, { recursive: true, force: true });
});

function insertConversation(): number {
  const result = db
    .prepare(
      "INSERT INTO conversation (target_content_id, question_target_json, started_at, last_spoken_at) VALUES (?, ?, ?, ?)",
    )
    .run(
      d1.A1,
      JSON.stringify({ kind: "article", contentId: d1.A1 }),
      NOW,
      NOW,
    );
  return Number(result.lastInsertRowid);
}

// 質問を受け付ける（DD-02 FN-015 受け付けの手順 3）。作成中の AI の発言ID を返す。
function ask(conversationId: number, text: string): number {
  const posted = createChat({ db, clock }).postQuestion(conversationId, text);
  expect(posted.kind).toBe("accepted");
  return posted.reply.messageId;
}

function logger() {
  return createLogger({ process: "runner", clock, dir: join(dir, "logs") });
}

function runner(
  source: FakeScriptSource,
  options: { timeoutMs?: number; slots?: number; pollIntervalMs?: number } = {},
) {
  const fake = createFakeAi(source, { dataDir: dir, brainHarnessDir: null });
  const log = logger();
  const purposes = createPurposes({
    db,
    provider: fake.provider,
    clock,
    logger: log,
  });
  const aiRunner = createAiRunner({
    queue: createAiQueue(db, clock),
    execute: purposes.execute,
    logger: log,
    ...options,
  });
  return { fake, purposes, aiRunner };
}

// AI Runner を1回動かし、拾った実行が全て終わるまで待つ（偽の AI とつなぐ。DD-10 1章）。
async function runOnce(source: FakeScriptSource, timeoutMs?: number) {
  const { fake, aiRunner } = runner(source, { timeoutMs });
  await aiRunner.runOnce();
  return fake;
}

function aiRuns(): AiRunRecord[] {
  return db
    .prepare("SELECT * FROM ai_run ORDER BY ai_run_id")
    .all() as unknown as AiRunRecord[];
}

function messageRecord(messageId: number): MessageRecord {
  return db
    .prepare("SELECT * FROM message WHERE message_id = ?")
    .get(messageId) as unknown as MessageRecord;
}

function noticeOf(conversationId: number, messageId: number) {
  return createChat({ db, clock })
    .getConversation(conversationId)
    .messages.find((message) => message.messageId === messageId);
}

describe("質問の応答の失敗の扱い（FN-015 異常系、DD-02 3章 P06 手順 5）", () => {
  it("TC60 1回目が時間の上限で failed（AI_TIMEOUT）、attempt 2 が done。AI の発言は done で、本文は2回目の応答だけ", async () => {
    const C1 = insertConversation();
    const replyId = ask(C1, "今日の天気は？");

    // 1回目: 少し返した後、時間の上限まで終わらない。
    const first = await runOnce(
      { steps: [{ text: "古い続き" }, { hang: true }] },
      300,
    );
    expect(first.calls[0]?.signals).toContain("SIGTERM");
    let runs = aiRuns();
    expect(runs).toHaveLength(2);
    expect(runs[0]).toMatchObject({
      purpose: "answer",
      state: "failed",
      attempt: 1,
      reply_message_id: replyId,
    });
    expect(runs[0]?.failure_reason).toMatch(/^AI_TIMEOUT: /);
    expect(runs[1]).toMatchObject({
      purpose: "answer",
      state: "queued",
      attempt: 2,
      reply_message_id: replyId,
    });
    // 送り直しでは本文を空に戻し、writing のままにする。
    expect(messageRecord(replyId)).toMatchObject({
      body_md: "",
      reply_state: "writing",
    });

    // 2回目: 成功する。
    await runOnce({ steps: [{ text: "晴れ" }, { result: "晴れ" }] });
    runs = aiRuns();
    expect(runs.map((run) => [run.attempt, run.state])).toEqual([
      [1, "failed"],
      [2, "done"],
    ]);
    expect(messageRecord(replyId)).toMatchObject({
      body_md: "晴れ",
      reply_state: "done",
    });
    expect(noticeOf(C1, replyId)?.notice).toBeNull();
  });

  it("TC61 2回とも応答の途中で 0 でない終了コードで終わると、2つとも failed（AI_INTERRUPTED）で、AI の発言は failed、notice は MSG-012", async () => {
    const C1 = insertConversation();
    const replyId = ask(C1, "途中で止まる質問");
    const script = { steps: [{ text: "途中まで" }], exitCode: 1 };

    await runOnce(script);
    expect(aiRuns().map((run) => [run.attempt, run.state])).toEqual([
      [1, "failed"],
      [2, "queued"],
    ]);
    expect(messageRecord(replyId).reply_state).toBe("writing");

    await runOnce(script);
    const runs = aiRuns();
    expect(runs).toHaveLength(2);
    for (const run of runs) {
      expect(run.state).toBe("failed");
      expect(run.failure_reason).toMatch(/^AI_INTERRUPTED: /);
    }
    // attempt 3 は作られない。
    expect(runs.map((run) => run.attempt)).toEqual([1, 2]);
    expect(messageRecord(replyId).reply_state).toBe("failed");
    expect(noticeOf(C1, replyId)).toMatchObject({
      replyState: "failed",
      notice: "MSG-012",
    });
  });

  it("TC62 rate_limit の出来事なら ai_run は1つだけ failed（AI_UNAVAILABLE）。AI の発言は failed で、notice は MSG-013（DD-06 E12）", async () => {
    const C1 = insertConversation();
    const replyId = ask(C1, "使えないときの質問");

    await runOnce({ steps: [{ error: "rate_limit" }], exitCode: 1 });
    const runs = aiRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0]?.state).toBe("failed");
    expect(runs[0]?.failure_reason).toMatch(/^AI_UNAVAILABLE: /);
    expect(messageRecord(replyId).reply_state).toBe("failed");
    expect(noticeOf(C1, replyId)).toMatchObject({
      replyState: "failed",
      notice: "MSG-013",
    });
  });

  it("TC63 AI Runner の起動のとき、running のまま残った answer は failed（AI_INTERRUPTED）になり、attempt 2 が queued", () => {
    const C1 = insertConversation();
    const replyId = ask(C1, "止まる前の質問");
    // 前の AI Runner が処理中のまま止まった（本文の途中まで書いていた）。
    db.prepare(
      "UPDATE ai_run SET state = 'running', started_at = ? WHERE reply_message_id = ?",
    ).run(NOW, replyId);
    db.prepare("UPDATE message SET body_md = '途中' WHERE message_id = ?").run(
      replyId,
    );

    const { purposes } = runner({ steps: [{ result: "x" }] });
    const count = failInterruptedRuns({
      queue: createAiQueue(db, clock),
      fail: purposes.fail,
    });
    expect(count).toBe(1);
    const runs = aiRuns();
    expect(runs).toHaveLength(2);
    expect(runs[0]).toMatchObject({ state: "failed", attempt: 1 });
    expect(runs[0]?.failure_reason).toMatch(/^AI_INTERRUPTED: /);
    expect(runs[1]).toMatchObject({
      purpose: "answer",
      state: "queued",
      attempt: 2,
      reply_message_id: replyId,
    });
    expect(messageRecord(replyId)).toMatchObject({
      body_md: "",
      reply_state: "writing",
    });
  });

  it("TC129 M25 の中で予期しない例外が起きると、answer と relate の実行は failed（INTERNAL）で、attempt 2 は作られない。answer の AI の発言は failed", async () => {
    const C1 = insertConversation();
    const replyId = ask(C1, "例外が起きる質問");
    const relateId = queueRelate(db, d1.todayDeliveryId);

    await runOnce(() => {
      throw new Error("差し込んだ予期しない例外");
    });
    const runs = aiRuns();
    expect(runs).toHaveLength(2);
    const answer = runs.find((run) => run.purpose === "answer");
    const relate = runs.find((run) => run.ai_run_id === relateId);
    for (const run of [answer, relate]) {
      expect(run?.state).toBe("failed");
      expect(run?.failure_reason).toMatch(/^INTERNAL/);
      expect(run?.attempt).toBe(1);
    }
    expect(messageRecord(replyId).reply_state).toBe("failed");
    expect(noticeOf(C1, replyId)?.notice).toBe("MSG-012");
  });
});

describe("拾う順と同時に動かす数（DD-02 3章 P06 手順 2、NFR-017）", () => {
  it("TC64 別々の会話の answer が3つ queued で偽の AI が終わらないとき、running は同時に2つまでで、3つ目は queued のまま", async () => {
    expect(AI_RUNNER_SLOTS).toBe(2);
    const replies = [
      ask(insertConversation(), "1つ目"),
      ask(insertConversation(), "2つ目"),
      ask(insertConversation(), "3つ目"),
    ];
    const { fake, aiRunner } = runner(
      { steps: [{ hang: true }] },
      { timeoutMs: 1_000, pollIntervalMs: 10 },
    );
    aiRunner.start();
    // 何回も拾いに行く間に、処理中の数が 2 を超えないことを確かめる。
    await new Promise((resolve) => setTimeout(resolve, 300));
    const states = aiRuns().map((run) => [run.reply_message_id, run.state]);
    expect(states).toEqual([
      [replies[0], "running"],
      [replies[1], "running"],
      [replies[2], "queued"],
    ]);
    expect(aiRunner.running()).toBe(2);
    expect(fake.calls).toHaveLength(2);
    await aiRunner.stop();
  });

  it("TC64 同じ会話の answer が running なら、その会話の次の answer は拾わない", async () => {
    const C1 = insertConversation();
    const first = ask(C1, "1つ目");
    db.prepare(
      "UPDATE message SET reply_state = 'done' WHERE message_id = ?",
    ).run(first);
    db.prepare(
      "UPDATE ai_run SET state = 'running', started_at = ? WHERE reply_message_id = ?",
    ).run(NOW, first);
    const second = ask(C1, "2つ目");
    expect(createAiQueue(db, clock).pickNext()).toBeNull();
    expect(aiRuns().find((run) => run.reply_message_id === second)?.state).toBe(
      "queued",
    );
  });

  it("TC65 relate と summarize が先に queued、後から answer が queued のとき、枠が1つなら answer が最初に running になる", async () => {
    const C1 = insertConversation();
    clock.set(new Date("2026-12-01T08:00:00.000+09:00"));
    const relateId = queueRelate(db, d1.todayDeliveryId);
    db.prepare(
      "INSERT INTO ai_run (purpose, state, summary_conversation_id, attempt, created_at) VALUES ('summarize', 'queued', ?, 1, ?)",
    ).run(C1, "2026-12-01T08:00:00.000+09:00");
    clock.set(new Date("2026-12-01T08:05:00.000+09:00"));
    const replyId = ask(C1, "後から来た質問");

    const { fake, aiRunner } = runner(
      { steps: [{ text: "答え" }, { result: "答え" }] },
      { slots: 1 },
    );
    await aiRunner.runOnce();
    expect(fake.calls.map((call) => call.purpose)).toEqual(["answer"]);
    const runs = aiRuns();
    expect(runs.find((run) => run.reply_message_id === replyId)?.state).toBe(
      "done",
    );
    expect(runs.find((run) => run.ai_run_id === relateId)?.state).toBe(
      "queued",
    );
    expect(runs.find((run) => run.purpose === "summarize")?.state).toBe(
      "queued",
    );
  });
});
