import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createFakeAi,
  type AiCall,
  type AiEvent,
  type AiExit,
  type FakeScriptSource,
} from "../src/runner/ai-provider";
import { createAiRunner } from "../src/runner/ai-runner";
import { createPurposes } from "../src/runner/purposes";
import { readAiCall, timeoutError } from "../src/runner/purposes/outcome";
import { createAiQueue } from "../src/server/ai-jobs";
import { type Database, openDatabase } from "../src/server/db/connection";
import { type AiRunRow, findAiRun } from "../src/server/repositories/ai-run";
import { listRelations } from "../src/server/repositories/article-relation";
import { createFakeClock } from "../src/server/shared/clock";
import { NexusError } from "../src/server/shared/errors";
import { createLogger } from "../src/server/shared/logger";
import {
  type D1News,
  NOW,
  insertD1News,
  insertRelation,
  migrate,
  queueRelate,
} from "./fixtures/news";

// 04-ai-runner の実装単位3: 記事の関係の判定の同時の置き換えと失敗の扱い
// （時間の上限、形が読めない、仕組みが使えない、自動の送り直し）。
// FN-002、DD-02 3章 P06、DD-05 3章、DD-06 E09・E10・E12。受け入れ基準は TC14、TC15、TC16、TC17。

let dir: string;
let logDir: string;
let db: Database;
let news: D1News;
let runId: number;
const clock = createFakeClock(NOW);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-relate-failure-"));
  logDir = join(dir, "logs");
  db = openDatabase(join(dir, "nexus.db"));
  migrate(db);
  news = insertD1News(db);
  runId = queueRelate(db, news.todayDeliveryId);
  clock.set(NOW);
});

afterEach(() => {
  if (db.isOpen) db.close();
  rmSync(dir, { recursive: true, force: true });
});

function logLines(): Record<string, unknown>[] {
  const path = join(logDir, "runner-2026-12-01.log");
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function relateRuns(): AiRunRow[] {
  return db
    .prepare(
      "SELECT ai_run_id FROM ai_run WHERE purpose = 'relate' ORDER BY ai_run_id",
    )
    .all()
    .map((row) => findAiRun(db, Number(row.ai_run_id)))
    .filter((run): run is AiRunRow => run !== null);
}

function contentCount(): number {
  return Number(
    (db.prepare("SELECT COUNT(*) AS n FROM content").get() as { n: number }).n,
  );
}

// AI Runner を1回動かす（偽の AI とつなぐ。DD-10 1章）。
async function runOnce(source: FakeScriptSource, timeoutMs?: number) {
  const fake = createFakeAi(source, { dataDir: dir, brainHarnessDir: null });
  const logger = createLogger({ process: "runner", clock, dir: logDir });
  const runner = createAiRunner({
    queue: createAiQueue(db, clock),
    execute: createPurposes({ db, provider: fake.provider, clock, logger })
      .execute,
    logger,
    timeoutMs,
  });
  await runner.runOnce();
  return fake;
}

function relationsResult(
  relations: { from: number; to: number; type: string }[],
): string {
  return JSON.stringify({
    relations: relations.map((r) => ({
      ...r,
      reason: `${r.from} と ${r.to} の根拠`,
    })),
  });
}

describe("TC14 判定の途中で記事が置き換えられたとき（DD-02 FN-002 手順 7.1、DD-05 3章）", () => {
  it("TC14 置き換えられた A2 を含む組は残らず、A2 を含まない組は残る", async () => {
    const { A1, A2, A3, P1 } = news;
    // 前の判定で残っていた A2→A3 は、置き換えられた記事を含むので変えない（手順 7.3）。
    insertRelation(db, A2, A3, "follow_up");
    await runOnce((request) => {
      // 偽の AI が応答を返す前に、A2 を置き換えと同じ状態にする（`received_at` を `created_at` より後に）。
      expect(request.purpose).toBe("relate");
      db.prepare("UPDATE content SET received_at = ? WHERE content_id = ?").run(
        "2026-12-01T08:00:30.000+09:00",
        A2,
      );
      return {
        steps: [
          {
            result: relationsResult([
              { from: A1, to: A2, type: "follow_up" },
              { from: A1, to: P1, type: "background" },
            ]),
          },
        ],
      };
    });

    const relations = listRelations(db);
    const touchesA2 = relations.filter(
      (r) =>
        (r.fromContentId === A1 && r.toContentId === A2) ||
        (r.fromContentId === A2 && r.toContentId === A1),
    );
    expect(touchesA2).toEqual([]);
    expect(relations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fromContentId: A1,
          toContentId: P1,
          relationType: "background",
          isActive: true,
          judgedAt: NOW,
        }),
        expect.objectContaining({
          fromContentId: A2,
          toContentId: A3,
          relationType: "follow_up",
          isActive: true,
        }),
      ]),
    );
    expect(relations).toHaveLength(2);
    expect(findAiRun(db, runId)?.state).toBe("done");
  });

  it("TC14 実行を待ちに入れる前に届いた記事（received_at が created_at 以前）は置き換えとみなさない", async () => {
    const { A1, A2 } = news;
    db.prepare("UPDATE content SET received_at = ? WHERE content_id = ?").run(
      NOW,
      A2,
    );
    await runOnce({
      steps: [
        { result: relationsResult([{ from: A1, to: A2, type: "follow_up" }]) },
      ],
    });
    expect(listRelations(db)).toEqual([
      expect.objectContaining({ fromContentId: A1, toContentId: A2 }),
    ]);
  });
});

describe("TC15 時間の上限（FN-002 異常系、DD-02 3章 P06、DD-06 E09）", () => {
  it("TC15 1回目が AI_TIMEOUT で failed、attempt 2 が queued。2回目も上限を過ぎると failed で attempt 3 は無く、ログに MSG-037", async () => {
    const { A1, P1 } = news;
    insertRelation(db, A1, P1, "background");
    const before = listRelations(db);
    const contents = contentCount();

    const first = await runOnce({ steps: [{ hang: true }] }, 30);
    let runs = relateRuns();
    expect(runs).toHaveLength(2);
    expect(runs[0]).toMatchObject({
      aiRunId: runId,
      state: "failed",
      attempt: 1,
      finishedAt: NOW,
    });
    expect(runs[0].failureReason?.startsWith("AI_TIMEOUT")).toBe(true);
    expect(runs[1]).toMatchObject({
      state: "queued",
      attempt: 2,
      relateDeliveryId: news.todayDeliveryId,
    });
    expect(first.calls).toHaveLength(1);
    expect(first.calls[0].signals).toContain("SIGTERM");
    expect(logLines().some((line) => line.msg === "MSG-037")).toBe(false);

    const second = await runOnce({ steps: [{ hang: true }] }, 30);
    runs = relateRuns();
    expect(runs).toHaveLength(2);
    expect(runs[1].state).toBe("failed");
    expect(runs[1].failureReason?.startsWith("AI_TIMEOUT")).toBe(true);
    expect(second.calls[0].signals).toContain("SIGTERM");

    const msg037 = logLines().filter((line) => line.msg === "MSG-037");
    expect(msg037).toHaveLength(1);
    expect(msg037[0]).toMatchObject({
      level: "error",
      code: "AI_TIMEOUT",
      target: "FN-002",
      aiRunId: runs[1].aiRunId,
      deliveryId: news.todayDeliveryId,
    });
    expect(String(msg037[0].detail)).toContain(
      "記事の関係を判定できませんでした（AI_TIMEOUT",
    );

    // 記事は残り、関係は変わらない。
    expect(contentCount()).toBe(contents);
    expect(listRelations(db)).toEqual(before);
  });

  it("TC15 2回目が成功すれば done になり、関係が残る", async () => {
    const { A1, A2 } = news;
    await runOnce({ steps: [{ hang: true }] }, 30);
    await runOnce(
      {
        steps: [
          {
            result: relationsResult([{ from: A1, to: A2, type: "follow_up" }]),
          },
        ],
      },
      30_000,
    );
    const runs = relateRuns();
    expect(runs.map((r) => r.state)).toEqual(["failed", "done"]);
    expect(listRelations(db)).toHaveLength(1);
    expect(logLines().some((line) => line.msg === "MSG-037")).toBe(false);
  });
});

describe("TC16 応答の形が正しくない（DD-06 E10）", () => {
  it("TC16 JSON でない文を返すと failed（AI_BAD_OUTPUT）と attempt 2 の queued", async () => {
    await runOnce({ steps: [{ result: "関係は A1 と A2 です。" }] });
    const runs = relateRuns();
    expect(runs).toHaveLength(2);
    expect(runs[0].state).toBe("failed");
    expect(runs[0].failureReason?.startsWith("AI_BAD_OUTPUT")).toBe(true);
    expect(runs[1]).toMatchObject({ state: "queued", attempt: 2 });
    expect(listRelations(db)).toEqual([]);
  });

  it("TC16 stream-json の行が JSON として読めないときも AI_BAD_OUTPUT で送り直す", async () => {
    await runOnce({
      steps: [{ raw: "{読めない行" }, { result: '{"relations":[]}' }],
    });
    const runs = relateRuns();
    expect(runs[0].failureReason?.startsWith("AI_BAD_OUTPUT")).toBe(true);
    expect(runs[1]).toMatchObject({ state: "queued", attempt: 2 });
  });

  it("TC16 2回目も形が正しくなければ attempt 3 は作られず、ログに MSG-037", async () => {
    await runOnce({ steps: [{ result: "JSON ではない" }] });
    await runOnce({ steps: [{ result: "JSON ではない" }] });
    const runs = relateRuns();
    expect(runs.map((r) => [r.attempt, r.state])).toEqual([
      [1, "failed"],
      [2, "failed"],
    ]);
    expect(
      logLines().filter(
        (line) => line.msg === "MSG-037" && line.code === "AI_BAD_OUTPUT",
      ),
    ).toHaveLength(1);
  });
});

describe("TC17 AI を動かす仕組みが使えない（DD-06 E12）", () => {
  it("TC17 authentication_failed の出来事で failed（AI_UNAVAILABLE）。attempt 2 は作られず、ログに MSG-037", async () => {
    await runOnce({
      steps: [
        { error: "authentication_failed" },
        { failure: "Invalid API key" },
      ],
      exitCode: 1,
    });
    const runs = relateRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0].state).toBe("failed");
    expect(runs[0].failureReason?.startsWith("AI_UNAVAILABLE")).toBe(true);
    const msg037 = logLines().filter((line) => line.msg === "MSG-037");
    expect(msg037).toHaveLength(1);
    expect(msg037[0]).toMatchObject({
      level: "error",
      code: "AI_UNAVAILABLE",
      target: "FN-002",
      aiRunId: runId,
    });
    expect(listRelations(db)).toEqual([]);
  });

  it("TC17 rate_limit も送り直さない", async () => {
    await runOnce({ steps: [{ error: "rate_limit" }], exitCode: 1 });
    const runs = relateRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0].failureReason?.startsWith("AI_UNAVAILABLE")).toBe(true);
  });
});

// 失敗の分け方（DD-04 4.2 の表、DD-06 E09〜E12）を、M25 が使う読み取りの関数で確かめる。
describe("AI の呼び出しの終わりの分け方（DD-04 4.2、DD-06 E09〜E12）", () => {
  function callOf(events: AiEvent[], exit: AiExit): AiCall {
    return {
      events: (async function* () {
        yield* events;
      })(),
      exit: Promise.resolve(exit),
    };
  }
  const exited = (exitCode: number | null): AiExit => ({
    kind: "exited",
    exitCode,
    signal: exitCode === null ? "SIGSEGV" : null,
    stderr: "",
  });
  const success: AiEvent = {
    type: "result",
    ok: true,
    subtype: "success",
    result: "{}",
    errors: [],
  };
  async function codeOf(call: AiCall, signal?: AbortSignal) {
    try {
      await readAiCall(call, { signal });
      return "ok";
    } catch (error) {
      return error instanceof NexusError ? error.code : "other";
    }
  }

  it("成功の終わりの出来事と終了コード 0 なら result の文を返す", async () => {
    await expect(readAiCall(callOf([success], exited(0)))).resolves.toBe("{}");
  });

  it("止める合図で止めたときは合図の理由（時間の上限なら AI_TIMEOUT）", async () => {
    const controller = new AbortController();
    controller.abort(timeoutError());
    expect(
      await codeOf(
        callOf([], { kind: "stopped", killed: false, signal: "SIGTERM" }),
        controller.signal,
      ),
    ).toBe("AI_TIMEOUT");
  });

  it("CLI を起動できないときは AI_UNAVAILABLE", async () => {
    expect(
      await codeOf(callOf([], { kind: "launch_failed", reason: "ENOENT" })),
    ).toBe("AI_UNAVAILABLE");
  });

  it("仕組みが使えない error は AI_UNAVAILABLE、ほかの error は AI_INTERRUPTED", async () => {
    for (const error of [
      "authentication_failed",
      "oauth_org_not_allowed",
      "account_on_hold",
      "billing_error",
      "rate_limit",
    ]) {
      expect(
        await codeOf(
          callOf([{ type: "assistant_error", error }, success], exited(0)),
        ),
      ).toBe("AI_UNAVAILABLE");
    }
    expect(
      await codeOf(
        callOf(
          [{ type: "assistant_error", error: "overloaded" }, success],
          exited(0),
        ),
      ),
    ).toBe("AI_INTERRUPTED");
  });

  it("0 でない終了コードは AI_INTERRUPTED、result が無く終了コード 0 は AI_BAD_OUTPUT", async () => {
    expect(await codeOf(callOf([], exited(1)))).toBe("AI_INTERRUPTED");
    expect(await codeOf(callOf([], exited(null)))).toBe("AI_INTERRUPTED");
    expect(await codeOf(callOf([], exited(0)))).toBe("AI_BAD_OUTPUT");
  });

  it("result の subtype が success 以外は AI_INTERRUPTED で、理由の鍵の形は伏せる", async () => {
    const key = "A".repeat(43);
    try {
      await readAiCall(
        callOf(
          [
            {
              type: "result",
              ok: false,
              subtype: "error_max_turns",
              result: null,
              errors: [`失敗 ${key}`],
            },
          ],
          exited(0),
        ),
      );
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(NexusError);
      expect((error as NexusError).code).toBe("AI_INTERRUPTED");
      expect((error as NexusError).message).toContain("error_max_turns");
      expect((error as NexusError).message).not.toContain(key);
    }
  });
});
