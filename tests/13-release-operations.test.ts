import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// 13-release の実装単位2: 運用の手順書 `docs/operations/` の OP01〜OP11（NFR-027、BD-11 7章）。
// 受け入れ基準は DD-10 TC128:
//   OP01〜OP11 の11のファイルがある。どのファイルにも「きっかけ」「手順」「確かめ方」の見出しがある。
//   OP07 と OP11 に「持ち出さない」「本人のユーザの中だけで戻す」「捨てる前に中身を消す」の3つの文がある。
// BD-11 7章は「OP の番号ごとに置く」とだけ書き、ファイル名の残りは決めていない。
// そこで、名前が `OPnn` で始まる Markdown のファイル（`OP01.md`、`OP01-install.md` など）を、その番号の手順書として探す。
// 見出しは Markdown の見出しの行（`#` で始まる行）で、番号の前置き（`1.` など）を除いた文字が、その語と同じものを数える。

const ROOT = join(import.meta.dirname, "..");
const OPERATIONS = join(ROOT, "docs", "operations");

const NUMBERS = Array.from(
  { length: 11 },
  (_, i) => `OP${String(i + 1).padStart(2, "0")}`,
);
const HEADINGS = ["きっかけ", "手順", "確かめ方"];
const SENTENCES = [
  "持ち出さない",
  "本人のユーザの中だけで戻す",
  "捨てる前に中身を消す",
];

function listFiles(): string[] {
  if (!existsSync(OPERATIONS)) return [];
  return readdirSync(OPERATIONS).filter((name) =>
    statSync(join(OPERATIONS, name)).isFile(),
  );
}

function filesFor(number: string): string[] {
  const pattern = new RegExp(`^${number}(?![0-9]).*\\.md$`);
  return listFiles().filter((name) => pattern.test(name));
}

function read(number: string): string {
  const files = filesFor(number);
  expect(
    files,
    `${number} の手順書が docs/operations/ に1つだけある`,
  ).toHaveLength(1);
  return readFileSync(join(OPERATIONS, files[0]!), "utf8");
}

function headings(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) =>
      m[1]!.replace(/^(?:\d+(?:\.\d+)*\.?|[0-9０-９]+[.．、])\s*/, "").trim(),
    );
}

// 文が行の途中で折り返されても読めるように、行の区切りを除いて照らす。
function joined(text: string): string {
  return text.replace(/\r?\n[ \t]*/g, "");
}

describe("13-release 運用の手順書（DD-10 TC128）", () => {
  it("docs/operations/ がある", () => {
    expect(existsSync(OPERATIONS)).toBe(true);
  });

  it.each(NUMBERS)("%s の手順書のファイルが1つだけある", (number) => {
    expect(filesFor(number)).toHaveLength(1);
  });

  it("OP01〜OP11 の11のファイルがそろっている", () => {
    const found = NUMBERS.filter((number) => filesFor(number).length === 1);
    expect(found).toEqual(NUMBERS);
  });

  describe.each(NUMBERS)("%s", (number) => {
    it.each(HEADINGS)("「%s」の見出しがある", (heading) => {
      expect(headings(read(number))).toContain(heading);
    });
  });

  describe.each(["OP07", "OP11"])("%s", (number) => {
    it.each(SENTENCES)("「%s」の文がある", (sentence) => {
      expect(joined(read(number))).toContain(sentence);
    });
  });
});
