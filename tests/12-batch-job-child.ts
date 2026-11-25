import { existsSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { join } from "node:path";

// TC118 の「2つのプロセス」の片方（tests/12-batch-backup.test.ts から別のプロセスとして動かす）。
//   node tests/12-batch-job-child.ts <今の日時> <待ち合わせのフォルダ>
// 設定は環境変数から読み、M27 の runJobProcess で `backup` を動かす。印には自分のプロセスの番号を書く。
// 最初に自分の番号を標準出力に1行で出す。写し始めたら待ち合わせのフォルダに `copying-<番号>` を作り、
// 親が `go` を作るまで写すのを止めて待つ（片方が写している間に、もう片方が起動して終わるようにするため）。

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      const relative =
        specifier.startsWith("./") || specifier.startsWith("../");
      if (!relative || /\.[cm]?[jt]s$/.test(specifier)) throw error;
      try {
        return nextResolve(`${specifier}.ts`, context);
      } catch {
        return nextResolve(`${specifier}/index.ts`, context);
      }
    }
  },
});

const [now, holdDir] = process.argv.slice(2);
if (now === undefined || holdDir === undefined) {
  throw new Error("使い方: <今の日時> <待ち合わせのフォルダ>");
}

const src = (file: string) => new URL(`../src/${file}`, import.meta.url).href;

const { runJobProcess } = (await import(
  src("jobs/process.ts")
)) as typeof import("../src/jobs/process");
const { createFakeClock } = (await import(
  src("server/shared/clock.ts")
)) as typeof import("../src/server/shared/clock");

process.stdout.write(`${process.pid}\n`);

const sleeper = new Int32Array(new SharedArrayBuffer(4));
let copying = false;

process.exitCode = await runJobProcess(["backup"], {
  env: process.env,
  clock: createFakeClock(now),
  backupCopy: {
    pagesPerStep: 1,
    onProgress: () => {
      if (copying) return;
      copying = true;
      writeFileSync(join(holdDir, `copying-${process.pid}`), "");
      const deadline = Date.now() + 15_000;
      while (!existsSync(join(holdDir, "go"))) {
        if (Date.now() > deadline) throw new Error("親の合図が来ない");
        Atomics.wait(sleeper, 0, 0, 20);
      }
    },
  },
});
