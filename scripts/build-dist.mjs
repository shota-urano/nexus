import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { dirname, join, relative } from "node:path";

// `npm run build` の後半（DD-09 4章 手順 2）。Next.js の画面は `next build` が作る。
// ここでは AI Runner（src/runner/main.ts）、定期ジョブ（src/jobs/main.ts）、管理のコマンド（src/cli/main.ts）が
// 動かす `src` の TypeScript を、型だけ取り除いて JavaScript（`.js`）にし、`dist/` に同じ形で置く。
// マイグレーションの `.sql` も同じ場所に写す（M21 は自分のファイルの隣の `migrations/` を読む）。
// 画面の `.tsx`、型だけの `.d.ts`、試験（`.test.ts`）は含めない。
// 本番の起動のコマンドは `node dist/runner/main.js` などで、拡張子の無い読み込みは各 main.ts が解決する（DD-09 2.6）。

const REPO = join(import.meta.dirname, "..");
const SRC = join(REPO, "src");
const DIST = join(REPO, "dist");

function emit(path) {
  const out = join(DIST, relative(SRC, path));
  if (path.endsWith(".sql")) {
    mkdirSync(dirname(out), { recursive: true });
    copyFileSync(path, out);
    return;
  }
  if (
    !path.endsWith(".ts") ||
    path.endsWith(".d.ts") ||
    path.endsWith(".test.ts")
  )
    return;
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(
    out.replace(/\.ts$/, ".js"),
    stripTypeScriptTypes(readFileSync(path, "utf8"), { mode: "strip" }),
  );
}

function walk(from) {
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const path = join(from, entry.name);
    if (entry.isDirectory()) walk(path);
    else emit(path);
  }
}

// 前の版の消えたファイルを残さないため、作り直す。
rmSync(DIST, { recursive: true, force: true });
walk(SRC);
