import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// 13-release の実装単位: 運用の手順書 OP01 の手順 9（自動でログイン）と、確かめ方の「再起動からの戻り」を、
// FileVault をオンにして再起動の後は本人がログインする形に直す。計画した再起動は `sudo fdesetup authrestart` で行う
// （NFR-005、DD-09 2.6・4章、CR-016）。
// 受け入れ基準:
//   - DD-10 TC128 が通る（tests/13-release-operations.test.ts が確かめる）。
//   - OP01 に自動でログインする手順が無く、再起動の後に本人がログインすることと `sudo fdesetup authrestart` が書いてある。
//   - 確かめ方の「再起動からの戻り」の期待する結果が、ログインから 5 分以内に `/api/health` が 200 である。

const ROOT = join(import.meta.dirname, "..");
const OPERATIONS = join(ROOT, "docs", "operations");

function readOp01(): string {
  const files = existsSync(OPERATIONS)
    ? readdirSync(OPERATIONS).filter((name) =>
        /^OP01(?![0-9]).*\.md$/.test(name),
      )
    : [];
  expect(files, "OP01 の手順書が docs/operations/ に1つだけある").toHaveLength(
    1,
  );
  return readFileSync(join(OPERATIONS, files[0]!), "utf8");
}

// 見出し（`##` の行）の名前で、その節の本文を取り出す。番号の前置き（`1.` など）は除いて比べる。
function section(text: string, name: string): string {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => {
    const m = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    return (
      m !== null &&
      m[2]!
        .replace(/^(?:\d+(?:\.\d+)*\.?|[0-9０-９]+[.．、])\s*/, "")
        .trim() === name
    );
  });
  expect(start, `「${name}」の見出しがある`).toBeGreaterThanOrEqual(0);
  const level = /^(#{1,6})/.exec(lines[start]!)![1]!.length;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => {
    const m = /^(#{1,6})\s/.exec(line);
    return m !== null && m[1]!.length <= level;
  });
  return (end === -1 ? rest : rest.slice(0, end)).join("\n");
}

// 文が行の途中で折り返されても読めるように、行の区切りを除いて照らす。
function joined(text: string): string {
  return text.replace(/\r?\n[ \t]*/g, "");
}

// 照らすときに、空白とコードの印（`）を除く。
function compact(text: string): string {
  return text.replace(/[\s`　]/g, "");
}

// 文（。か行の区切りで分ける）の一覧。
function sentences(text: string): string[] {
  return joined(text)
    .split(/[。]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function tableRows(text: string): string[][] {
  return text
    .split(/\r?\n/)
    .filter((line) => /^\s*\|.*\|\s*$/.test(line))
    .map((line) =>
      line
        .trim()
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|")
        .map((cell) => cell.trim()),
    );
}

describe("13-release OP01 の再起動と FileVault（CR-016）", () => {
  it("OP01 に自動でログインさせる手順や確かめが無い", () => {
    const text = joined(readOp01());
    // 「自動でログインする」「自動ログインさせる」「自動でログインすることを確かめる」などの肯定の形を探す。
    // 「自動でログインしない」「自動でログインせず」は許す。
    const affirmative =
      /自動(?:で|の)?ログイン(?:する|させる|を(?:オン|有効|設定|確かめ))(?!ことは(?:な|無)い)/g;
    expect(text.match(affirmative) ?? []).toEqual([]);
    // macOS の自動のログインを設定するコマンドや設定の名前も無い。
    expect(text).not.toMatch(/autoLoginUser/);
    expect(text).not.toMatch(/sysadminctl[^\n]*-autologin/);
  });

  it("FileVault をオンにすることが書いてある", () => {
    expect(joined(readOp01())).toMatch(/FileVault/);
  });

  it("再起動の後に本人がログインすることが書いてある", () => {
    const found = sentences(readOp01()).filter(
      (s) => s.includes("再起動") && s.includes("本人がログイン"),
    );
    expect(
      found.length,
      "「再起動」と「本人がログイン」を同じ文に含む文がある",
    ).toBeGreaterThan(0);
  });

  it("計画した再起動を `sudo fdesetup authrestart` で行うことが書いてある", () => {
    const text = readOp01();
    expect(text).toContain("sudo fdesetup authrestart");
  });

  it("確かめ方の「再起動からの戻り」の期待する結果が、ログインから 5 分以内に /api/health が 200 である", () => {
    const rows = tableRows(section(readOp01(), "確かめ方"));
    const header = rows.find((cells) => cells.includes("期待する結果"));
    expect(header, "確かめ方の表に「期待する結果」の列がある").toBeDefined();
    const column = header!.indexOf("期待する結果");
    const matched = rows.filter((cells) => cells[0] === "再起動からの戻り");
    expect(
      matched,
      "確かめ方の表に「再起動からの戻り」の行が1つだけある",
    ).toHaveLength(1);
    const expected = compact(matched[0]![column] ?? "");
    expect(expected).toContain("ログインから5分以内に/api/healthが200");
  });
});
