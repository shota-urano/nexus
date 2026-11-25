// @vitest-environment jsdom
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type ContentListApiContext,
  listInbox,
  listSaved,
  searchContents,
} from "../src/app/api/_entry/content-list";
import { createDeviceApiContext } from "../src/app/api/_entry/device-api";
import { ExploreScreen } from "../src/screens/lists/explore-screen";
import { InboxScreen } from "../src/screens/lists/inbox-screen";
import { LibraryScreen } from "../src/screens/lists/library-screen";
import { createDeviceKeyVerifier } from "../src/server/auth/device-key";
import { createContents } from "../src/server/contents";
import {
  type Database,
  databasePath,
  openDatabase,
} from "../src/server/db/connection";
import { searchIndexBody } from "../src/server/ingest";
import { replaceSearchIndexRow } from "../src/server/repositories/search-index";
import { createFakeClock } from "../src/server/shared/clock";
import { createLogger } from "../src/server/shared/logger";
import { createSecret, hashSecret } from "../src/server/shared/secret";
import { type D1News, NOW, insertD1News, migrate } from "./fixtures/news";

// 07-contents の実装単位4: 画面 M05 と通信層 M09 を、端末の API（M11、M17）の本当の応答に
// つないで確かめる。`contentId` は `openapi.yaml` の `Id`（1 以上の整数）で届く。
// 受け入れ基準 DD-10 TC84（一覧の行に日付だけが出て、時刻が出ない）。

const ORIGIN = "http://localhost:48401";

let dir: string;
let db: Database;
let deviceKey: string;
let context: ContentListApiContext;
let d1: D1News;
let englishId: number;

// 時刻の形（07:00、23:59 など）。
const TIME_PATTERN = /\d{1,2}:\d{2}/;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW));
  window.sessionStorage.clear();

  dir = mkdtempSync(join(tmpdir(), "nexus-07-screens-api-"));
  const clock = createFakeClock(NOW);
  db = openDatabase(databasePath(dir));
  migrate(db);
  d1 = insertD1News(db);
  for (const id of Object.values(d1)) {
    const row = db
      .prepare(
        "SELECT c.title, a.guide_md FROM content c JOIN article a ON a.content_id = c.content_id WHERE c.content_id = ?",
      )
      .get(id) as { title: string; guide_md: string } | undefined;
    if (row) {
      replaceSearchIndexRow(db, id, searchIndexBody(row.title, row.guide_md));
    }
  }
  const result = db
    .prepare(
      "INSERT INTO content (kind, title, target_date, received_at) VALUES ('english', ?, ?, ?)",
    )
    .run("去年の英語の記事", "2025-12-31", "2025-12-31T23:59:59.000+09:00");
  englishId = Number(result.lastInsertRowid);
  db.prepare(
    "INSERT INTO english_set (content_id, learning_theme, lesson_body_md, problems_json, raw_payload_json) VALUES (?, ?, ?, ?, ?)",
  ).run(englishId, "去年の英語", "本文", JSON.stringify([{ no: 1 }]), "{}");
  replaceSearchIndexRow(
    db,
    englishId,
    searchIndexBody("去年の英語の記事", "本文"),
  );

  deviceKey = createSecret();
  db.prepare(
    "INSERT INTO device (device_name, device_key_hash, registered_at, last_used_at) VALUES ('ipad', ?, ?, ?)",
  ).run(hashSecret(deviceKey), "2026-11-20T09:00:00.000+09:00", NOW);
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
    contents: createContents({ db, clock }),
  };

  // 画面の fetch を、端末の鍵を付けて API の入口へつなぐ。
  const routes: Record<string, (request: Request) => Promise<Response>> = {
    "/api/app/contents/inbox": listInbox(context),
    "/api/app/contents/search": searchContents(context),
    "/api/app/contents/saved": listSaved(context),
  };
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = new URL(String(input), ORIGIN);
    const handle = routes[url.pathname];
    if (!handle) throw new Error(`知らない道: ${url.pathname}`);
    return handle(
      new Request(url, {
        method: "GET",
        headers: { cookie: `nexus_device=${deviceKey}` },
      }),
    );
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  if (db.isOpen) db.close();
  rmSync(dir, { recursive: true, force: true });
});

function hrefs(): (string | null)[] {
  return screen.getAllByRole("link").map((link) => link.getAttribute("href"));
}

describe("TC84 API の本当の応答で、一覧の行に日付だけが出て、時刻が出ない", () => {
  it("Inbox は整数の contentId の行を出し、届いた日だけを出す", async () => {
    const { container } = render(<InboxScreen />);
    const rows = await screen.findAllByRole("listitem");
    expect(rows).toHaveLength(7);
    expect(rows[0].textContent).toContain("12月1日（火）");
    expect(rows[3].textContent).toContain("11月28日（土）");
    expect(rows[5].textContent).toContain("11月23日（月）");
    expect(rows[6].textContent).toContain("2025年12月31日");
    expect(container.textContent).not.toMatch(TIME_PATTERN);
    expect(hrefs()).toContain(`/news?article=${d1.A1}`);
    expect(hrefs()).toContain(`/english/${englishId}`);
  });

  it("Explore は整数の contentId の行を出し、届いた日だけを出す", async () => {
    const { container } = render(<ExploreScreen />);
    fireEvent.change(screen.getByRole("searchbox", { name: "検索の言葉" }), {
      target: { value: "記事" },
    });
    fireEvent.click(screen.getByRole("button", { name: "探す" }));
    const rows = await screen.findAllByRole("listitem");
    expect(rows).toHaveLength(7);
    expect(rows[0].textContent).toContain("12月1日（火）");
    expect(rows[6].textContent).toContain("2025年12月31日");
    expect(container.textContent).not.toMatch(TIME_PATTERN);
    expect(hrefs()).toContain(`/news?article=${d1.P8}`);
    expect(hrefs()).toContain(`/english/${englishId}`);
  });

  it("Library は整数の contentId の行を出し、保存した日だけを出す", async () => {
    expect(context.contents.setSaved(d1.P1, true)).toBeTruthy();
    const { container } = render(<LibraryScreen />);
    const rows = await screen.findAllByRole("listitem");
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain("3日前の記事 P1");
    expect(rows[0].textContent).toContain("12月1日（火）");
    expect(rows[0].textContent).not.toContain("11月28日");
    expect(container.textContent).not.toMatch(TIME_PATTERN);
    expect(hrefs()).toEqual([`/news?article=${d1.P1}`]);
  });
});
