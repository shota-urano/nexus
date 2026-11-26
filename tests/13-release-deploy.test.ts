import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnLauncher } from "../src/runner/ai-provider/launcher";

// 13-release の実装単位1: `deploy/` の launchd の4つの雛形、`claude-settings.json`、`env` の雛形と、
// 構築のスクリプト（NFR-005、NFR-016、NFR-025、DD-09 2.5・2.6・4章、CR-013）。
// 雛形の名前は DD-09 の書き方に合わせる。launchd の雛形は cerebellum と同じ形（`deploy/<Label>.plist`。
// DD-09 冒頭と 2.6）、CLI の設定は `deploy/claude-settings.json`、環境変数は `deploy/env`（DD-09 3章、4章 手順 3）。
// 構築のスクリプトの名前は書類に無いので、`deploy/` の中で雛形のほかに実行の権限を持つ1つのファイルとして探す。

const ROOT = join(import.meta.dirname, "..");
const DEPLOY = join(ROOT, "deploy");

const LABELS = [
  "jp.uslab.nexus.web",
  "jp.uslab.nexus.runner",
  "jp.uslab.nexus.backup",
  "jp.uslab.nexus.purge",
];
const PLISTS = LABELS.map((label) => join(DEPLOY, `${label}.plist`));
const CLAUDE_SETTINGS = join(DEPLOY, "claude-settings.json");
const ENV = join(DEPLOY, "env");
const TEMPLATES = [...PLISTS, CLAUDE_SETTINGS, ENV];

// DD-09 2.5 の `NEXUS_DATA_DIR/claude-settings.json` の表。
const BRAIN = "~/projects/brain-harness";
const EXPECTED_ALLOW = ["WebSearch", "WebFetch"];
const EXPECTED_DENY = [
  // ツール
  "Bash",
  "Edit",
  "Write",
  "NotebookEdit",
  // 読ませないファイル
  `Read(${BRAIN}/.git/**)`,
  `Read(${BRAIN}/.claude/**)`,
  `Read(${BRAIN}/**/.env*)`,
  `Read(${BRAIN}/**/*.pem)`,
  `Read(${BRAIN}/**/*.key)`,
  `Read(${BRAIN}/**/*.p12)`,
  `Read(${BRAIN}/**/id_rsa*)`,
  `Read(${BRAIN}/**/id_ed25519*)`,
  `Read(${BRAIN}/**/*credential*)`,
  `Read(${BRAIN}/**/*secret*)`,
  `Read(${BRAIN}/**/.netrc)`,
  `Read(${BRAIN}/**/.npmrc)`,
  // ページの読み取りの宛先
  "WebFetch(domain:localhost)",
  "WebFetch(domain:127.0.0.1)",
  "WebFetch(domain:*.ts.net)",
  "WebFetch(domain:*.local)",
];

// 子のプロセスを起動するのは M26 の起動の口だけなので（DD-01 1.3）、それを使う。
// 起動の口は、子が標準入力を読まずに先に終わると「標準入力に書けない」を標準エラーの末尾に足す（DD-06 1章）。
// そのため out は標準出力の行だけにし、標準エラーは stderr として別に返す。
// inputDelayMs を渡すと、標準出力を読み始めてから、その時間を待って標準入力を閉じる
// （子が先に終わった場合を作るため）。
async function run(
  command: string,
  args: string[],
  options: {
    env?: Record<string, string>;
    cwd?: string;
    inputDelayMs?: number;
  } = {},
): Promise<{
  code: number | null;
  out: string;
  stderr: string;
  launchError: string | null;
}> {
  const child = spawnLauncher({
    command,
    args,
    env: options.env ?? { PATH: "/usr/bin:/bin" },
    cwd: options.cwd ?? ROOT,
  });
  const lines: string[] = [];
  const reading = (async () => {
    for await (const line of child.lines) lines.push(line);
  })();
  if (options.inputDelayMs !== undefined)
    await new Promise((resolve) => setTimeout(resolve, options.inputDelayMs));
  child.writeInput("");
  await reading;
  const { code, launchError } = await child.ended;
  return { code, out: lines.join("\n"), stderr: child.stderr(), launchError };
}

const sorted = (values: unknown): unknown =>
  Array.isArray(values) ? [...values].sort() : values;

function findSetupScript(): string {
  const scripts = readdirSync(DEPLOY)
    .map((name) => join(DEPLOY, name))
    .filter((path) => !TEMPLATES.includes(path))
    .filter((path) => {
      const stat = statSync(path);
      return stat.isFile() && (stat.mode & 0o111) !== 0;
    });
  expect(scripts).toHaveLength(1);
  return scripts[0];
}

describe("deploy の雛形がある", () => {
  it.each(LABELS)(
    "launchd の雛形 %s.plist があり、Label が名前と同じ",
    async (label) => {
      const path = join(DEPLOY, `${label}.plist`);
      expect(existsSync(path)).toBe(true);
      const result = await run("/usr/bin/plutil", [
        "-extract",
        "Label",
        "raw",
        "-o",
        "-",
        path,
      ]);
      expect(result.code, result.stderr).toBe(0);
      expect(result.out.trim()).toBe(label);
    },
  );

  // 13-release の実装単位（DD-01 M26、DD-06 1章）: 子のプロセスが標準入力を読まずに終わっても、
  // Label の確かめは plutil の標準出力だけを比べるので通る。
  it.each(LABELS)(
    "%s.plist の Label の確かめが、子のプロセスが標準入力を読まずに終わっても通る",
    async (label) => {
      const path = join(DEPLOY, `${label}.plist`);
      // 子は標準入力を読まずに閉じ、plutil の結果を出して終わる。起動の口が標準入力に書くのは
      // 子が標準入力を閉じた後なので、起動の口は「標準入力に書けない」を標準エラーの末尾に足す。
      const result = await run(
        "/bin/sh",
        [
          "-c",
          'exec 0<&-; /usr/bin/plutil -extract Label raw -o - "$1"; s=$?; sleep 0.3; exit $s',
          "sh",
          path,
        ],
        { inputDelayMs: 100 },
      );
      expect(result.launchError).toBeNull();
      expect(result.code, result.stderr).toBe(0);
      // 子が先に終わった場合を作れていること（起動の口が標準エラーの末尾に足す）。
      expect(result.stderr).toContain("標準入力に書けない");
      // 比べる値は標準出力だけで、標準エラーを含まない。
      expect(result.out).not.toContain("標準入力に書けない");
      expect(result.out.trim()).toBe(label);
    },
  );

  it("Label の確かめが比べる値は plutil の標準出力だけで、標準エラーを含まない", async () => {
    const label = LABELS[0];
    const path = join(DEPLOY, `${label}.plist`);
    // plutil の標準出力に加えて、標準エラーにも書く子のプロセス。
    const result = await run("/bin/sh", [
      "-c",
      '/usr/bin/plutil -extract Label raw -o - "$1"; echo "stderr-only-marker" >&2',
      "sh",
      path,
    ]);
    expect(result.launchError).toBeNull();
    expect(result.code, result.stderr).toBe(0);
    expect(result.stderr).toContain("stderr-only-marker");
    expect(result.out).not.toContain("stderr-only-marker");
    expect(result.out.trim()).toBe(label);
  });

  it("CLI の設定の雛形 claude-settings.json がある", () => {
    expect(existsSync(CLAUDE_SETTINGS)).toBe(true);
    expect(statSync(CLAUDE_SETTINGS).isFile()).toBe(true);
  });

  it("環境変数の雛形 env がある", () => {
    expect(existsSync(ENV)).toBe(true);
    expect(statSync(ENV).isFile()).toBe(true);
  });
});

describe("launchd の雛形4つが plutil の lint を通る", () => {
  it.each(LABELS)("%s.plist", async (label) => {
    const result = await run("/usr/bin/plutil", [
      "-lint",
      join(DEPLOY, `${label}.plist`),
    ]);
    expect(result.launchError).toBeNull();
    expect(result.out).toContain("OK");
    expect(result.code, result.out).toBe(0);
  });
});

describe("CLI の設定の雛形の値が DD-09 2.5 の表と同じ", () => {
  const read = () =>
    JSON.parse(readFileSync(CLAUDE_SETTINGS, "utf8")) as {
      permissions?: Record<string, unknown>;
    };

  it("permissions.allow が WebSearch と WebFetch の2つだけ", () => {
    expect(sorted(read().permissions?.allow)).toEqual(sorted(EXPECTED_ALLOW));
  });

  it("permissions.deny がツール、読ませないファイル、ページの読み取りの宛先の表と同じ", () => {
    const deny = read().permissions?.deny;
    expect(Array.isArray(deny)).toBe(true);
    expect(sorted(deny)).toEqual(sorted(EXPECTED_DENY));
  });

  it("作業の場所の外の読み取りと書き込みを断る", () => {
    const permissions = read().permissions;
    expect(permissions?.blockReadsOutsideWorkingDirectories).toBe(true);
    expect(permissions?.blockWritesOutsideWorkingDirectories).toBe(true);
  });
});

describe("構築のスクリプトを一時のホームで動かすと DD-09 4章の手順 3 のフォルダが 0700 でできる", () => {
  let work: string;
  let home: string;
  let fakeBin: string;

  beforeEach(() => {
    work = mkdtempSync(join(tmpdir(), "nexus-deploy-"));
    home = join(work, "home");
    mkdirSync(home);
    // 本人の launchd に読み込ませないよう、launchctl は何もしない偽物にしておく（読み込みは手順 5）。
    fakeBin = join(work, "bin");
    mkdirSync(fakeBin);
    const launchctl = join(fakeBin, "launchctl");
    writeFileSync(launchctl, "#!/bin/sh\nexit 0\n");
    chmodSync(launchctl, 0o755);
  });

  afterEach(() => {
    rmSync(work, { recursive: true, force: true });
  });

  it("nexus/、nexus/ai-workdir/、Logs/nexus/ が権限 0700 でできる", async () => {
    const script = findSetupScript();
    const result = await run(script, [], {
      cwd: ROOT,
      env: {
        HOME: home,
        USER: process.env.USER ?? "nexus",
        LOGNAME: process.env.LOGNAME ?? "nexus",
        PATH: `${fakeBin}:/usr/bin:/bin:/usr/sbin:/sbin`,
        TMPDIR: work,
      },
    });
    expect(result.launchError).toBeNull();
    expect(result.code, result.out).toBe(0);

    const dataDir = join(home, "Library/Application Support/nexus");
    const dirs = [
      dataDir,
      join(dataDir, "ai-workdir"),
      join(home, "Library/Logs/nexus"),
    ];
    for (const dir of dirs) {
      expect(existsSync(dir), dir).toBe(true);
      const stat = statSync(dir);
      expect(stat.isDirectory(), dir).toBe(true);
      expect((stat.mode & 0o777).toString(8), dir).toBe("700");
    }
  });
});
