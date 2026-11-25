import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type AiRequest,
  createFakeAi,
  type FakeScript,
} from "../src/runner/ai-provider";
import { createAiRunner } from "../src/runner/ai-runner";
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
import { NOW, type D1News, insertD1News, migrate } from "./fixtures/news";

// 10-chat の実装単位5: 会話の要約（待ちに入れる判断、要約の実行、失敗の扱い）。
// FN-015、DD-01 M25、DD-02 FN-015 会話の要約、Q-076、Q-085。
// 受け入れ基準は TC67、TC68、TC69。

let dir: string;
let db: Database;
let clock: FakeClock;
let d1: D1News;

interface AiRunRecord {
  ai_run_id: number;
  purpose: string;
  state: string;
  summary_conversation_id: number | null;
  reply_message_id: number | null;
  attempt: number;
  failure_reason: string | null;
}

interface ConversationRecord {
  summary_md: string | null;
  summary_last_message_id: number | null;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-10-summarize-"));
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

// 完了した質問と応答の組を、DB に直に入れる。[質問の発言ID, 応答の発言ID] を返す。
function insertPair(
  conversationId: number,
  question: string,
  answer: string,
): [number, number] {
  const q = db
    .prepare(
      "INSERT INTO message (conversation_id, speaker, body_md, sent_at) VALUES (?, 'owner', ?, ?)",
    )
    .run(conversationId, question, NOW);
  const questionId = Number(q.lastInsertRowid);
  const a = db
    .prepare(
      "INSERT INTO message (conversation_id, speaker, body_md, sent_at, reply_state, reply_to_message_id, ai_input_copy) VALUES (?, 'ai', ?, ?, 'done', ?, '写し')",
    )
    .run(conversationId, answer, NOW, questionId);
  return [questionId, Number(a.lastInsertRowid)];
}

// 直近の 6 発言を除いた本文の合計が `olderChars` 文字になる会話（TC67 の前提）。
// 古い組（質問は `olderChars` 文字、応答は空）、短い組を2つ。質問すると、新しい組が足されて
// 直近の 6 発言は短い組2つと新しい組になり、古い組だけが除いた残りになる。
interface Seeded {
  conversationId: number;
  bigQuestion: string;
  olderAnswerId: number;
}

function seedConversation(olderChars: number): Seeded {
  const conversationId = insertConversation();
  // 文字（コードポイント）で数える。
  const bigQuestion = "古".repeat(olderChars);
  const [, olderAnswerId] = insertPair(conversationId, bigQuestion, "");
  insertPair(conversationId, "最近の質問その1", "最近の応答その1");
  insertPair(conversationId, "最近の質問その2", "最近の応答その2");
  return { conversationId, bigQuestion, olderAnswerId };
}

function ask(conversationId: number, text: string): number {
  const posted = createChat({ db, clock }).postQuestion(conversationId, text);
  expect(posted.kind).toBe("accepted");
  return posted.reply.messageId;
}

const SUMMARY_TEXT = "これは古い発言の要約の文です。";

// 目的ごとの筋書き。answer は短い応答、summarize は `summarize` を使う。
function scripts(summarize: FakeScript) {
  return (request: AiRequest): FakeScript =>
    request.purpose === "summarize"
      ? summarize
      : { steps: [{ text: "答えです。" }, { result: "答えです。" }] };
}

const SUMMARIZE_OK: FakeScript = {
  steps: [{ text: SUMMARY_TEXT }, { result: SUMMARY_TEXT }],
};
const SUMMARIZE_FAILS: FakeScript = {
  steps: [{ failure: "要約に失敗した" }],
};

async function runOnce(summarize: FakeScript = SUMMARIZE_OK) {
  const fake = createFakeAi(scripts(summarize), {
    dataDir: dir,
    brainHarnessDir: null,
  });
  const logger = createLogger({
    process: "runner",
    clock,
    dir: join(dir, "logs"),
  });
  const purposes = createPurposes({
    db,
    provider: fake.provider,
    clock,
    logger,
  });
  await createAiRunner({
    queue: createAiQueue(db, clock),
    execute: purposes.execute,
    logger,
  }).runOnce();
  return fake;
}

function aiRuns(): AiRunRecord[] {
  return db
    .prepare("SELECT * FROM ai_run ORDER BY ai_run_id")
    .all() as unknown as AiRunRecord[];
}

function summarizeRuns(conversationId: number): AiRunRecord[] {
  return aiRuns().filter(
    (run) =>
      run.purpose === "summarize" &&
      run.summary_conversation_id === conversationId,
  );
}

function conversationRecord(conversationId: number): ConversationRecord {
  return db
    .prepare(
      "SELECT summary_md, summary_last_message_id FROM conversation WHERE conversation_id = ?",
    )
    .get(conversationId) as unknown as ConversationRecord;
}

function aiInputCopy(messageId: number): string {
  const row = db
    .prepare("SELECT ai_input_copy FROM message WHERE message_id = ?")
    .get(messageId) as { ai_input_copy: string | null };
  return row.ai_input_copy ?? "";
}

// 質問して応答を完了させる。
async function askAndAnswer(conversationId: number, text: string) {
  const replyId = ask(conversationId, text);
  const fake = await runOnce();
  const reply = db
    .prepare("SELECT reply_state FROM message WHERE message_id = ?")
    .get(replyId) as { reply_state: string };
  expect(reply.reply_state).toBe("done");
  return { replyId, fake };
}

describe("会話の要約を待ちに入れる判断（DD-02 FN-015 会話の要約の手順 1。Q-085 の答え）", () => {
  it("TC67 直近の 6 発言を除いた本文が 20,000 文字ちょうどなら summarize は入らず、20,001 文字なら queued になる", async () => {
    const exact = seedConversation(20_000);
    const over = seedConversation(20_001);

    await askAndAnswer(exact.conversationId, "ちょうどの会話の質問");
    expect(summarizeRuns(exact.conversationId)).toEqual([]);

    await askAndAnswer(over.conversationId, "超えた会話の質問");
    const runs = summarizeRuns(over.conversationId);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      state: "queued",
      attempt: 1,
      reply_message_id: null,
    });
    // ちょうどの会話には、超えた会話の質問の後でも入らない。
    expect(summarizeRuns(exact.conversationId)).toEqual([]);
  });

  it("同じ会話の summarize が待ちにあるあいだは、次の質問の応答が完了しても2つ目を作らない（DD-05 3章）", async () => {
    const over = seedConversation(20_001);
    await askAndAnswer(over.conversationId, "1つ目の質問");
    expect(summarizeRuns(over.conversationId)).toHaveLength(1);

    // answer は summarize より先に拾うので、要約が待ちのまま次の応答が完了する。
    const replyId = ask(over.conversationId, "2つ目の質問");
    const fake = createFakeAi(scripts(SUMMARIZE_OK), {
      dataDir: dir,
      brainHarnessDir: null,
    });
    const logger = createLogger({
      process: "runner",
      clock,
      dir: join(dir, "logs"),
    });
    const purposes = createPurposes({
      db,
      provider: fake.provider,
      clock,
      logger,
    });
    // 枠を1つにして、answer だけを拾わせる。
    await createAiRunner({
      queue: createAiQueue(db, clock),
      execute: purposes.execute,
      logger,
      slots: 1,
    }).runOnce();
    expect(fake.calls.map((call) => call.purpose)).toEqual(["answer"]);
    const reply = db
      .prepare("SELECT reply_state FROM message WHERE message_id = ?")
      .get(replyId) as { reply_state: string };
    expect(reply.reply_state).toBe("done");
    const runs = summarizeRuns(over.conversationId);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.state).toBe("queued");
  });
});

describe("会話の要約の実行（DD-02 FN-015 会話の要約の手順 2〜3）", () => {
  it("TC68 要約の文が summary_md に、渡した最後の発言が summary_last_message_id に入り、次の質問の ai_input_copy に要約と直近の発言がある", async () => {
    const over = seedConversation(20_001);
    await askAndAnswer(over.conversationId, "超えた会話の質問");
    expect(summarizeRuns(over.conversationId)[0]?.state).toBe("queued");

    const fake = await runOnce(SUMMARIZE_OK);
    expect(fake.calls).toHaveLength(1);
    const call = fake.calls[0];
    expect(call?.purpose).toBe("summarize");
    // ツール無し（DD-09 2.5）。
    const toolsAt = call?.args.indexOf("--tools") ?? -1;
    expect(toolsAt).toBeGreaterThanOrEqual(0);
    expect(call?.args[toolsAt + 1]).toBe("");
    expect(call?.args).not.toContain("--add-dir");
    // 渡すのは、要約に含めていない発言のうち直近の 6 発言を除いたもの（3章 P07）。
    expect(call?.stdin).toContain(over.bigQuestion);
    expect(call?.stdin).toContain('<material kind="history">');
    expect(call?.stdin).not.toContain("最近の質問その1");
    expect(call?.stdin).not.toContain("超えた会話の質問");
    // 前の要約は無いので、summary の材料は無い。
    expect(call?.stdin).not.toContain('<material kind="summary">');

    expect(summarizeRuns(over.conversationId)[0]?.state).toBe("done");
    expect(conversationRecord(over.conversationId)).toEqual({
      summary_md: SUMMARY_TEXT,
      summary_last_message_id: over.olderAnswerId,
    });

    // 次の質問の渡す内容には、要約と、要約に含めていない直近の発言があり、要約した古い発言は無い。
    const { replyId } = await askAndAnswer(over.conversationId, "次の質問");
    const copy = aiInputCopy(replyId);
    expect(copy).toContain(`<material kind="summary">\n${SUMMARY_TEXT}\n`);
    expect(copy).toContain("最近の質問その1");
    expect(copy).toContain("最近の応答その2");
    expect(copy).toContain("超えた会話の質問");
    expect(copy).not.toContain(over.bigQuestion);
    // 要約した後は、残りが短いので次の要約は入らない。
    expect(summarizeRuns(over.conversationId)).toHaveLength(1);
  });

  it("前の要約があれば、前の要約と新しく古くなった発言を渡し、要約を置き換える", async () => {
    const over = seedConversation(20_001);
    await askAndAnswer(over.conversationId, "1つ目の質問");
    await runOnce(SUMMARIZE_OK);

    // 要約に含めていない発言に、また長い発言を足す（直近の 6 発言より前になるよう、後ろに短い組を2つ）。
    const second = "新".repeat(20_001);
    const [, secondAnswerId] = insertPair(over.conversationId, second, "");
    insertPair(over.conversationId, "短い質問A", "短い応答A");
    insertPair(over.conversationId, "短い質問B", "短い応答B");
    await askAndAnswer(over.conversationId, "2つ目の質問");
    expect(summarizeRuns(over.conversationId).map((run) => run.state)).toEqual([
      "done",
      "queued",
    ]);

    const fake = await runOnce({
      steps: [{ result: "置き換えた要約" }],
    });
    const stdin = fake.calls[0]?.stdin ?? "";
    expect(stdin).toContain(`<material kind="summary">\n${SUMMARY_TEXT}\n`);
    expect(stdin).toContain(second);
    expect(stdin).toContain("1つ目の質問");
    expect(stdin).not.toContain(over.bigQuestion);
    expect(stdin).not.toContain("短い質問A");
    expect(conversationRecord(over.conversationId)).toEqual({
      summary_md: "置き換えた要約",
      summary_last_message_id: secondAnswerId,
    });
  });
});

describe("会話の要約の失敗の扱い（DD-02 FN-015 会話の要約の手順 4）", () => {
  it("TC69 summarize は failed で attempt 2 は作られず、次の質問の応答の完了の後にもう一度 queued になる", async () => {
    const over = seedConversation(20_001);
    await askAndAnswer(over.conversationId, "超えた会話の質問");
    expect(summarizeRuns(over.conversationId)[0]?.state).toBe("queued");

    const fake = await runOnce(SUMMARIZE_FAILS);
    expect(fake.calls.map((call) => call.purpose)).toEqual(["summarize"]);
    let runs = summarizeRuns(over.conversationId);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ state: "failed", attempt: 1 });
    expect(runs[0]?.failure_reason).toMatch(/^AI_INTERRUPTED: /);
    // 自動で送り直さない（AI_INTERRUPTED でも attempt 2 を作らない）。
    expect(aiRuns().filter((run) => run.state === "queued")).toEqual([]);
    // 会話の要約は変わらない。
    expect(conversationRecord(over.conversationId)).toEqual({
      summary_md: null,
      summary_last_message_id: null,
    });

    // 次の質問は受け付けられ、応答の完了の後にもう一度 queued になる。
    await askAndAnswer(over.conversationId, "次の質問");
    runs = summarizeRuns(over.conversationId);
    expect(runs.map((run) => [run.state, run.attempt])).toEqual([
      ["failed", 1],
      ["queued", 1],
    ]);
  });
});
