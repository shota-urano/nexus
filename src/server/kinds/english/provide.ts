import type { Database } from "../../db/connection";
import {
  findEnglishAnswerForSenderByDate,
  findEnglishSetForSenderByDate,
} from "../../repositories/english";

// sharpen に返すセットと答え（DD-01 M16。DD-02 FN-013 手順 2、3）。読むだけで、データを変えない。

// セットの原文に `date` と `receivedAt` を足したもの。セットが無ければ null（MSG-036）。
export function readEnglishSetForSender(
  db: Database,
  date: string,
): Record<string, unknown> | null {
  const row = findEnglishSetForSenderByDate(db, date);
  if (row === null) return null;
  const raw = JSON.parse(row.rawPayloadJson) as Record<string, unknown>;
  return { ...raw, date, receivedAt: row.receivedAt };
}

// `openapi.yaml` の `EnglishResultForSender`。
export interface EnglishResultForSender {
  date: string;
  grades: unknown[];
  feeling: "";
  completedAt: string;
}

export type EnglishResultOutcome =
  | { ok: true; result: EnglishResultForSender }
  // 答えがまだ無い（MSG-035）か、セットが無い（MSG-036）。
  | { ok: false; reason: "no_answer" | "no_set" };

export function readEnglishResult(
  db: Database,
  date: string,
): EnglishResultOutcome {
  const row = findEnglishAnswerForSenderByDate(db, date);
  if (row === null) return { ok: false, reason: "no_set" };
  if (row.answer === null) return { ok: false, reason: "no_answer" };
  return {
    ok: true,
    result: {
      date,
      // `answers_json` のまま（置き換えた後のセットに無い問題番号も残す）。
      grades: JSON.parse(row.answer.answersJson) as unknown[],
      feeling: "",
      completedAt: row.answer.completedAt,
    },
  };
}

// 入口（M11）に渡す、DB の接続を閉じ込めた読み取り（入口層は DB を読み込まない。DD-01 1.2）。
export interface EnglishForSender {
  readSet(date: string): Record<string, unknown> | null;
  readResult(date: string): EnglishResultOutcome;
}

export function createEnglishForSender(deps: {
  db: Database;
}): EnglishForSender {
  const { db } = deps;
  return {
    readSet: (date) => readEnglishSetForSender(db, date),
    readResult: (date) => readEnglishResult(db, date),
  };
}
