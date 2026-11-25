"use client";

import { useState } from "react";
import type { EnglishSetDetail } from "../../contracts/english";
import { ReceivedText } from "../../ui/received-text";
import { EnglishMaterial } from "../../ui/kinds/english/lesson";
import {
  EnglishProblemGrade,
  EnglishProblemQuestion,
  type GradeMark,
} from "../../ui/kinds/english/problem";
import { autoGrade } from "./grading";

// SCR-005 英語の学習の部品（DD-01 M04。BD-03 SCR-005、BD-02 FN-009〜FN-011）。
// 段は教材 → 問題 → 採点の順で、通った段には戻れ、先へは飛ばせない（RD-03 R07）。
// 先の段へ飛ぶ操作は置かない。段の印（O02）は押せない。
// - 教材の段: 教材の本文と読む教材（M08）。「問題へ」（A03）。
// - 問題の段: 問題を1問ずつ出し、答えを画面の中に預かる（FN-010、A04）。未回答があっても
//   「採点へ」（A05）で進める。「教材へ戻る」（A10）でも答えは預けたまま。
// - 採点の段: 進むときに答えの形を持つ問題に自動で ○ か × を付け（FN-011）、正解と解説と
//   ○△× を出す。○△× を押すと替わる（A06）。締めの一言（O07）を終わりに置く。
//   「問題へ戻る」（A10）。
// サーバは呼ばない（FN-010、FN-011 は画面の中だけで動く）。
// 答えの初めの値は、前に完了していればその答え、無ければ空（SCR-005-I01）。

type Stage = "material" | "questions" | "grading";

const STAGES: { stage: Stage; label: string }[] = [
  { stage: "material", label: "① 教材" },
  { stage: "questions", label: "② 問題" },
  { stage: "grading", label: "③ 採点" },
];

function initialAnswers(set: EnglishSetDetail): Record<number, string> {
  const answers: Record<number, string> = {};
  for (const grade of set.lastAnswer?.grades ?? []) {
    if (grade.answer !== undefined) answers[grade.no] = grade.answer;
  }
  return answers;
}

const buttonClass = "min-h-11 rounded border px-4";

export function EnglishStudy({ set }: { set: EnglishSetDetail }) {
  const [stage, setStage] = useState<Stage>("material");
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<number, string>>(() =>
    initialAnswers(set),
  );
  const [grades, setGrades] = useState<Record<number, GradeMark | null>>({});
  const problems = set.problems;
  const answerOf = (no: number) => answers[no] ?? "";

  const toGrading = () => {
    // 採点の段へ進むたびに、答えの形を持つ問題へ自動の結果を付け直す。答えの形の無い問題は
    // 本人が付けた ○△× をそのまま残す。
    setGrades((previous) => {
      const next = { ...previous };
      for (const problem of problems) {
        const auto = autoGrade(problem, answers[problem.no]);
        if (auto !== null) next[problem.no] = auto;
      }
      return next;
    });
    setStage("grading");
  };

  const problem = problems[index];

  return (
    <div className="px-4 pb-12">
      <h2 className="my-2 text-lg font-bold">{set.learningTheme}</h2>
      <ol aria-label="今の段" className="my-3 flex gap-2 text-sm">
        {STAGES.map((item) => (
          <li
            key={item.stage}
            aria-current={item.stage === stage ? "step" : undefined}
            className="rounded-lg border px-2 py-1 aria-[current=step]:font-bold"
          >
            {item.label}
          </li>
        ))}
      </ol>

      {stage === "material" && (
        <section aria-label="教材の段">
          <EnglishMaterial lessonMd={set.lessonMd} reading={set.reading} />
          <div className="mt-6 flex gap-2">
            <button
              type="button"
              className={buttonClass}
              onClick={() => setStage("questions")}
            >
              問題へ
            </button>
          </div>
        </section>
      )}

      {stage === "questions" && (
        <section aria-label="問題の段">
          {problem !== undefined && (
            <>
              <p className="text-sm">
                問題 {index + 1} / {problems.length}
              </p>
              <EnglishProblemQuestion
                key={problem.no}
                problem={problem}
                answer={answerOf(problem.no)}
                onAnswer={(value) =>
                  setAnswers((previous) => ({
                    ...previous,
                    [problem.no]: value,
                  }))
                }
              />
              <div className="my-3 flex gap-2">
                <button
                  type="button"
                  className={buttonClass}
                  disabled={index === 0}
                  onClick={() => setIndex(index - 1)}
                >
                  前の問題
                </button>
                <button
                  type="button"
                  className={buttonClass}
                  disabled={index >= problems.length - 1}
                  onClick={() => setIndex(index + 1)}
                >
                  次の問題
                </button>
              </div>
            </>
          )}
          <div className="mt-6 flex flex-wrap gap-2">
            <button
              type="button"
              className={buttonClass}
              onClick={() => setStage("material")}
            >
              教材へ戻る
            </button>
            <button type="button" className={buttonClass} onClick={toGrading}>
              採点へ
            </button>
          </div>
        </section>
      )}

      {stage === "grading" && (
        <section aria-label="採点の段">
          <ol>
            {problems.map((item) => (
              <li key={item.no} className="border-b py-3">
                <EnglishProblemGrade
                  problem={item}
                  answer={answerOf(item.no)}
                  grade={grades[item.no] ?? null}
                  onGrade={(grade) =>
                    setGrades((previous) => ({ ...previous, [item.no]: grade }))
                  }
                />
              </li>
            ))}
          </ol>
          {set.closingMd !== null && set.closingMd !== "" && (
            <section aria-label="締めの一言" className="mt-4">
              <ReceivedText markdown={set.closingMd} />
            </section>
          )}
          <div className="mt-6 flex gap-2">
            <button
              type="button"
              className={buttonClass}
              onClick={() => setStage("questions")}
            >
              問題へ戻る
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
