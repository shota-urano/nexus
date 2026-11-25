import type { Database } from "../../db/connection";
import { toDbError } from "../../db/errors";
import { inReadTransaction, inWriteTransaction } from "../../db/transaction";
import {
  type ContentStateRow,
  findContentState,
  setContentRead,
} from "../../repositories/content-state";
import {
  type EnglishSetListRow,
  findEnglishProblemsJson,
  findEnglishSetDetail,
  listEnglishSetRows,
  upsertEnglishAnswerRow,
} from "../../repositories/english";
import type { Clock } from "../../shared/clock";
import { formatDateTime } from "../../shared/datetime";
import { NexusError } from "../../shared/errors";
import { type Page, type PageQuery, toPage } from "../../shared/paging";

// 英語の教材の一覧、教材、完了（DD-01 M16。DD-02 FN-008、FN-009、FN-012、3章 P03、P04、DD-05）。
// 端末の API の入口（M11）に渡す。入口層は DB を読み込まないので、DB の接続をここに閉じ込める。

// `openapi.yaml` の `Grade`。`grade` は ○（o）、△（d）、×（x）。
export interface EnglishGrade {
  no: number;
  grade: "o" | "d" | "x";
  answer?: string;
}

// `openapi.yaml` の `EnglishAnswer`。
export interface EnglishAnswer {
  contentId: number;
  grades: EnglishGrade[];
  completedAt: string;
}

// `openapi.yaml` の `ContentState`。
export interface EnglishContentState {
  contentId: number;
  isNew: boolean;
  isRead: boolean;
  isSaved: boolean;
  savedAt: string | null;
}

// `openapi.yaml` の `EnglishSetSummary`。
export interface EnglishSetSummary {
  contentId: number;
  learningTheme: string;
  targetDate: string;
  receivedAt: string;
  isNew: boolean;
  isRead: boolean;
  isSaved: boolean;
  isCompleted: boolean;
}

// `openapi.yaml` の `EnglishSetDetail`。問題と読む教材は残した JSON をそのまま返す。
export interface EnglishSetDetail {
  contentId: number;
  learningTheme: string;
  targetDate: string;
  lessonMd: string;
  problems: unknown[];
  closingMd: string | null;
  reading: unknown;
  state: EnglishContentState;
  lastAnswer: EnglishAnswer | null;
}

export interface EnglishLearning {
  // 教材の一覧（FN-008）。対象日の新しい順に 3章 P03 で返す。
  listSets(query: PageQuery): Page<EnglishSetSummary>;
  // 教材（FN-009）。内容が無いか英語でなければ NOT_FOUND を投げる。
  getSet(contentId: number): EnglishSetDetail;
  // 完了（FN-012）。答えを置き換え、既読にする。内容が無いか英語でなければ NOT_FOUND を、
  // `grades` の問題番号が問題と重なりなく全て一致しなければ RULE_VIOLATION（MSG-005）を投げる。
  putAnswer(contentId: number, grades: EnglishGrade[]): EnglishAnswer;
}

function toState(row: ContentStateRow): EnglishContentState {
  return {
    contentId: row.contentId,
    isNew: row.openedAt === null,
    isRead: row.isRead,
    isSaved: row.isSaved,
    savedAt: row.savedAt,
  };
}

function toSummary(row: EnglishSetListRow): EnglishSetSummary {
  return {
    contentId: row.contentId,
    learningTheme: row.learningTheme,
    targetDate: row.targetDate,
    receivedAt: row.receivedAt,
    isNew: row.openedAt === null,
    isRead: row.isRead,
    isSaved: row.isSaved,
    isCompleted: row.isCompleted,
  };
}

function notFound(): NexusError {
  return new NexusError("NOT_FOUND", "英語の教材が無い");
}

// 問題の番号の集合（`problems_json` の各問題の `no`）。
function problemNumbers(problemsJson: string): number[] {
  const problems = JSON.parse(problemsJson) as { no: number }[];
  return problems.map((problem) => problem.no);
}

// `grades` の問題番号が、問題の番号と重なりなく全て一致するか（DD-02 FN-012 手順 3、2章 C04）。
// 全てに ○△× があることは、入口が `Grade` の形（`grade` は必須）で確かめてある。
export function gradesMatchProblems(
  grades: EnglishGrade[],
  numbers: number[],
): boolean {
  const given = new Set(grades.map((grade) => grade.no));
  if (given.size !== grades.length) return false;
  const expected = new Set(numbers);
  if (given.size !== expected.size) return false;
  for (const no of given) {
    if (!expected.has(no)) return false;
  }
  return true;
}

export function createEnglishLearning(deps: {
  db: Database;
  clock: Clock;
}): EnglishLearning {
  const { db, clock } = deps;

  return {
    listSets({ after, limit }) {
      try {
        // P03 手順 2〜3: `limit + 1` 件を読み、続きがあるかを決める。
        const rows = listEnglishSetRows(db, after, limit + 1);
        return toPage(
          rows,
          limit,
          (row) => ({ value: row.targetDate, id: row.contentId }),
          toSummary,
        );
      } catch (error) {
        throw toDbError(error);
      }
    },

    getSet(contentId) {
      // 教材と内容の状態を、同じ時点の値で読む。
      const { detail, state } = inReadTransaction(db, () => {
        const found = findEnglishSetDetail(db, contentId);
        return {
          detail: found,
          state: found === null ? null : findContentState(db, contentId),
        };
      });
      if (detail === null || state === null) throw notFound();
      return {
        contentId: detail.contentId,
        learningTheme: detail.learningTheme,
        targetDate: detail.targetDate,
        lessonMd: detail.lessonBodyMd,
        problems: JSON.parse(detail.problemsJson) as unknown[],
        closingMd: detail.closingMd,
        reading:
          detail.readingJson === null
            ? null
            : (JSON.parse(detail.readingJson) as unknown),
        state: toState(state),
        lastAnswer:
          detail.answer === null
            ? null
            : {
                contentId: detail.contentId,
                grades: JSON.parse(detail.answer.answersJson) as EnglishGrade[],
                completedAt: detail.answer.completedAt,
              },
      };
    },

    putAnswer(contentId, grades) {
      const completedAt = formatDateTime(clock.now());
      inWriteTransaction(db, () => {
        const problemsJson = findEnglishProblemsJson(db, contentId);
        if (problemsJson === null) throw notFound();
        if (!gradesMatchProblems(grades, problemNumbers(problemsJson))) {
          throw new NexusError(
            "RULE_VIOLATION",
            "○△× の無い問題か、セットに無い問題番号がある",
            { msg: "MSG-005" },
          );
        }
        upsertEnglishAnswerRow(
          db,
          contentId,
          JSON.stringify(grades),
          completedAt,
        );
        // 3章 P04 で既読にする。もう既読なら変えない。
        setContentRead(db, contentId, true, completedAt);
      });
      return { contentId, grades, completedAt };
    },
  };
}
