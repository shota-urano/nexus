import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, extname, join, posix } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { spawnLauncher } from "../src/runner/ai-provider/launcher";
import { REPO, withBuild } from "./fixtures/build";

// 06-app-shell の実装単位6: アプリのアイコン（DD-01 M01、BD-01 NFR-007）。
// `public/img/icon/app-icon_001.png`（1024×1024）から、PWA の manifest のアイコン（192px と 512px）と、
// iPad のホーム画面のアイコン（apple-touch-icon、180px）を作って設定する。
// 受け入れ基準:
// - `/manifest.webmanifest` の `icons` に 192×192 と 512×512 の PNG があり、その道で画像が返る。
// - ページに 180×180 の PNG を指す `apple-touch-icon` があり、その道で画像が返る。
// - アイコンの画像の名前が版の番号（`_001` など）で終わる。
// 本番と同じ `npm run build` の後に `next start` を動かし、HTTP で読んで確かめる。

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

type Fetched = {
  url: string;
  status: number;
  contentType: string | null;
  bytes: Buffer;
};

type IconImage = Fetched & {
  png: { width: number; height: number } | null;
};

// PNG の署名と IHDR を読み、画像の幅と高さを返す。PNG でなければ null。
function readPng(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length < 24) return null;
  if (!bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  if (bytes.subarray(12, 16).toString("ascii") !== "IHDR") return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
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
  const dataDir = mkdtempSync(join(tmpdir(), "nexus-app-icon-"));
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

async function get(url: string): Promise<Fetched> {
  const response = await fetch(url);
  const bytes = Buffer.from(await response.arrayBuffer());
  return {
    url,
    status: response.status,
    contentType: response.headers.get("Content-Type"),
    bytes,
  };
}

async function getImage(url: string): Promise<IconImage> {
  const fetched = await get(url);
  return { ...fetched, png: readPng(fetched.bytes) };
}

// HTML の `<link ...>` の属性を全て読む。属性の名前は小文字にそろえる。
function linkTags(html: string): Map<string, string>[] {
  const tags: Map<string, string>[] = [];
  for (const tag of html.matchAll(/<link\b([^>]*)>/gi)) {
    const attrs = new Map<string, string>();
    for (const attr of tag[1].matchAll(
      /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g,
    )) {
      const value = (attr[2] ?? attr[3] ?? attr[4] ?? "")
        .replaceAll("&amp;", "&")
        .replaceAll("&quot;", '"')
        .replaceAll("&#x27;", "'")
        .replaceAll("&#39;", "'");
      attrs.set(attr[1].toLowerCase(), value);
    }
    tags.push(attrs);
  }
  return tags;
}

// URL の道の最後の名前から、拡張子を除いた部分が版の番号（`_001` など）で終わるか。
function endsWithVersion(url: string): boolean {
  const name = posix.basename(new URL(url).pathname);
  const ext = extname(name);
  return ext !== "" && /_\d+$/.test(name.slice(0, -ext.length));
}

type ManifestIcon = { src: string; sizes: string[]; image: IconImage };

let manifestResponse: { status: number; contentType: string | null };
let manifestIcons: ManifestIcon[] = [];
let pageStatus = 0;
let appleTouchIcons: IconImage[] = [];

beforeAll(async () => {
  await withBuild(() =>
    withNextStart(async (origin) => {
      const manifest = await get(`${origin}/manifest.webmanifest`);
      manifestResponse = {
        status: manifest.status,
        contentType: manifest.contentType,
      };
      const parsed = JSON.parse(manifest.bytes.toString("utf8")) as {
        icons?: { src?: unknown; sizes?: unknown }[];
      };
      const manifestUrl = `${origin}/manifest.webmanifest`;
      manifestIcons = await Promise.all(
        (Array.isArray(parsed.icons) ? parsed.icons : []).map(async (icon) => {
          const src = typeof icon.src === "string" ? icon.src : "";
          const sizes =
            typeof icon.sizes === "string"
              ? icon.sizes.trim().toLowerCase().split(/\s+/)
              : [];
          const url = new URL(src, manifestUrl).toString();
          return { src: url, sizes, image: await getImage(url) };
        }),
      );

      const page = await get(`${origin}/`);
      pageStatus = page.status;
      const html = page.bytes.toString("utf8");
      const hrefs = linkTags(html)
        .filter((attrs) =>
          (attrs.get("rel") ?? "")
            .toLowerCase()
            .split(/\s+/)
            .includes("apple-touch-icon"),
        )
        .map((attrs) => new URL(attrs.get("href") ?? "", `${origin}/`));
      appleTouchIcons = await Promise.all(
        hrefs.map((href) => getImage(href.toString())),
      );
    }),
  );
}, 300_000);

function isPngOfSize(image: IconImage, size: number): boolean {
  return (
    image.status === 200 &&
    (image.contentType ?? "").split(";")[0].trim().toLowerCase() ===
      "image/png" &&
    image.png !== null &&
    image.png.width === size &&
    image.png.height === size
  );
}

function describeImage(image: IconImage) {
  return {
    url: image.url,
    status: image.status,
    contentType: image.contentType,
    png: image.png,
  };
}

describe("PWA の manifest のアイコン（DD-01 M01、BD-01 NFR-007）", () => {
  it("`/manifest.webmanifest` が返る", () => {
    expect(manifestResponse.status).toBe(200);
  });

  for (const size of [192, 512]) {
    it(`\`icons\` に ${size}×${size} の PNG があり、その道で ${size}×${size} の PNG の画像が返る`, () => {
      const declared = manifestIcons.filter((icon) =>
        icon.sizes.includes(`${size}x${size}`),
      );
      expect(
        declared.map((icon) => icon.src),
        `${size}x${size} の icons の項目`,
      ).not.toEqual([]);
      const ok = declared.filter((icon) => isPngOfSize(icon.image, size));
      expect(
        ok.map((icon) => icon.src),
        JSON.stringify(declared.map((icon) => describeImage(icon.image))),
      ).not.toEqual([]);
    });
  }
});

describe("iPad のホーム画面のアイコン（apple-touch-icon。DD-01 M01、BD-01 NFR-007）", () => {
  it("ページが返る", () => {
    expect(pageStatus).toBe(200);
  });

  it("ページに 180×180 の PNG を指す `apple-touch-icon` があり、その道で画像が返る", () => {
    expect(
      appleTouchIcons.map((image) => image.url),
      "apple-touch-icon の link",
    ).not.toEqual([]);
    const ok = appleTouchIcons.filter((image) => isPngOfSize(image, 180));
    expect(
      ok.map((image) => image.url),
      JSON.stringify(appleTouchIcons.map(describeImage)),
    ).not.toEqual([]);
  });
});

describe("アイコンの画像の名前（DD-09 2.1、CR-017）", () => {
  it("manifest のアイコンと apple-touch-icon の画像の名前が全て版の番号（`_001` など）で終わる", () => {
    const urls = [
      ...manifestIcons.map((icon) => icon.src),
      ...appleTouchIcons.map((image) => image.url),
    ];
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.filter((url) => !endsWithVersion(url))).toEqual([]);
  });
});
