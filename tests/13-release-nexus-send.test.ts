import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnLauncher } from "../src/runner/ai-provider/launcher";

// 13-release の実装単位（CR-020）: 構築のスクリプト `deploy/setup.sh` が、`deploy/nexus-send` の雛形に
// Node.js の道とリポジトリの道を書き込んで `bin/nexus-send`（実行の権限、Git で管理しない）を置く。
// 運用の手順書の OP01、OP03、OP05 を足す（FN-024、FN-028、DD-09 2.7・4章、BD-11 OP01・OP03・OP05）。
// 受け入れ基準:
//   - DD-10 TC128 が通る（tests/13-release-operations.test.ts が確かめる）。
//   - 構築のスクリプトを一時のホームで動かすと、`bin/nexus-send` が実行の権限で置かれ、
//     中の Node.js の道と `dist/cli/send/main.js` の道が絶対の道である。
//   - `.gitignore` に `bin/nexus-send` がある。
//   - OP03 に `sender-key issue brain-research` と `NEXUS_SENDER_KEY` が書いてあり、
//     OP05 に `nexus-send` での送り直しが書いてある。
//
// `bin/nexus-send` はリポジトリ（構築のスクリプトのある deploy/ の親）に置かれる（DD-09 2.7）。
// テストが本物のリポジトリの bin/ を書き換えないよう、deploy/ を一時のリポジトリに写して、そこで動かす。

const ROOT = join(import.meta.dirname, "..");
const DEPLOY = join(ROOT, "deploy");
const OPERATIONS = join(ROOT, "docs", "operations");

// 子のプロセスを起動するのは M26 の起動の口だけなので（DD-01 1.3）、それを使う。
async function run(
  command: string,
  args: string[],
  options: { env: Record<string, string>; cwd: string },
): Promise<{
  code: number | null;
  out: string;
  stderr: string;
  launchError: string | null;
}> {
  const child = spawnLauncher({
    command,
    args,
    env: options.env,
    cwd: options.cwd,
  });
  const lines: string[] = [];
  const reading = (async () => {
    for await (const line of child.lines) lines.push(line);
  })();
  child.writeInput("");
  await reading;
  const { code, launchError } = await child.ended;
  return { code, out: lines.join("\n"), stderr: child.stderr(), launchError };
}

describe("構築のスクリプトを一時のホームで動かすと bin/nexus-send が置かれる（DD-09 2.7、4章 手順 3）", () => {
  let work: string;
  let home: string;
  let repo: string;
  let fakeBin: string;
  let nodeBin: string;
  let result: Awaited<ReturnType<typeof run>>;

  beforeEach(async () => {
    work = realpathSync(mkdtempSync(join(tmpdir(), "nexus-send-setup-")));
    home = join(work, "home");
    mkdirSync(home);
    repo = join(work, "repo");
    mkdirSync(repo);
    cpSync(DEPLOY, join(repo, "deploy"), { recursive: true });
    // 本人の launchd に読み込ませないよう、launchctl は置かない PATH にする（読み込みは手順 5）。
    fakeBin = join(work, "fake-bin");
    mkdirSync(fakeBin);
    // 選ぶ Node.js を決めておく（setup.sh は NEXUS_NODE_BIN を先に使う。DD-09 2.1）。
    nodeBin = realpathSync(process.execPath);
    result = await run("/bin/sh", [join(repo, "deploy", "setup.sh")], {
      cwd: repo,
      env: {
        HOME: home,
        USER: process.env.USER ?? "nexus",
        LOGNAME: process.env.LOGNAME ?? "nexus",
        PATH: `${fakeBin}:/usr/bin:/bin:/usr/sbin:/sbin`,
        TMPDIR: work,
        NEXUS_NODE_BIN: nodeBin,
      },
    });
  });

  afterEach(() => {
    rmSync(work, { recursive: true, force: true });
  });

  const sendPath = () => join(repo, "bin", "nexus-send");

  it("構築のスクリプトが 0 で終わる", () => {
    expect(result.launchError).toBeNull();
    expect(result.code, `${result.out}\n${result.stderr}`).toBe(0);
  });

  it("リポジトリの bin/nexus-send が実行の権限を持つファイルとして置かれる", () => {
    expect(existsSync(sendPath()), result.stderr).toBe(true);
    const stat = statSync(sendPath());
    expect(stat.isFile()).toBe(true);
    // 本人（持ち主）が実行できる。
    expect(stat.mode & 0o100, (stat.mode & 0o777).toString(8)).toBe(0o100);
  });

  it("雛形の置き換えの印（__NODE__、__REPO__）が残っていない", () => {
    const text = readFileSync(sendPath(), "utf8");
    expect(text).not.toContain("__NODE__");
    expect(text).not.toContain("__REPO__");
  });

  it("中の Node.js の道が、選んだ Node.js の絶対の道である", () => {
    const text = readFileSync(sendPath(), "utf8");
    expect(isAbsolute(nodeBin)).toBe(true);
    expect(text).toContain(nodeBin);
  });

  it("中の dist/cli/send/main.js の道が、リポジトリの絶対の道である", () => {
    const text = readFileSync(sendPath(), "utf8");
    const mainPath = join(repo, "dist", "cli", "send", "main.js");
    expect(text).toContain(mainPath);
    // dist/cli/send/main.js を指す全ての道が絶対の道である（相対の道で呼ぶ所が無い）。
    const refs = [
      ...text.matchAll(/["']?([^\s"'=]*dist\/cli\/send\/main\.js)["']?/g),
    ].map((m) => m[1]!);
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) expect(isAbsolute(ref), ref).toBe(true);
  });
});

describe(".gitignore に bin/nexus-send がある", () => {
  it("bin/nexus-send を Git で管理しない", () => {
    const lines = readFileSync(join(ROOT, ".gitignore"), "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim());
    expect(lines.some((line) => /^\/?bin\/nexus-send$/.test(line))).toBe(true);
  });
});

function readOp(number: string): string {
  const files = existsSync(OPERATIONS)
    ? readdirSync(OPERATIONS).filter((name) =>
        new RegExp(`^${number}(?![0-9]).*\\.md$`).test(name),
      )
    : [];
  expect(
    files,
    `${number} の手順書が docs/operations/ に1つだけある`,
  ).toHaveLength(1);
  return readFileSync(join(OPERATIONS, files[0]!), "utf8");
}

// 文が行の途中で折り返されても読めるように、行の区切りを除いて照らす。
function joined(text: string): string {
  return text.replace(/\r?\n[ \t]*/g, "");
}

// 文（。か行の区切りで分ける）の一覧。
function sentences(text: string): string[] {
  return text
    .split(/\r?\n|。/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

describe("運用の手順書 OP03、OP05（BD-11 OP03・OP05、CR-020）", () => {
  it("OP03 に `sender-key issue brain-research` が書いてある", () => {
    expect(readOp("OP03")).toContain("sender-key issue brain-research");
  });

  it("OP03 に `NEXUS_SENDER_KEY` が書いてある", () => {
    expect(joined(readOp("OP03"))).toContain("NEXUS_SENDER_KEY");
  });

  it("OP05 に `nexus-send` での送り直しが書いてある", () => {
    const found = sentences(readOp("OP05")).filter(
      (s) => s.includes("nexus-send") && s.includes("送り直"),
    );
    expect(
      found.length,
      "「nexus-send」と「送り直」を同じ文に含む文がある",
    ).toBeGreaterThan(0);
  });
});
