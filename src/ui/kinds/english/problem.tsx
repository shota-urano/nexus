import {
  ENGLISH_ANSWER_MAX_LENGTH,
  type Problem,
} from "../../../contracts/english";
import { ReceivedText } from "../../received-text";

// 英語の問題の表示部品（DD-01 M08。BD-03 SCR-005-I01、O06）。
// - 問題の段: 問いと答えの欄。欄は答えの形による（選ぶは選択、数は数値、文はテキスト）。
//   答えの形の無い問題と、手元で解く問題（kind が code）は欄を出さない。
//   答えは 500 文字まで（BD-07 4.1）。超える入力は入れない。
// - 採点の段: 問い、入れた答え、正解と解説、○△× の印。○△× を押すと替わる。

export type GradeMark = "o" | "d" | "x";

const GRADE_MARKS: { value: GradeMark; label: string }[] = [
  { value: "o", label: "○" },
  { value: "d", label: "△" },
  { value: "x", label: "×" },
];

// 答えの欄を出す問題か。
export function hasAnswerField(problem: Problem): boolean {
  return (
    problem.kind !== "code" &&
    problem.answerType !== null &&
    problem.answerType !== undefined
  );
}

function withinLimit(value: string): boolean {
  return [...value].length <= ENGLISH_ANSWER_MAX_LENGTH;
}

export function EnglishProblemQuestion({
  problem,
  answer,
  onAnswer,
}: {
  problem: Problem;
  answer: string;
  onAnswer: (answer: string) => void;
}) {
  const label = `問題 ${problem.no} の答え`;
  const change = (value: string) => {
    if (withinLimit(value)) onAnswer(value);
  };
  return (
    <div>
      <ReceivedText markdown={problem.questionMd} />
      {hasAnswerField(problem) &&
        (problem.answerType === "choice" ? (
          <fieldset className="my-3">
            <legend className="sr-only">{label}</legend>
            {(problem.choices ?? []).map((choice) => (
              <label
                key={choice}
                className="flex min-h-11 items-center gap-2 px-1"
              >
                <input
                  type="radio"
                  name={`problem-${problem.no}`}
                  value={choice}
                  checked={answer === choice}
                  onChange={() => change(choice)}
                />
                {choice}
              </label>
            ))}
          </fieldset>
        ) : (
          <input
            type="text"
            aria-label={label}
            inputMode={problem.answerType === "number" ? "decimal" : "text"}
            value={answer}
            onChange={(event) => change(event.target.value)}
            className="my-3 min-h-11 w-full rounded border px-3 text-base"
          />
        ))}
    </div>
  );
}

export function EnglishProblemGrade({
  problem,
  answer,
  grade,
  onGrade,
}: {
  problem: Problem;
  answer: string;
  grade: GradeMark | null;
  onGrade: (grade: GradeMark) => void;
}) {
  return (
    <div>
      <ReceivedText markdown={problem.questionMd} />
      {hasAnswerField(problem) && (
        <p className="my-2 text-sm">
          あなたの答え: {answer === "" ? "（未回答）" : answer}
        </p>
      )}
      <div className="my-2 rounded-lg border px-3">
        <ReceivedText markdown={problem.answerMd} />
      </div>
      <div
        role="group"
        aria-label={`問題 ${problem.no} の採点`}
        className="flex gap-2"
      >
        {GRADE_MARKS.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            aria-pressed={grade === value}
            onClick={() => onGrade(value)}
            className="min-h-11 min-w-11 rounded border text-lg aria-pressed:font-bold aria-pressed:ring-2"
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
