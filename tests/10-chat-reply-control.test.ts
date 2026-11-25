import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDeviceApiContext } from "../src/app/api/_entry/device-api";
import {
  type ReplyActionApiContext,
  dismissReply,
  retryReply,
  stopReply,
} from "../src/app/api/_entry/reply-action";
import { createFakeAi, type FakeScriptSource } from "../src/runner/ai-provider";
import { createAiRunner } from "../src/runner/ai-runner";
import { createPurposes } from "../src/runner/purposes";
import { RunStopRequested } from "../src/runner/purposes/outcome";
import { type PickedRun, createAiQueue } from "../src/server/ai-jobs";
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

// 10-chat の実装単位6: `retryReply`、`stopReply`、`dismissReply` と、AI Runner の止める求めの見張り。
// FN-016、DD-02 FN-016、DD-02 3章 P06 手順 3、DD-05 3章。受け入れ基準は TC71、TC72、TC74、TC123。

const ORIGIN = "http://localhost:48401";
const BASE = `${ORIGIN}/api/app/messages`;

let dir: string;
let db: Database;
let clock: FakeClock;
let K1: string;
let d1: D1News;
let C1: number;
let context: ReplyActionApiContext;

interface Message {
  messageId: number;
  speaker: string;
  bodyMd: string;
  replyState: string | null;
  notice: string | null;
}

interface AiRunRecord {
  ai_run_id: number;
  purpose: string;
  state: string;
  reply_message_id: number | null;
  attempt: number;
  finished_at: string | null;
  stop_requested: number;
}

interface MessageRecord {
  message_id: number;
  body_md: string;
  reply_state: string | null;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-10-reply-control-"));
  clock = createFakeClock(NOW);
  db = openDatabase(databasePath(dir));
  migrate(db);
  d1 = insertD1News(db);
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
      logger: logger("web"),
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

function logger(process: "web" | "runner") {
  return createLogger({ process, clock, dir: join(dir, "logs") });
}

type Action = "retry" | "stop" | "dismiss";
const HANDLERS = { retry: retryReply, stop: stopReply, dismiss: dismissReply };

function callAction(
  action: Action,
  messageId: number | string,
  origin: string = ORIGIN,
): Promise<Response> {
  const id = String(messageId);
  return HANDLERS[action](context)(
    new Request(`${BASE}/${id}/${action}`, {
      method: "POST",
      headers: { cookie: `nexus_device=${K1}`, origin },
    }),
    { params: Promise.resolve({ messageId: id }) },
  );
}

async function act(action: Action, messageId: number): Promise<Message> {
  const response = await callAction(action, messageId);
  expect(response.status).toBe(200);
  return (await response.json()) as Message;
}

// 質問を受け付ける。作成中の AI の発言ID を返す（実行は待ち）。
function ask(text = "今日の天気は？"): number {
  const posted = createChat({ db, clock }).postQuestion(C1, text);
  expect(posted.kind).toBe("accepted");
  return posted.reply.messageId;
}

function runner(source: FakeScriptSource) {
  const fake = createFakeAi(source, { dataDir: dir, brainHarnessDir: null });
  const log = logger("runner");
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
    stopCheckIntervalMs: 20,
  });
  return { fake, purposes, aiRunner };
}

async function runOnce(source: FakeScriptSource): Promise<void> {
  await runner(source).aiRunner.runOnce();
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

function snapshot() {
  return {
    messages: db.prepare("SELECT * FROM message ORDER BY message_id").all(),
    runs: db.prepare("SELECT * FROM ai_run ORDER BY ai_run_id").all(),
  };
}

// 実行と AI の発言の状態の組。
function states(replyId: number): [string | undefined, string | null] {
  const runs = aiRuns().filter((run) => run.reply_message_id === replyId);
  return [runs.at(-1)?.state, messageRecord(replyId).reply_state];
}

async function waitFor(condition: () => boolean, limitMs = 3000) {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > limitMs) throw new Error("待ちきれなかった");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function noticeInConversation(replyId: number): string | null | undefined {
  return createChat({ db, clock })
    .getConversation(C1)
    .messages.find((message) => message.messageId === replyId)?.notice;
}

// 失敗した応答を作る（E12 は自動で送り直さない）。
async function failedReply(): Promise<number> {
  const replyId = ask();
  await runOnce({ steps: [{ error: "authentication_failed" }] });
  expect(messageRecord(replyId).reply_state).toBe("failed");
  return replyId;
}

describe("止める（FN-016 手順 3、DD-02 3章 P06 手順 3）", () => {
  it("TC71 待ちの応答を止めると、ai_run は cancelled（finished_at あり）で、AI の発言も cancelled、notice は MSG-014", async () => {
    const replyId = ask();
    clock.set(new Date("2026-12-01T08:10:00.000+09:00"));

    const body = await act("stop", replyId);
    expect(body).toMatchObject({
      messageId: replyId,
      replyState: "cancelled",
      notice: "MSG-014",
    });
    const [run] = aiRuns();
    expect(run).toMatchObject({
      state: "cancelled",
      finished_at: "2026-12-01T08:10:00.000+09:00",
      stop_requested: 0,
    });
    expect(noticeInConversation(replyId)).toBe("MSG-014");
    // 中止にした実行は拾わない。
    expect(createAiQueue(db, clock).pickNext()).toBeNull();
  });

  it("TC71 処理中の応答を止めると、stop_requested が 1 になり、AI Runner が止めて両方 cancelled。それまでの本文は残る", async () => {
    const replyId = ask();
    const { fake, aiRunner } = runner({
      steps: [{ text: "途中までの応答" }, { hang: true }],
    });
    const done = aiRunner.runOnce();
    await waitFor(() => messageRecord(replyId).body_md === "途中までの応答");

    const body = await act("stop", replyId);
    // 止める求めを出した時点では、まだ作成中。
    expect(body.replyState).toBe("writing");
    expect(aiRuns()[0]).toMatchObject({ state: "running", stop_requested: 1 });

    await done;
    expect(fake.calls[0]?.signals).toContain("SIGTERM");
    expect(aiRuns()).toHaveLength(1);
    expect(aiRuns()[0]).toMatchObject({
      state: "cancelled",
      stop_requested: 1,
    });
    expect(aiRuns()[0]?.finished_at).not.toBeNull();
    expect(messageRecord(replyId)).toMatchObject({
      body_md: "途中までの応答",
      reply_state: "cancelled",
    });
    expect(noticeInConversation(replyId)).toBe("MSG-014");
  });

  it("止める求めを2回送っても、stop_requested は 1 のままで、今の発言を返す", async () => {
    const replyId = ask();
    createAiQueue(db, clock).pickNext();
    expect((await act("stop", replyId)).replyState).toBe("writing");
    expect((await act("stop", replyId)).replyState).toBe("writing");
    expect(aiRuns()[0]).toMatchObject({ state: "running", stop_requested: 1 });
  });
});

describe("送り直す（FN-016 手順 2、DD-05 3章）", () => {
  it("TC72 失敗した応答に retryReply を続けて2回送ると、新しい ai_run（attempt 1）は1つだけで、2回目は今の発言を返す", async () => {
    const replyId = await failedReply();

    const first = await act("retry", replyId);
    expect(first).toMatchObject({
      messageId: replyId,
      bodyMd: "",
      replyState: "writing",
      notice: null,
    });
    const second = await act("retry", replyId);
    expect(second).toEqual(first);

    const runs = aiRuns();
    expect(runs.map((run) => [run.attempt, run.state])).toEqual([
      [1, "failed"],
      [1, "queued"],
    ]);
    expect(messageRecord(replyId)).toMatchObject({
      body_md: "",
      reply_state: "writing",
    });
  });

  it("TC72 2つの求めを同時に送っても、送り直すのは1回だけ", async () => {
    const replyId = await failedReply();
    const responses = await Promise.all([
      callAction("retry", replyId),
      callAction("retry", replyId),
    ]);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(aiRuns().filter((run) => run.state === "queued")).toHaveLength(1);
  });

  it("中止した応答も送り直せ、本文を空にして、送り直した実行で完了する", async () => {
    const replyId = ask();
    const { aiRunner } = runner({ steps: [{ text: "古い" }, { hang: true }] });
    const done = aiRunner.runOnce();
    await waitFor(() => messageRecord(replyId).body_md === "古い");
    await act("stop", replyId);
    await done;
    expect(messageRecord(replyId).reply_state).toBe("cancelled");

    expect(await act("retry", replyId)).toMatchObject({
      bodyMd: "",
      replyState: "writing",
    });
    await runOnce({ steps: [{ text: "新しい" }, { result: "新しい" }] });
    expect(messageRecord(replyId)).toMatchObject({
      body_md: "新しい",
      reply_state: "done",
    });
    expect(aiRuns().map((run) => [run.attempt, run.state])).toEqual([
      [1, "cancelled"],
      [1, "done"],
    ]);
  });
});

describe("やめる（FN-016 手順 4）", () => {
  it("失敗した応答は cancelled になり、ai_run は failed のまま残る", async () => {
    const replyId = await failedReply();
    expect(await act("dismiss", replyId)).toMatchObject({
      replyState: "cancelled",
      notice: "MSG-014",
    });
    expect(aiRuns().map((run) => run.state)).toEqual(["failed"]);
  });

  it("作成中の応答をやめる求めは、何もせずに今の発言を返す", async () => {
    const replyId = ask();
    const before = snapshot();
    expect((await act("dismiss", replyId)).replyState).toBe("writing");
    expect(snapshot()).toEqual(before);
  });
});

describe("許されない遷移（BD-02 3章）", () => {
  it("TC74 完了した応答への retryReply、stopReply、dismissReply は、どれも 200 で完了の発言を返し、データは変わらない", async () => {
    const replyId = ask();
    await runOnce({ steps: [{ text: "晴れ" }, { result: "晴れ" }] });
    expect(messageRecord(replyId).reply_state).toBe("done");
    const before = snapshot();

    for (const action of ["retry", "stop", "dismiss"] as const) {
      const body = await act(action, replyId);
      expect(body).toMatchObject({
        messageId: replyId,
        bodyMd: "晴れ",
        replyState: "done",
        notice: null,
      });
    }
    expect(snapshot()).toEqual(before);
  });

  it("発言が無いか本人の発言なら 404 と MSG-019、ほかのオリジンなら 403", async () => {
    const replyId = ask();
    const ownerId = replyId - 1;
    for (const action of ["retry", "stop", "dismiss"] as const) {
      for (const id of [999, ownerId, "abc"]) {
        const response = await callAction(action, id);
        expect(response.status).toBe(404);
        const body = (await response.json()) as {
          error: { messageId: string };
        };
        expect(body.error.messageId).toBe("MSG-019");
      }
      const denied = await callAction(action, replyId, "http://evil.example");
      expect(denied.status).toBe(403);
    }
    expect(messageRecord(replyId).reply_state).toBe("writing");
    expect(aiRuns()[0]?.state).toBe("queued");
  });
});

describe("止めると完了が同時（DD-05 3章 ENT-008・ENT-009）", () => {
  // 処理中の応答を用意し、拾った実行を返す。
  function runningReply(): { replyId: number; run: PickedRun } {
    const replyId = ask();
    const run = createAiQueue(db, clock).pickNext();
    if (run === null) throw new Error("拾えなかった");
    return { replyId, run };
  }

  const success = { steps: [{ text: "晴れ" }, { result: "晴れ" }] };

  // AI Runner の完了のトランザクションを流す（偽の AI はすぐ成功で終わる）。
  async function complete(run: PickedRun) {
    await runner(success).purposes.execute(run);
  }

  // AI Runner が止める求めを見て止めたときのトランザクションを流す。
  async function cancelByRunner(run: PickedRun) {
    const controller = new AbortController();
    controller.abort(new RunStopRequested());
    await runner(success).purposes.execute(run, { signal: controller.signal });
  }

  it("TC123 stopReply が先、AI Runner の完了が後: 両方 done", async () => {
    const { replyId, run } = runningReply();
    expect((await act("stop", replyId)).replyState).toBe("writing");
    await complete(run);
    expect(states(replyId)).toEqual(["done", "done"]);
  });

  it("TC123 AI Runner の完了が先、stopReply が後: 両方 done で、stopReply は完了の発言を返す", async () => {
    const { replyId, run } = runningReply();
    await complete(run);
    expect((await act("stop", replyId)).replyState).toBe("done");
    expect(states(replyId)).toEqual(["done", "done"]);
    expect(aiRuns()[0]?.stop_requested).toBe(0);
  });

  it("TC123 AI Runner の中止が先、完了が後: 両方 cancelled", async () => {
    const { replyId, run } = runningReply();
    await act("stop", replyId);
    await cancelByRunner(run);
    expect(states(replyId)).toEqual(["cancelled", "cancelled"]);
    await complete(run);
    expect(states(replyId)).toEqual(["cancelled", "cancelled"]);
  });

  it("TC123 AI Runner の完了が先、中止が後: 両方 done", async () => {
    const { replyId, run } = runningReply();
    await act("stop", replyId);
    await complete(run);
    await cancelByRunner(run);
    expect(states(replyId)).toEqual(["done", "done"]);
    expect(messageRecord(replyId).body_md).toBe("晴れ");
  });
});
