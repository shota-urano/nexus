import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { ESLint, type Linter } from "eslint";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { acquireBuildLock, releaseBuildLock } from "./fixtures/build";

// DD-10 TC101: 層の規則（DD-01 1.3）を ESLint の設定で確かめる。
// import/no-restricted-paths は読み込む先のファイルが無いと確かめず、import/no-cycle は
// 実在しないファイルを lint できないので、見本は一時的なファイルとして置き、終わったら消す。
const root = join(import.meta.dirname, "..");
const tag = `__tc101-${process.pid}__`;
const eslint = new ESLint({ cwd: root });
const created = new Set<string>();

// 見本を置く。新しく作ったいちばん上のフォルダを覚えておき、終わったら消す。
function place(file: string, code: string): string {
  const path = join(root, file);
  let top = dirname(path);
  while (!existsSync(dirname(top))) top = dirname(top);
  if (!existsSync(top)) created.add(top);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, code);
  created.add(path);
  return path;
}

async function lint(file: string, code: string): Promise<Linter.LintMessage[]> {
  const [result] = await eslint.lintFiles([place(file, code)]);
  return result.messages;
}

function errorsOf(messages: Linter.LintMessage[], ruleId: string) {
  return messages.filter((m) => m.ruleId === ruleId && m.severity === 2);
}

// 見本には型の確かめで誤りになるもの（読み込みの輪）がある。ほかの試験の `npm run build` が
// 見本を拾わないよう、見本を置いてから消すまで、build と同じ印を持つ（tests/fixtures/build.ts）。
beforeAll(async () => {
  await acquireBuildLock();
}, 10 * 60_000);

afterAll(() => {
  try {
    for (const path of created) rmSync(path, { recursive: true, force: true });
  } finally {
    releaseBuildLock();
  }
});

describe("TC101 層の規則（DD-01 1.3）", () => {
  it("src/screens/ から src/server/ を読み込む見本は ESLint のエラーになる", async () => {
    place(`src/server/${tag}/sample.ts`, "export const sample = 1;\n");
    for (const source of [
      `../../server/${tag}/sample`,
      `@/server/${tag}/sample`,
    ]) {
      const messages = await lint(
        `src/screens/${tag}/sample.ts`,
        `import { sample } from "${source}";\nexport const x = sample;\n`,
      );
      expect(
        errorsOf(messages, "import/no-restricted-paths"),
        source,
      ).toHaveLength(1);
    }
  });

  it("src/runner/ai-provider/ の外から node:child_process を読み込む見本は ESLint のエラーになる", async () => {
    for (const source of ["node:child_process", "child_process"]) {
      for (const file of [
        `src/runner/purposes/${tag}.ts`,
        `src/server/${tag}/spawn.ts`,
        `src/screens/${tag}/spawn.ts`,
        `tests/${tag}.ts`,
      ]) {
        const messages = await lint(
          file,
          `import { spawn } from "${source}";\nexport const x = spawn;\n`,
        );
        expect(
          errorsOf(messages, "no-restricted-imports"),
          `${file} から ${source}`,
        ).toHaveLength(1);
      }
    }
  });

  it("src/runner/ai-provider/ の中から node:child_process を読み込むのはエラーにならない", async () => {
    const messages = await lint(
      `src/runner/ai-provider/${tag}.ts`,
      'import { spawn } from "node:child_process";\nexport const x = spawn;\n',
    );
    expect(errorsOf(messages, "no-restricted-imports")).toHaveLength(0);
  });

  it("モジュールどうしの読み込みの輪は import/no-cycle のエラーになる", async () => {
    place(
      `src/server/${tag}/cycle-b.ts`,
      'import { a } from "./cycle-a";\nexport const b = () => a;\n',
    );
    const messages = await lint(
      `src/server/${tag}/cycle-a.ts`,
      'import { b } from "./cycle-b";\nexport const a = () => b;\n',
    );
    expect(errorsOf(messages, "import/no-cycle")).toHaveLength(1);
  });
});

describe("空の catch の禁止（DD-06 1章）", () => {
  it("空の catch は ESLint のエラーになる", async () => {
    const messages = await lint(
      `src/server/${tag}/empty-catch.ts`,
      "export function f(g: () => void) {\n  try {\n    g();\n  } catch {}\n}\n",
    );
    expect(errorsOf(messages, "no-empty")).toHaveLength(1);
  });
});
