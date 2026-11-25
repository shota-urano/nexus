import type { Problem } from "../../contracts/english";
import type { GradeMark } from "../../ui/kinds/english/problem";

// 自動の採点（DD-01 M04。DD-02 FN-011 の表、BD-02 FN-011、RD-03 R08）。
// 採点の段へ進むときに、答えの形を持つ問題に ○ か × を付ける。答えの形の無い問題は付けない（null）。
// - choice: 選んだ選択肢の文字が `expected` と同じなら ○
// - number: 前後の空白を除き、両方を十進の数として読めて、値が同じなら ○。どちらかが読めなければ ×
// - text: 前後の空白を除き、NFKC で正規化し、小文字にして、同じなら ○
// - どれでも、答えが空なら ×（未回答も ×）

// 十進の数（符号、整数の部分、小数の部分）。指数の書き方は数として読まない。
const DECIMAL_PATTERN = /^([+-]?)([0-9]*)(?:\.([0-9]*))?$/;

// 十進の数を、値が同じなら同じ文字列になる形に直す。Number に変換すると桁の多い数が
// 丸められて別の値が同じになるため、文字列のまま比べる（例: 9007199254740992 と 9007199254740993）。
function decimalOf(value: string): string | null {
  const match = DECIMAL_PATTERN.exec(value.trim());
  if (match === null) return null;
  const [, sign, intDigits = "", fracDigits = ""] = match;
  if (intDigits === "" && fracDigits === "") return null;
  const intPart = intDigits.replace(/^0+/, "");
  const fracPart = fracDigits.replace(/0+$/, "");
  if (intPart === "" && fracPart === "") return "0";
  return `${sign === "-" ? "-" : ""}${intPart}.${fracPart}`;
}

function normalizeText(value: string): string {
  return value.trim().normalize("NFKC").toLowerCase();
}

export function autoGrade(
  problem: Pick<Problem, "answerType" | "expected">,
  answer: string | undefined,
): GradeMark | null {
  const { answerType, expected } = problem;
  if (answerType === null || answerType === undefined) return null;
  if (answer === undefined || answer.trim() === "") return "x";
  if (expected === null || expected === undefined) return "x";
  switch (answerType) {
    case "choice":
      return answer === expected ? "o" : "x";
    case "number": {
      const left = decimalOf(answer);
      const right = decimalOf(expected);
      return left !== null && right !== null && left === right ? "o" : "x";
    }
    case "text":
      return normalizeText(answer) === normalizeText(expected) ? "o" : "x";
  }
}
