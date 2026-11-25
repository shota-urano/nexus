"use client";

import { useRef, useState } from "react";
import { putEnglishAnswer } from "../../client/english";
import type {
  EnglishAnswer,
  EnglishSetDetail,
  Grade,
} from "../../contracts/english";
import { type BottomNotice, BottomNotices } from "../../ui/bottom-notices";
import { ConfirmPanel } from "../../ui/confirm-panel";
import { ReceivedText } from "../../ui/received-text";
import { EnglishMaterial } from "../../ui/kinds/english/lesson";
import {
  EnglishProblemGrade,
  EnglishProblemQuestion,
  type GradeMark,
  hasAnswerField,
} from "../../ui/kinds/english/problem";
import { autoGrade } from "./grading";
import { ENGLISH_MESSAGES } from "./messages";

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
// 完了したことのある教材は、教材の段に前の答えと採点を出し、「やり直す」（A11）で前の答えを
// 初めの値にして問題の段の1問目から始め直す（BD-02 FN-009 代替の流れ、SCR-005-A01・A11、
// DD-02 FN-009 手順 6）。サーバは呼ばない。
// 採点の段の「完了」（A07、FN-012）だけがサーバを呼ぶ（`putEnglishAnswer`）。
// - ○△× の付いていない問題があれば、呼ばずに MSG-005 を下の知らせに出す。
// - 完了したことのある教材なら、確認の面で MSG-006 を出し、「置き換える」を選んだときだけ呼ぶ。
//   「やめる」では何もしない（BD-02 FN-012 代替の流れ、DD-02 FN-012 手順 5）。
// - 押してから結果が出るまで「完了」を押せなくする（BD-09 5章 誤操作の防止、DD-05 4章）。
// - 残せたら「完了」の近くに完了の印と、答えが翌朝の教材に反映されることを出す（RD-06 UC-010）。
//   残した答えを前の答えにする（次の「完了」は置き換えの確認を出す）。
// - 残せなければ MSG-007 を下の知らせに出し、答えと ○△× は画面に残す（DD-02 FN-012 手順 6）。
//   400 で MSG-005 が返れば MSG-005 を出す。401（MSG-020）は M01 の枠が出すので何も出さない。
// 知らせは本人が閉じるか、もう一度「完了」を押して残せるまで残す（BD-09 6章）。

type Stage = "material" | "questions" | "grading";

const STAGES: { stage: Stage; label: string }[] = [
  { stage: "material", label: "① 教材" },
  { stage: "questions", label: "② 問題" },
  { stage: "grading", label: "③ 採点" },
];

function initialAnswers(
  lastAnswer: EnglishAnswer | null,
): Record<number, string> {
  const answers: Record<number, string> = {};
  for (const grade of lastAnswer?.grades ?? []) {
    if (grade.answer !== undefined) answers[grade.no] = grade.answer;
  }
  return answers;
}

function initialGrades(
  lastAnswer: EnglishAnswer | null,
): Record<number, GradeMark | null> {
  const grades: Record<number, GradeMark | null> = {};
  for (const grade of lastAnswer?.grades ?? []) {
    grades[grade.no] = grade.grade;
  }
  return grades;
}

const GRADE_LABELS: Record<GradeMark, string> = { o: "○", d: "△", x: "×" };

const buttonClass = "min-h-11 rounded border px-4";

type MessageId = keyof typeof ENGLISH_MESSAGES;

export function EnglishStudy({ set }: { set: EnglishSetDetail }) {
  const [stage, setStage] = useState<Stage>("material");
  const [index, setIndex] = useState(0);
  // 前に完了した答え。完了で残せたら、残した答えに替える。
  const [lastAnswer, setLastAnswer] = useState<EnglishAnswer | null>(
    set.lastAnswer,
  );
  const [answers, setAnswers] = useState<Record<number, string>>(() =>
    initialAnswers(set.lastAnswer),
  );
  const [grades, setGrades] = useState<Record<number, GradeMark | null>>(() =>
    initialGrades(set.lastAnswer),
  );
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // 続けて押されたとき、画面を描き直す前の2回目も止める。
  const submittingRef = useRef(false);
  const [completed, setCompleted] = useState(false);
  const [notices, setNotices] = useState<BottomNotice[]>([]);
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

  const restart = () => {
    // やり直す（A11）: 前の答えと採点を初めの値に戻し、問題の段の1問目から始める。
    setAnswers(initialAnswers(lastAnswer));
    setGrades(initialGrades(lastAnswer));
    setCompleted(false);
    setIndex(0);
    setStage("questions");
  };

  const showNotice = (id: MessageId) => {
    setNotices((previous) => [
      ...previous.filter((notice) => notice.id !== id),
      { id, kind: "error", text: ENGLISH_MESSAGES[id] },
    ]);
  };

  const send = async () => {
    if (submittingRef.current) return;
    const body: Grade[] = [];
    for (const item of problems) {
      const grade = grades[item.no];
      if (grade === null || grade === undefined) return;
      body.push(
        hasAnswerField(item)
          ? { no: item.no, grade, answer: answerOf(item.no) }
          : { no: item.no, grade },
      );
    }
    submittingRef.current = true;
    setSubmitting(true);
    setCompleted(false);
    try {
      const result = await putEnglishAnswer(set.contentId, { grades: body });
      if (result.status === "ok") {
        setLastAnswer(result.value);
        setCompleted(true);
        setNotices([]);
      } else if (result.status === "ungraded") {
        showNotice("MSG-005");
      } else if (result.status === "rejected") {
        showNotice("MSG-019");
      } else if (result.status === "failed") {
        showNotice("MSG-007");
      }
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const complete = () => {
    if (submittingRef.current) return;
    const ungraded = problems.some(
      (item) => grades[item.no] === null || grades[item.no] === undefined,
    );
    if (ungraded) {
      showNotice("MSG-005");
      return;
    }
    if (lastAnswer !== null) {
      setConfirming(true);
      return;
    }
    void send();
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
          {lastAnswer !== null && (
            <section aria-label="前の答えと採点" className="mt-6">
              <h3 className="font-bold">前の答えと採点</h3>
              <ol>
                {lastAnswer.grades.map((item) => (
                  <li key={item.no} className="border-b py-2 text-sm">
                    問題 {item.no}: {GRADE_LABELS[item.grade]}
                    {item.answer !== undefined && item.answer !== ""
                      ? `（あなたの答え: ${item.answer}）`
                      : ""}
                  </li>
                ))}
              </ol>
            </section>
          )}
          <div className="mt-6 flex gap-2">
            <button
              type="button"
              className={buttonClass}
              onClick={() => setStage("questions")}
            >
              問題へ
            </button>
            {lastAnswer !== null && (
              <button type="button" className={buttonClass} onClick={restart}>
                やり直す
              </button>
            )}
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
          <div className="mt-6 flex flex-wrap gap-2">
            <button
              type="button"
              className={buttonClass}
              disabled={submitting}
              aria-busy={submitting}
              onClick={complete}
            >
              完了
            </button>
            <button
              type="button"
              className={buttonClass}
              onClick={() => setStage("questions")}
            >
              問題へ戻る
            </button>
          </div>
          {completed && (
            <p role="status" className="mt-3 flex items-center gap-2">
              <span
                role="img"
                aria-label="完了した印"
                className="inline-flex h-6 w-6 items-center justify-center rounded-full border font-bold"
              >
                ✓
              </span>
              答えは翌朝の教材に反映されます。
            </p>
          )}
        </section>
      )}
      <ConfirmPanel
        open={confirming}
        message={ENGLISH_MESSAGES["MSG-006"]}
        confirmLabel="置き換える"
        cancelLabel="やめる"
        onConfirm={() => {
          setConfirming(false);
          void send();
        }}
        onCancel={() => setConfirming(false)}
      />
      <BottomNotices
        notices={notices}
        onClose={(id) =>
          setNotices((previous) =>
            previous.filter((notice) => notice.id !== id),
          )
        }
      />
    </div>
  );
}
