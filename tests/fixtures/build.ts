import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnLauncher } from "../../src/runner/ai-provider/launcher";

// 本番と同じ `npm run build` をリポジトリで動かし、できた `dist/` を使う（DD-09 4章 手順 2）。
// 試験は `dist/` を自分で作らない。`npm run build` は `.next/` と `dist/` を書くので、
// 同時に動く試験のファイルどうしで、作ってから使い終わるまでを1つずつにする（プロセスをまたぐ印）。

export const REPO = join(import.meta.dirname, "../..");
export const DIST = join(REPO, "dist");

const LOCK = join(
  tmpdir(),
  `nexus-build-${createHash("sha256").update(REPO).digest("hex").slice(0, 16)}.lock`,
);

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as { code?: unknown }).code === "EPERM";
  }
}

async function acquire(): Promise<void> {
  const deadline = Date.now() + 10 * 60_000;
  for (;;) {
    try {
      mkdirSync(LOCK);
      writeFileSync(join(LOCK, "pid"), String(process.pid));
      return;
    } catch (error) {
      if ((error as { code?: unknown }).code !== "EEXIST") throw error;
    }
    // 持ち主のプロセスが終わっていれば、残った印を消して取り直す。
    let holder = Number.NaN;
    try {
      holder = Number(readFileSync(join(LOCK, "pid"), "utf8"));
    } catch {
      // 印のフォルダを作った直後で、番号をまだ書いていない。待つ。
      holder = Number.NaN;
    }
    if (Number.isInteger(holder) && holder > 0 && !alive(holder)) {
      rmSync(LOCK, { recursive: true, force: true });
      continue;
    }
    if (Date.now() > deadline)
      throw new Error("npm run build の順番を待ちきれない");
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

async function npmRunBuild(): Promise<void> {
  // 前の試験の `dist/` が残っていると、作れていなくても見つかってしまうので、先に消す。
  rmSync(DIST, { recursive: true, force: true });
  const child = spawnLauncher({
    command: "npm",
    args: ["run", "build"],
    env: {
      // 試験を動かしている Node.js を先に見つけさせる。
      PATH: `${dirname(process.execPath)}:${process.env.PATH ?? "/usr/bin:/bin"}`,
      HOME: process.env.HOME ?? tmpdir(),
      NEXT_TELEMETRY_DISABLED: "1",
    },
    cwd: REPO,
  });
  child.writeInput("");
  const end = await child.ended;
  if (end.launchError !== null || end.code !== 0) {
    throw new Error(
      `npm run build が失敗した（${end.launchError ?? end.code}）: ${child.stderr()}`,
    );
  }
}

// `npm run build` を動かし、できた `dist/` で run を動かす。run が終わるまでほかの試験は作り直さない。
export async function withBuild<T>(run: () => Promise<T> | T): Promise<T> {
  await acquire();
  try {
    await npmRunBuild();
    return await run();
  } finally {
    rmSync(LOCK, { recursive: true, force: true });
  }
}
