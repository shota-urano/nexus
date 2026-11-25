import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..");
const read = (name: string) => readFileSync(join(root, name), "utf8");

// Makefile の verify の目標の、レシピの行（タブで始まる行）を取り出す。
function verifyRecipe(): string[] {
  const lines = read("Makefile").split("\n");
  const start = lines.findIndex((line) => /^verify\s*:/.test(line));
  expect(start).toBeGreaterThanOrEqual(0);
  const recipe: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (!line.startsWith("\t")) break;
    recipe.push(line.trim());
  }
  return recipe;
}

// レシピの行のうち、道具を呼ぶ行（mkdir などの準備を除く）。
function verifySteps(): string[] {
  return verifyRecipe().filter((line) => !/^@?mkdir\b/.test(line));
}

describe("01-foundation 足場", () => {
  it("verify の目標に前提の目標が無く、5つの手順がレシピに直に書いてある", () => {
    const header = read("Makefile")
      .split("\n")
      .find((line) => /^verify\s*:/.test(line));
    expect(header?.replace(/^verify\s*:/, "").trim()).toBe("");
    expect(verifySteps()).toHaveLength(5);
  });

  it("verify は Prettier の確かめ、ESLint、型の確かめ、Redocly CLI の lint、Vitest の順に呼ぶ", () => {
    const steps = verifySteps();
    expect(steps[0]).toMatch(/\bprettier --check\b/);
    expect(steps[1]).toMatch(/\beslint\b/);
    expect(steps[2]).toMatch(/\btsc --noEmit\b/);
    expect(steps[3]).toMatch(/\bredocly lint\b/);
    expect(steps[4]).toMatch(/\bvitest run\b/);
  });

  it("verify の手順に、npm の置き場所へ通信する手順が無い", () => {
    const recipe = verifyRecipe().join("\n");
    expect(recipe).not.toMatch(
      /\bnpx\b|\bnpm\b|\bpnpm\b|\byarn\b|\bcurl\b|\bwget\b|registry/,
    );
    // 道具は手元の node_modules/.bin から呼ぶ。
    for (const step of verifySteps()) {
      expect(step).toMatch(/^\$\(BIN\)\//);
    }
    const makefile = read("Makefile");
    expect(makefile).toMatch(/^BIN := \.\/node_modules\/\.bin$/m);
    // Redocly CLI の新しい版の問い合わせ（npm の置き場所への通信）と利用状況の送信を止めている。
    expect(makefile).toMatch(
      /^export REDOCLY_SUPPRESS_UPDATE_NOTICE := true$/m,
    );
    expect(makefile).toMatch(/^export REDOCLY_TELEMETRY := off$/m);
  });

  it(".nvmrc と package.json の engines に同じ Node.js の番号がある", () => {
    const nvmrc = read(".nvmrc").trim();
    expect(nvmrc).toMatch(/^\d+$/);
    const pkg = JSON.parse(read("package.json")) as {
      engines?: { node?: string };
    };
    expect(pkg.engines?.node).toBe(`${nvmrc}.x`);
  });

  it(".gitignore に .data/ がある", () => {
    const lines = read(".gitignore")
      .split("\n")
      .map((line) => line.trim());
    expect(lines).toContain(".data/");
  });
});
