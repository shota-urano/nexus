import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, extname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { spawnLauncher } from "../src/runner/ai-provider/launcher";
import { REPO, withBuild } from "./fixtures/build";

// 06-app-shell の実装単位3: `public/img/` の画像を長く保存させる（DD-09 2.1、CR-017）。
// 応答の欄は、本番と同じ `npm run build` の後に `next start` を動かし、HTTP で読んで確かめる。
// service worker の保存の対象は tests/06-app-shell-service-worker.test.ts でも確かめる。

const IMG = join(REPO, "public", "img");
const IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".svg",
  ".avif",
  ".ico",
]);

function listFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  });
}

async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

// `next start` を動かし、応答が返るようになってから run を呼ぶ。終わったら止める。
// 子のプロセスは本番の起動の口（spawnLauncher）で起動する（DD-01 1.3）。
async function withNextStart<T>(
  run: (origin: string) => Promise<T>,
): Promise<T> {
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  // 起動の処理は DB を作る（DD-03 5章）。試験の DB は一時のフォルダに置く。
  const dataDir = mkdtempSync(join(tmpdir(), "nexus-img-cache-"));
  const child = spawnLauncher({
    command: join(REPO, "node_modules", ".bin", "next"),
    args: ["start", "-H", "127.0.0.1", "-p", String(port)],
    env: {
      PATH: `${dirname(process.execPath)}:${process.env.PATH ?? "/usr/bin:/bin"}`,
      HOME: process.env.HOME ?? tmpdir(),
      NODE_ENV: "production",
      NEXT_TELEMETRY_DISABLED: "1",
      NEXUS_ENV: "test",
      NEXUS_DATA_DIR: dataDir,
    },
    cwd: REPO,
  });
  child.writeInput("");
  let ended = false;
  void child.ended.then(() => (ended = true));
  try {
    const deadline = Date.now() + 60_000;
    for (;;) {
      if (ended) throw new Error(`next start が終わった: ${child.stderr()}`);
      try {
        await fetch(`${origin}/`);
        break;
      } catch {
        if (Date.now() > deadline)
          throw new Error(`next start が応答しない: ${child.stderr()}`);
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
    return await run(origin);
  } finally {
    child.kill("SIGTERM");
    await child.ended;
    rmSync(dataDir, { recursive: true, force: true });
  }
}

describe("`public/img/` の画像の保存の欄（DD-09 2.1、CR-017）", () => {
  it("`/img/home/planet_001.png` の応答の Cache-Control が `public, max-age=31536000, immutable` である", async () => {
    const result = await withBuild(() =>
      withNextStart(async (origin) => {
        const response = await fetch(`${origin}/img/home/planet_001.png`);
        await response.arrayBuffer();
        return {
          status: response.status,
          contentType: response.headers.get("Content-Type"),
          cacheControl: response.headers.get("Cache-Control"),
        };
      }),
    );
    expect(result).toEqual({
      status: 200,
      contentType: "image/png",
      cacheControl: "public, max-age=31536000, immutable",
    });
  }, 300_000);

  it("`public/img/` の画像の名前が全て版の番号（`_001` など）で終わる", () => {
    const images = listFiles(IMG).filter((path) =>
      IMAGE_EXTENSIONS.has(extname(path).toLowerCase()),
    );
    expect(images.length).toBeGreaterThan(0);
    const unversioned = images
      .filter((path) => !/_\d+$/.test(path.slice(0, -extname(path).length)))
      .map((path) => relative(REPO, path));
    expect(unversioned).toEqual([]);
  });

  it("ロゴの画像は版の番号の付いた `public/img/home/logo_001.png` である", () => {
    const names = readdirSync(join(IMG, "home"));
    expect(names).toContain("logo_001.png");
    expect(names).not.toContain("logo.png");
  });
});
