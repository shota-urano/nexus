import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DIST, withBuild } from "./fixtures/build";

// 01-foundation の実装単位5: `npm run build` で、Next.js の画面に加えて、AI Runner、定期ジョブ、
// 管理のコマンドの TypeScript を `dist/` に JavaScript で書き出す（DD-09 2.6・4章 手順 2。CR-016 の OP01 で見つけた不具合）。
// TC85 の起動の試験（node dist/jobs/main.js backup）は tests/12-batch-backup.test.ts にある。

describe("npm run build が dist/ に3つの入口を書き出す（DD-09 4章 手順 2）", () => {
  it("npm run build の後に dist/runner/main.js、dist/jobs/main.js、dist/cli/main.js がある", async () => {
    const found = await withBuild(() =>
      ["runner", "jobs", "cli"].map((name) => {
        const path = join(DIST, name, "main.js");
        return {
          path: `dist/${name}/main.js`,
          file: existsSync(path) && statSync(path).isFile(),
        };
      }),
    );

    expect(found).toEqual([
      { path: "dist/runner/main.js", file: true },
      { path: "dist/jobs/main.js", file: true },
      { path: "dist/cli/main.js", file: true },
    ]);
  }, 300_000);
});
