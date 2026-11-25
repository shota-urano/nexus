import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

// service worker の保存の条件（DD-09 2.1、06-app-shell の実装単位1の受け入れ基準）。
// `public/sw.js` を、ブラウザの service worker の環境を偽にした vm の中で動かし、
// 保存の対象が `/_next/static/` の中だけであることを確かめる。

const ORIGIN = "https://nexus.example.ts.net";
const source = readFileSync(
  join(import.meta.dirname, "..", "public", "sw.js"),
  "utf8",
);

type Listener = (event: unknown) => void;

function loadServiceWorker(existingCaches: string[] = []) {
  const listeners = new Map<string, Listener>();
  const store = new Map<string, Response>();
  const put = vi.fn(async (request: Request, response: Response) => {
    store.set(request.url, response);
  });
  const cache = {
    match: vi.fn(async (request: Request) => store.get(request.url)),
    put,
  };
  const cacheNames = new Set(existingCaches);
  const caches = {
    open: vi.fn(async (name: string) => {
      cacheNames.add(name);
      return cache;
    }),
    keys: vi.fn(async () => [...cacheNames]),
    delete: vi.fn(async (name: string) => cacheNames.delete(name)),
  };
  const fetchMock = vi.fn(async () => new Response("body", { status: 200 }));
  const self = {
    location: new URL(`${ORIGIN}/sw.js`),
    addEventListener: (type: string, listener: Listener) =>
      listeners.set(type, listener),
    skipWaiting: vi.fn(),
    clients: { claim: vi.fn(async () => undefined) },
  };
  runInNewContext(source, {
    self,
    caches,
    fetch: fetchMock,
    URL,
    Promise,
  });

  async function dispatchFetch(request: Request) {
    let responded: Promise<Response> | undefined;
    listeners.get("fetch")!({
      request,
      respondWith: (value: Promise<Response>) => {
        responded = value;
      },
    });
    return responded === undefined ? undefined : await responded;
  }

  async function dispatchActivate() {
    let waited: Promise<unknown> | undefined;
    listeners.get("activate")!({
      waitUntil: (value: Promise<unknown>) => {
        waited = value;
      },
    });
    await waited;
  }

  return { dispatchFetch, dispatchActivate, put, fetchMock, cacheNames };
}

describe("service worker の保存の条件（DD-09 2.1）", () => {
  it("`/_next/static/` の中のファイルは保存し、2回目は保存したものを返す", async () => {
    const sw = loadServiceWorker();
    const url = `${ORIGIN}/_next/static/chunks/app-3f9a2c.js`;
    const first = await sw.dispatchFetch(new Request(url));
    expect(await first?.text()).toBe("body");
    expect(sw.put).toHaveBeenCalledTimes(1);
    expect(sw.put.mock.calls[0][0].url).toBe(url);

    const second = await sw.dispatchFetch(new Request(url));
    expect(second).toBeDefined();
    expect(sw.fetchMock).toHaveBeenCalledTimes(1);
  });

  it("画面の HTML、API、そのほかのファイルは扱わず、保存しない", async () => {
    const sw = loadServiceWorker();
    for (const url of [
      `${ORIGIN}/`,
      `${ORIGIN}/news`,
      `${ORIGIN}/?notice=MSG-021`,
      `${ORIGIN}/api/app/home`,
      `${ORIGIN}/register?code=abc`,
      `${ORIGIN}/manifest.webmanifest`,
      `${ORIGIN}/sw.js`,
      `${ORIGIN}/_next/image?url=x`,
      `${ORIGIN}/_next/data/app.json`,
      `${ORIGIN}/static/_next/static/a.js`,
      // 別のオリジンの `/_next/static/`（記事の画像などを端末が直に読むもの）。
      "https://example.com/_next/static/chunks/app.js",
    ]) {
      expect(await sw.dispatchFetch(new Request(url)), url).toBeUndefined();
    }
    // GET 以外は `/_next/static/` の中でも扱わない。
    expect(
      await sw.dispatchFetch(
        new Request(`${ORIGIN}/_next/static/a.js`, { method: "POST" }),
      ),
    ).toBeUndefined();
    expect(sw.put).not.toHaveBeenCalled();
    expect(sw.fetchMock).not.toHaveBeenCalled();
  });

  it("失敗した応答は保存しない", async () => {
    const sw = loadServiceWorker();
    sw.fetchMock.mockResolvedValueOnce(new Response("", { status: 404 }));
    const response = await sw.dispatchFetch(
      new Request(`${ORIGIN}/_next/static/chunks/missing.js`),
    );
    expect(response?.status).toBe(404);
    expect(sw.put).not.toHaveBeenCalled();
  });

  it("保存する場所は1つで、有効になったときに名前の違う古い場所を消す", async () => {
    const sw = loadServiceWorker(["nexus-static-v0", "nexus-pages"]);
    await sw.dispatchFetch(new Request(`${ORIGIN}/_next/static/a.js`));
    await sw.dispatchActivate();
    expect([...sw.cacheNames]).toEqual(["nexus-static-v1"]);
  });

  it("ファイルの中で保存する呼び出しは `cache.put` の1か所だけ", () => {
    expect(source.match(/\.put\(/g)).toHaveLength(1);
    expect(source).not.toMatch(/\.add(All)?\(/);
  });
});
