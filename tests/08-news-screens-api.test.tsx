// @vitest-environment jsdom
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type ContentRouteContext,
  markOpened,
  setSaved,
} from "../src/app/api/_entry/content-state";
import { createDeviceApiContext } from "../src/app/api/_entry/device-api";
import { getArticle, getGalaxy } from "../src/app/api/_entry/news";
import { NewsGalaxyScreen } from "../src/screens/news/galaxy-screen";
import { createDeviceKeyVerifier } from "../src/server/auth/device-key";
import { createContents } from "../src/server/contents";
import {
  type Database,
  databasePath,
  openDatabase,
} from "../src/server/db/connection";
import { createNewsView } from "../src/server/kinds/news/view";
import { createFakeClock } from "../src/server/shared/clock";
import { createLogger } from "../src/server/shared/logger";
import { createSecret, hashSecret } from "../src/server/shared/secret";
import {
  type D1News,
  NOW,
  insertD1News,
  insertRelation,
  migrate,
} from "./fixtures/news";
import { installReactFlowStubs } from "./fixtures/react-flow";

// 08-news の実装単位2: 画面 M03 を、端末の API（M11、M15、M17）の本当の応答につないで確かめる。
// 受け入れ基準 DD-10 TC21（M03 の部品に TC19 の応答を渡す）と TC29（API が 500 を返す）。
// 前提の「共通」は D1（DD-10 3章）を入れた一時の DB で、日本時間の今を 2026-12-01 08:00 とし、
// 端末 `ipad` の鍵を Cookie に持つ状態である。

const ORIGIN = "http://localhost:48401";

let dir: string;
let db: Database;
let d1: D1News;
let calls: string[];
let statuses: number[];

type Handler = (
  request: Request,
  routeContext: ContentRouteContext,
) => Promise<Response>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW));
  installReactFlowStubs();

  dir = mkdtempSync(join(tmpdir(), "nexus-08-screens-api-"));
  const clock = createFakeClock(NOW);
  db = openDatabase(databasePath(dir));
  migrate(db);
  d1 = insertD1News(db);
  // TC19 の前提: A1→A2、A1→P1 が有効、A2→A3 が無効。
  insertRelation(db, d1.A1, d1.A2, "follow_up");
  insertRelation(db, d1.A1, d1.P1, "background");
  insertRelation(db, d1.A2, d1.A3, "same_actor", 0);

  const deviceKey = createSecret();
  db.prepare(
    "INSERT INTO device (device_name, device_key_hash, registered_at, last_used_at) VALUES ('ipad', ?, ?, ?)",
  ).run(hashSecret(deviceKey), "2026-11-20T09:00:00.000+09:00", NOW);
  const deviceApi = createDeviceApiContext({
    clock,
    logger: createLogger({ process: "web", clock, dir: join(dir, "logs") }),
    origin: ORIGIN,
    deviceKeys: createDeviceKeyVerifier({ db, clock }),
  });
  const news = createNewsView({ db });
  const contents = createContents({ db, clock });

  // 画面の fetch を、端末の鍵とオリジンを付けて API の入口へつなぐ。
  const galaxy = getGalaxy({ deviceApi, news });
  const routes: [RegExp, string, Handler][] = [
    [
      /^\/api\/app\/news\/articles\/([^/]+)$/,
      "GET",
      getArticle({ deviceApi, news }),
    ],
    [
      /^\/api\/app\/contents\/([^/]+)\/opened$/,
      "POST",
      markOpened({ deviceApi, contents }),
    ],
    [
      /^\/api\/app\/contents\/([^/]+)\/saved$/,
      "PUT",
      setSaved({ deviceApi, contents }),
    ],
  ];
  calls = [];
  statuses = [];
  vi.stubGlobal(
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), ORIGIN);
      const method = init?.method ?? "GET";
      calls.push(`${method} ${url.pathname}${url.search}`);
      const request = new Request(url, {
        method,
        body: init?.body,
        headers: {
          ...(init?.headers as Record<string, string> | undefined),
          cookie: `nexus_device=${deviceKey}`,
          origin: ORIGIN,
        },
      });
      if (url.pathname === "/api/app/news/galaxy" && method === "GET") {
        return galaxy(request);
      }
      for (const [pattern, routeMethod, handle] of routes) {
        const match = pattern.exec(url.pathname);
        if (match && routeMethod === method) {
          const response = await handle(request, {
            params: Promise.resolve({ contentId: match[1] }),
          });
          statuses.push(response.status);
          return response;
        }
      }
      throw new Error(`知らない道: ${method} ${url.pathname}`);
    },
  );
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  if (db.isOpen) db.close();
  rmSync(dir, { recursive: true, force: true });
});

function shownTitles(): string[] {
  return screen
    .queryAllByTestId("news-node")
    .map((element) => element.querySelector("p")?.textContent ?? "");
}

function centerTitles(): string[] {
  return screen
    .queryAllByTestId("news-node")
    .filter((element) => element.dataset.center === "true")
    .map((element) => element.querySelector("p")?.textContent ?? "");
}

describe("TC21 API の本当の応答（TC19）で、テーマで絞り、A1 を押すと中心が移る", () => {
  it("テーマはサーバを呼ばずに絞り、A1 を押すと getArticle が呼ばれ、A1 が中心になる", async () => {
    render(<NewsGalaxyScreen />);
    await screen.findByText("今日の記事 A1");
    expect(shownTitles().sort()).toEqual(
      [
        "今日の記事 A1",
        "今日の記事 A2",
        "今日の記事 A3",
        "3日前の記事 P1",
      ].sort(),
    );
    expect(centerTitles()).toEqual([]);

    fireEvent.change(screen.getByRole("combobox", { name: "テーマ" }), {
      target: { value: "半導体" },
    });
    await waitFor(() => expect(shownTitles()).toEqual(["今日の記事 A3"]));
    fireEvent.change(screen.getByRole("combobox", { name: "テーマ" }), {
      target: { value: "AI" },
    });
    await waitFor(() =>
      expect(shownTitles().sort()).toEqual(
        ["今日の記事 A1", "今日の記事 A2", "3日前の記事 P1"].sort(),
      ),
    );
    expect(calls).toEqual(["GET /api/app/news/galaxy"]);

    fireEvent.click(screen.getByText("今日の記事 A1"));
    const sheet = await screen.findByRole("dialog", { name: "記事の案内" });
    await within(sheet).findByText("今日の記事 A1 の案内");
    expect(calls).toContain(`GET /api/app/news/articles/${d1.A1}`);
    expect(centerTitles()).toEqual(["今日の記事 A1"]);
    // 中心の記事の線にだけ、関係の種類の名前を出す。
    expect(screen.getAllByText("続報").length).toBeGreaterThan(0);
    await waitFor(() =>
      expect(calls).toContain(`POST /api/app/contents/${d1.A1}/opened`),
    );
  });

  it("押した記事の関係の先のうち、図に無い記事が足される", async () => {
    // 11-28 の図には、P1、P2 と、P1 と関係のある A1 が出る。A1 を押すと、A1 の関係の先の A2 が足される。
    render(<NewsGalaxyScreen />);
    await screen.findByText("今日の記事 A1");
    fireEvent.change(screen.getByRole("combobox", { name: "日付" }), {
      target: { value: "2026-11-28" },
    });
    await waitFor(() =>
      expect(shownTitles().sort()).toEqual(
        ["3日前の記事 P1", "3日前の記事 P2", "今日の記事 A1"].sort(),
      ),
    );
    fireEvent.click(screen.getByText("今日の記事 A1"));
    // A1 の関係の先の A2 は、11-28 の図には無かったので足される。
    await waitFor(() => expect(shownTitles()).toContain("今日の記事 A2"));
    expect(centerTitles()).toEqual(["今日の記事 A1"]);
  });

  it("記事が無い日の応答では MSG-001 を出す", async () => {
    db.prepare("DELETE FROM article_relation").run();
    db.prepare(
      "DELETE FROM article WHERE content_id IN (SELECT content_id FROM content WHERE target_date = '2026-12-01')",
    ).run();
    db.prepare("DELETE FROM content WHERE target_date = '2026-12-01'").run();
    render(<NewsGalaxyScreen />);
    expect(
      await screen.findByText("12月1日（火） の記事はありません。"),
    ).toBeTruthy();
  });
});

describe("TC29 API が 500 を返すと、MSG-003（操作「保存」）が出て、保存の印は変わらない", () => {
  it("DB が使えないとき「保存」を押す", async () => {
    render(<NewsGalaxyScreen />);
    await screen.findByText("今日の記事 A1");
    fireEvent.click(screen.getByText("今日の記事 A1"));
    const sheet = await screen.findByRole("dialog", { name: "記事の案内" });
    await within(sheet).findByText("今日の記事 A1 の案内");
    await waitFor(() =>
      expect(calls).toContain(`POST /api/app/contents/${d1.A1}/opened`),
    );

    // DB が使えない状態（DD-06 E08）を作る。
    db.close();
    fireEvent.click(within(sheet).getByRole("button", { name: "保存" }));
    const alert = await screen.findByRole("alert");
    expect(calls.at(-1)).toBe(`PUT /api/app/contents/${d1.A1}/saved`);
    expect(statuses.at(-1)).toBe(500);
    expect(alert.textContent).toContain(
      "保存できませんでした。もう一度押してください。",
    );
    expect(within(sheet).getByRole("button", { name: "保存" })).toBeTruthy();
    expect(
      within(sheet).queryByRole("button", { name: "保存を外す" }),
    ).toBeNull();
  });
});
