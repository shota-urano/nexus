import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createFakeAi } from "../src/runner/ai-provider";
import { createAiRunner } from "../src/runner/ai-runner";
import { createPurposes } from "../src/runner/purposes";
import { createAiQueue } from "../src/server/ai-jobs";
import { createChat } from "../src/server/chat";
import { createContents } from "../src/server/contents";
import {
  type Database,
  databasePath,
  openDatabase,
} from "../src/server/db/connection";
import { applyMigrations } from "../src/server/db/migrations";
import { createIngest, type Ingest } from "../src/server/ingest";
import { isKind, registerKind } from "../src/server/kinds";
import { createFakeClock, type FakeClock } from "../src/server/shared/clock";
import { NexusError } from "../src/server/shared/errors";
import { createLogger } from "../src/server/shared/logger";
import { NOW } from "./fixtures/news";
import {
  MEMO_KIND,
  findMemo,
  memoChat,
  memoIngest,
  memoMigrations,
} from "./fixtures/memo-kind";

// 10-chat の実装単位8: 種類の一覧 M14 に、テストだけの3つ目の種類「メモ」を足して、
// 共通の部分（M13 受け取り、M17 内容の状態と一覧、M18 会話、DD-02 3章 P08 検索の索引）を変えずに
// 動くことを確かめる。NFR-004、REQ-019、DD-01 M14、DD-03 2.2 `content.kind`。受け入れ基準は TC110。
// 足したものは tests/fixtures/memo-kind/ の種類のモジュールとテスト用のマイグレーションと、
// M14 の `registerKind` による一覧への登録だけである。

const PAGE = { after: null, limit: 20 };

let dir: string;
let db: Database;
let clock: FakeClock;
let ingest: Ingest;

beforeAll(() => {
  // 一覧への登録（DD-01 M14）。テストのファイルごとにモジュールは分かれるので、ほかのテストには残らない。
  registerKind(memoIngest, memoChat);
});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-10-kind-"));
  clock = createFakeClock(NOW);
  db = openDatabase(databasePath(dir));
  // 本番のマイグレーションの後に、メモの中身のテーブルを作るテスト用のマイグレーションを当てる。
  applyMigrations(db, memoMigrations(), clock);
  const logger = createLogger({
    process: "web",
    clock,
    dir: join(dir, "logs"),
  });
  ingest = createIngest({ db, clock, logger });
});

afterEach(() => {
  if (db.isOpen) db.close();
  rmSync(dir, { recursive: true, force: true });
});

function count(table: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as {
    n: number;
  };
  return Number(row.n);
}

const MEMO_PAYLOAD = {
  date: "2026-12-01",
  items: [
    {
      key: "m1",
      title: "買い物のメモ",
      bodyMd: "牛乳と卵とＫｉｗｉを買う。",
    },
    {
      key: "m2",
      title: "読書のメモ",
      bodyMd: "第3章まで読んだ。",
    },
  ],
};

function memoContentId(title: string): number {
  const row = db
    .prepare("SELECT content_id FROM content WHERE kind = ? AND title = ?")
    .get(MEMO_KIND, title) as { content_id: number } | undefined;
  if (row === undefined) throw new Error(`メモが無い: ${title}`);
  return Number(row.content_id);
}

// 共通の部分のファイル（DD-01 M13、M17、M18、M25 の P07 の共通の手順、P08 の索引の書き込み）。
const COMMON_FILES = [
  "src/server/ingest/index.ts",
  "src/server/contents/index.ts",
  "src/server/chat/index.ts",
  "src/server/repositories/content.ts",
  "src/server/repositories/content-state.ts",
  "src/server/repositories/search-index.ts",
  "src/server/repositories/conversation.ts",
  "src/runner/purposes/answer.ts",
];

describe("TC110 テストだけの3つ目の種類を M14 に足すと、M13、M17、M18 と P08 を変えずに全て動く", () => {
  it("一覧に登録した種類は M14 で引ける", () => {
    expect(isKind(MEMO_KIND)).toBe(true);
    expect(isKind("news")).toBe(true);
    expect(isKind("english")).toBe(true);
  });

  it("共通の部分は種類の値を直に分けず、種類ごとのモジュールを読み込まない（NFR-004）", () => {
    for (const file of COMMON_FILES) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toMatch(/kinds\/(?:news|english)/u);
      expect(source, file).not.toMatch(/["'`](?:news|english|memo)["'`]/u);
    }
  });

  it("受け取り（M13）が、形の確かめと中身を残す処理を M14 から引き、内容と中身と検索の索引を残す", () => {
    const outcome = ingest.receive("brain-harness", MEMO_KIND, MEMO_PAYLOAD);
    expect(outcome).toMatchObject({
      ok: true,
      targetDate: "2026-12-01",
      itemCount: 2,
      rejected: [],
    });
    const m1 = memoContentId("買い物のメモ");
    expect(findMemo(db, m1)).toEqual({
      title: "買い物のメモ",
      bodyMd: "牛乳と卵とＫｉｗｉを買う。",
    });
    expect(count("memo")).toBe(2);
    // P08: 見出しと、種類が返す検索の本文を改行でつなぎ、NFKC で正規化して小文字にした文。
    const index = db
      .prepare("SELECT body FROM search_index WHERE content_id = ?")
      .get(m1) as { body: string };
    expect(index.body).toBe("買い物のメモ\n牛乳と卵とkiwiを買う。");
    // メモは記事の関係の判定を待ちに入れない。
    expect(count("ai_run")).toBe(0);

    // 同じ対象日の同じ値は置き換える（内容ID は変えない）。形の外れた1件と重なりは断る。
    const again = ingest.receive("brain-harness", MEMO_KIND, {
      date: "2026-12-01",
      items: [
        { key: "m1", title: "買い物のメモ（直し）", bodyMd: "パンも買う。" },
        { key: "m1", title: "重なり", bodyMd: "x" },
        { key: "m3", title: "", bodyMd: "見出しが無い" },
      ],
    });
    expect(again).toMatchObject({ ok: true, itemCount: 1 });
    if (!again.ok) throw new Error("受け取れていない");
    expect(again.rejected.map((item) => item.slug)).toEqual(["m1", "m3"]);
    expect(findMemo(db, m1)).toEqual({
      title: "買い物のメモ（直し）",
      bodyMd: "パンも買う。",
    });
    expect(count("memo")).toBe(2);
  });

  it("既読と保存と一覧と検索（M17）がメモでも動き、検索はメモが返す検索の本文で当たる", () => {
    ingest.receive("brain-harness", MEMO_KIND, MEMO_PAYLOAD);
    const m1 = memoContentId("買い物のメモ");
    const m2 = memoContentId("読書のメモ");
    const contents = createContents({ db, clock });

    expect(contents.markOpened(m1)).toMatchObject({
      state: { contentId: m1, isNew: false },
      unchanged: false,
    });
    expect(contents.setRead(m1, true)).toMatchObject({
      state: { isRead: true },
      unchanged: false,
    });
    expect(contents.setSaved(m2, true)).toMatchObject({
      state: { isSaved: true, savedAt: NOW },
      unchanged: false,
    });

    // 新着と未読の一覧（FN-017）: 開いて既読にした m1 は出ず、m2 だけが出る。
    const inbox = contents.listInbox(PAGE).items;
    expect(inbox.map((item) => item.contentId)).toEqual([m2]);
    expect(inbox.every((item) => item.kind === MEMO_KIND)).toBe(true);
    expect(
      contents.listSaved(PAGE).items.map((item) => item.contentId),
    ).toEqual([m2]);

    // 本文だけにある言葉で当たる（3文字以上は FTS5、2文字以下は部分の一致）。全角も NFKC で当たる。
    expect(
      contents.searchContents("KIWI", PAGE).items.map((i) => i.contentId),
    ).toEqual([m1]);
    expect(
      contents.searchContents("第3章", PAGE).items.map((i) => i.contentId),
    ).toEqual([m2]);
    expect(
      contents.searchContents("牛乳", PAGE).items.map((i) => i.contentId),
    ).toEqual([m1]);
    expect(contents.searchContents("ニュース", PAGE).items).toEqual([]);
  });

  it("質問（M18 と M25 の P07）がメモでも動き、メモの組み立てた内容が AI に渡る", async () => {
    ingest.receive("brain-harness", MEMO_KIND, MEMO_PAYLOAD);
    const m1 = memoContentId("買い物のメモ");
    const chat = createChat({ db, clock });

    const created = chat.createConversation({ kind: "page", contentId: m1 });
    expect(created.notice).toBeNull();
    expect(created.conversation).toMatchObject({
      target: { kind: "page", contentId: m1 },
      targetTitle: "買い物のメモ",
    });
    const conversationId = created.conversation.conversationId;
    const posted = chat.postQuestion(conversationId, "何を買う？");
    if (posted.kind !== "accepted") throw new Error("受け付けていない");

    const logger = createLogger({
      process: "runner",
      clock,
      dir: join(dir, "logs"),
    });
    const fake = createFakeAi(
      {
        steps: [
          { text: "牛乳と卵と Kiwi です" },
          { result: "牛乳と卵と Kiwi です" },
        ],
      },
      { dataDir: dir, brainHarnessDir: null },
    );
    const runner = createAiRunner({
      queue: createAiQueue(db, clock),
      execute: createPurposes({ db, provider: fake.provider, clock, logger })
        .execute,
      logger,
    });
    await runner.runOnce();

    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]?.purpose).toBe("answer");
    const stdin = fake.calls[0]?.stdin ?? "";
    expect(stdin).toContain(
      "種類: メモ\n見出し: 買い物のメモ\n本文:\n牛乳と卵とＫｉｗｉを買う。",
    );
    expect(stdin).toContain("何を買う？");

    const detail = chat.getConversation(conversationId);
    expect(
      detail.messages.map((m) => [m.speaker, m.bodyMd, m.replyState]),
    ).toEqual([
      ["owner", "何を買う？", null],
      ["ai", "牛乳と卵と Kiwi です", "done"],
    ]);
    expect(chat.listConversations(m1, PAGE).items).toHaveLength(1);
  });

  it("一覧に登録していない種類の値で受け取ると M14 で断られ、何も残らない", () => {
    const before = {
      delivery: count("delivery"),
      content: count("content"),
      memo: count("memo"),
      searchIndex: count("search_index"),
    };
    expect(isKind("video")).toBe(false);
    let thrown: unknown;
    try {
      ingest.receive("brain-harness", "video", MEMO_PAYLOAD);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(NexusError);
    expect((thrown as NexusError).code).toBe("INTERNAL");
    expect({
      delivery: count("delivery"),
      content: count("content"),
      memo: count("memo"),
      searchIndex: count("search_index"),
    }).toEqual(before);
  });

  it("同じ値の種類を二度は登録できない", () => {
    expect(() => registerKind(memoIngest, memoChat)).toThrow(NexusError);
  });
});
