import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type ConversationApiContext,
  postQuestion,
} from "../src/app/api/_entry/conversation";
import { createDeviceApiContext } from "../src/app/api/_entry/device-api";
import { postResearchReport } from "../src/app/api/_entry/research-report";
import { createFakeAi } from "../src/runner/ai-provider";
import { createAiRunner } from "../src/runner/ai-runner";
import { createPurposes } from "../src/runner/purposes";
import { createAiQueue } from "../src/server/ai-jobs";
import { createDeviceKeyVerifier } from "../src/server/auth/device-key";
import { createSenderKeys } from "../src/server/auth/sender-key";
import { createChat } from "../src/server/chat";
import {
  type Database,
  databasePath,
  openDatabase,
} from "../src/server/db/connection";
import { createIngest } from "../src/server/ingest";
import { createFakeClock, type FakeClock } from "../src/server/shared/clock";
import { createLogger } from "../src/server/shared/logger";
import { createSecret, hashSecret } from "../src/server/shared/secret";
import { NOW, insertD1News, migrate } from "./fixtures/news";

// 10-chat の実装単位11（CR-020）: 質問の応答の渡す内容の組み立て P07 に、週報（M33。対象 `page` の
// ときのその週の週報の全体）を足す。FN-015、DD-01 M25・M33、DD-02 3章 P07。
// 受け入れ基準の DD-10 TC145（結合）。前提は「共通＋D2」（DD-10 3章）で、課題 A の2週目を対象 `page`
// にした会話に質問を送り、偽の AI が受けた標準入力の `material` の中に、課題名、何週目か、状態、
// 現時点の答え、方法の見出しとそのためにはと出典の URL と印と反対の意見、まだ分かっていないこと、
// 今週の変化があることを確かめる。D2 は受け取りの関数（`postResearchReport`）で入れる。

const ORIGIN = "http://localhost:48401";
const BASE = `${ORIGIN}/api/app/conversations`;
const URL_REPORTS = "http://127.0.0.1:48400/api/research/reports";

let dir: string;
let db: Database;
let clock: FakeClock;
let K1: string;
let KR: string;
let context: ConversationApiContext;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-10-research-"));
  clock = createFakeClock(NOW);
  db = openDatabase(databasePath(dir));
  migrate(db);
  // 共通（D1）と端末 ipad の鍵 K1、配信元の鍵 KR（brain-research）。
  insertD1News(db);
  K1 = createSecret();
  db.prepare(
    "INSERT INTO device (device_name, device_key_hash, registered_at, last_used_at) VALUES ('ipad', ?, ?, ?)",
  ).run(hashSecret(K1), "2026-11-20T09:00:00.000+09:00", NOW);
  KR = createSenderKeys({ db, clock }).issue("brain-research").key;
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

// ---- D2 を入れる ----

interface Approach {
  title: string;
  howToMd: string;
  sourceUrls: string[];
  marks: string[];
  counterMd: string | null;
}

async function receive(
  receivedAt: string,
  report: Record<string, unknown> & { topicId: string; week: number },
): Promise<number> {
  clock.set(receivedAt);
  const logger = createLogger({
    process: "web",
    clock,
    dir: join(dir, "logs"),
  });
  const response = await postResearchReport({
    logger,
    senderKeys: createSenderKeys({ db, clock }),
    ingest: createIngest({ db, clock, logger }),
  })(
    new Request(URL_REPORTS, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${KR}`,
      },
      body: JSON.stringify({ source: "brain-research", ...report }),
    }),
  );
  expect(response.status).toBe(200);
  const row = db
    .prepare(
      "SELECT r.content_id FROM research_report AS r JOIN research_topic AS t ON t.topic_id = r.topic_id WHERE t.topic_key = ? AND r.week = ?",
    )
    .get(report.topicId, report.week) as { content_id: number } | undefined;
  if (row === undefined) throw new Error("週報が残っていない");
  return row.content_id;
}

// 課題 A の2週目の方法。印が added、more_sources、disputed の方法が1件ずつと、印の無い方法1件。
// どの項目が材料に入ったかを見分けられるように、見出し、そのためには、出典の URL を方法ごとに変える。
const A2_APPROACHES: Approach[] = [
  {
    title: "ノートを分けて書く",
    howToMd: "話題ごとにノートを1冊ずつ作る。",
    sourceUrls: ["https://example.com/research/notes-1"],
    marks: ["added"],
    counterMd: null,
  },
  {
    title: "週に1回見直す",
    howToMd: "日曜の夜に1週間のメモを読み返す。",
    sourceUrls: [
      "https://example.com/research/review-1",
      "https://example.com/research/review-2",
    ],
    marks: ["more_sources"],
    counterMd: null,
  },
  {
    title: "道具を1つにする",
    howToMd: "メモのアプリを1つに決める。",
    sourceUrls: ["https://example.com/research/tool-1"],
    marks: ["disputed"],
    counterMd: "道具を分けたほうが続くという意見もある。",
  },
  {
    title: "人に話す",
    howToMd: "週に1回、考えたことを人に話す。",
    sourceUrls: ["https://example.com/research/talk-1"],
    marks: [],
    counterMd: null,
  },
];

const A2 = {
  topicId: "second-brain",
  topicTitle: "第二の脳の作り方",
  week: 2,
  sentOn: "2026-12-01",
  status: "active",
  answerMd: "メモを毎日まとめ、週に1回見直す。",
  approaches: A2_APPROACHES,
  unknownsMd: "どこまで細かく分けるか。",
  changesMd: "方法を3件足した。",
};

// D2（DD-10 3章）。課題 A（second-brain、進行中）の1週目（2026-11-24 送り）と2週目（2026-12-01 送り）。
// 課題 B（rag-eval、終了）の1週目（2026-11-23 送り）。既読かどうかは渡す内容に関わらないので変えない。
async function insertD2(): Promise<{ a1: number; a2: number; b1: number }> {
  const b1 = await receive("2026-11-23T07:00:00.000+09:00", {
    topicId: "rag-eval",
    topicTitle: "RAG の評価",
    week: 1,
    sentOn: "2026-11-23",
    status: "ended",
    answerMd: "評価の軸を先に決める。",
    approaches: [
      {
        title: "評価の軸を決める",
        howToMd: "軸を3つに絞る。",
        sourceUrls: ["https://example.com/research/rag-1"],
        marks: [],
        counterMd: null,
      },
    ],
    unknownsMd: "人の評価との差。",
    changesMd: "課題 B の最初の週報",
  });
  const a1 = await receive("2026-11-24T07:00:00.000+09:00", {
    topicId: "second-brain",
    topicTitle: "第二の脳の作り方",
    week: 1,
    sentOn: "2026-11-24",
    status: "active",
    answerMd: "1週目の答えはまだ仮のもの。",
    approaches: [
      {
        title: "1週目だけの方法",
        howToMd: "1週目のやり方。",
        sourceUrls: ["https://example.com/research/week1-only"],
        marks: [],
        counterMd: null,
      },
    ],
    unknownsMd: "1週目のまだ分かっていないこと。",
    changesMd: "課題 A の最初の週報",
  });
  const a2 = await receive("2026-12-01T07:00:00.000+09:00", A2);
  clock.set(NOW);
  return { a1, a2, b1 };
}

// ---- 呼ぶ ----

async function ask(conversationId: number, text: string): Promise<number> {
  const id = String(conversationId);
  const response = await postQuestion(context)(
    new Request(`${BASE}/${id}/questions`, {
      method: "POST",
      headers: {
        cookie: `nexus_device=${K1}`,
        origin: ORIGIN,
        "content-type": "application/json",
      },
      body: JSON.stringify({ text }),
    }),
    { params: Promise.resolve({ conversationId: id }) },
  );
  expect(response.status).toBe(202);
  const body = (await response.json()) as { reply: { messageId: number } };
  return body.reply.messageId;
}

// AI Runner を1回動かし、偽の AI が受けた標準入力を返す（DD-10 1章）。
async function runOnceAndReadStdin(): Promise<string[]> {
  const fake = createFakeAi(
    { steps: [{ text: "答え" }, { result: "答え" }] },
    { dataDir: dir, brainHarnessDir: null },
  );
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
  await runner.runOnce();
  return fake.calls.map((call) => call.stdin);
}

// 渡す内容から、その種類の読む材料の中身を取り出す。
function materialOf(input: string, kind: string): string | null {
  const start = `<material kind="${kind}">\n`;
  const from = input.indexOf(start);
  if (from < 0) return null;
  const to = input.indexOf("\n</material>", from);
  return input.slice(from + start.length, to);
}

describe("TC145 週報を対象 page にした会話の渡す内容（FN-015、DD-02 3章 P07、CR-020）", () => {
  it("material の中に、課題 A の2週目の週報の全体（課題名、何週目か、状態、現時点の答え、方法の各項目、まだ分かっていないこと、今週の変化）がある", async () => {
    const d2 = await insertD2();
    const { conversation, notice } = context.chat.createConversation({
      kind: "page",
      contentId: d2.a2,
    });
    // 内容があるので、対象は捨てられない。
    expect(notice).toBeNull();
    expect(conversation.target).toEqual({ kind: "page", contentId: d2.a2 });

    const replyId = await ask(
      conversation.conversationId,
      "この週報の要点は？",
    );
    const stdins = await runOnceAndReadStdin();

    // 質問の応答として偽の AI が1回呼ばれ、AI の発言は完了になる。
    expect(stdins).toHaveLength(1);
    const reply = db
      .prepare("SELECT reply_state FROM message WHERE message_id = ?")
      .get(replyId) as { reply_state: string };
    expect(reply.reply_state).toBe("done");

    const stdin = stdins[0] ?? "";
    // 対象の内容は `<material kind="target">` に入る（10-chat の実装単位2と同じ囲み。DD-02 3章 P07 手順 1）。
    const target = materialOf(stdin, "target");
    expect(target).not.toBeNull();
    const material = target ?? "";

    // 課題名。
    expect(material).toContain("第二の脳の作り方");
    // 何週目か（2週目）。
    expect(material).toMatch(/2\s*週目|週[^\n]*?[:：]\s*2(?!\d)/);
    // 状態（進行中。IF-005 の値は active）。
    expect(material).toMatch(/進行中|active/);
    // 現時点の答え。
    expect(material).toContain("メモを毎日まとめ、週に1回見直す。");
    // 方法の一覧: 見出し、そのためには、出典の URL（全て）。
    for (const approach of A2_APPROACHES) {
      expect(material).toContain(approach.title);
      expect(material).toContain(approach.howToMd);
      for (const url of approach.sourceUrls) expect(material).toContain(url);
    }
    // 方法の印（3種類とも）。IF-005 の値か、画面の言葉（BD-09）のどちらかで入る。
    expect(material).toMatch(/added|今週足した/);
    expect(material).toMatch(/more_sources|出典が増えた/);
    expect(material).toMatch(/disputed|反対の意見あり/);
    // 反対の意見。
    expect(material).toContain("道具を分けたほうが続くという意見もある。");
    // まだ分かっていないこと。
    expect(material).toContain("どこまで細かく分けるか。");
    // 今週の変化。
    expect(material).toContain("方法を3件足した。");

    // 対象はその週の週報だけで、同じ課題の別の週と別の課題の週報は入れない。
    expect(stdin).not.toContain("1週目の答えはまだ仮のもの。");
    expect(stdin).not.toContain("1週目だけの方法");
    expect(stdin).not.toContain("課題 A の最初の週報");
    expect(stdin).not.toContain("RAG の評価");
    expect(stdin).not.toContain("課題 B の最初の週報");

    // 今の質問は question の材料に入る。
    expect(materialOf(stdin, "question")).toBe("この週報の要点は？");

    // AI の発言の写しは、AI に渡した標準入力と同じ（DD-02 FN-015 応答の手順 2）。
    const copy = db
      .prepare("SELECT ai_input_copy FROM message WHERE message_id = ?")
      .get(replyId) as { ai_input_copy: string | null };
    expect(copy.ai_input_copy).toBe(stdin);
  });
});
