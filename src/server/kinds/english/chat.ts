import type { Database } from "../../db/connection";
import { findChatEnglishSet } from "../../repositories/english";
import { ENGLISH_KIND } from "./ingest";

// AI チャットに渡す内容の組み立てのうち、英語に固有の処理（DD-01 M16。DD-02 3章 P07 手順 3、
// BD-02 FN-015 業務ルール）。学習テーマと、対象の種類が `phrase` なら対象の文とその文の注と語句、
// `page`（ほか）なら教材の本文と読む教材の英文と和訳を、読む材料の文にする。
// M14 の種類の一覧を読み込まず、同じ形の操作を公開する（DD-01 M14。輪を作らないため）。

// 質問の対象（`question_target_json`。BD-07 4.1）のうち、ここで使う項目。
export interface EnglishChatTarget {
  kind: string;
  phrase?: string;
  sentence?: string;
  position?: {
    part?: string;
    paragraphIndex?: number;
    sentenceIndex?: number;
  };
}

interface ReadingNote {
  text: string;
  kind: string;
  ja: string;
}

interface ReadingSentence {
  en: string;
  ja: string;
  notes: ReadingNote[];
}

interface Reading {
  paragraphs: { sentences: ReadingSentence[] }[];
}

function parseReading(json: string | null): Reading | null {
  if (json === null) return null;
  const value = JSON.parse(json) as unknown;
  if (typeof value !== "object" || value === null) return null;
  return value as Reading;
}

// 位置が指す読む教材の文。読む教材の文でなければ null。
function sentenceAt(
  reading: Reading | null,
  target: EnglishChatTarget,
): ReadingSentence | null {
  const position = target.position;
  if (reading === null || position?.part !== "reading") return null;
  const { paragraphIndex, sentenceIndex } = position;
  if (paragraphIndex === undefined || sentenceIndex === undefined) return null;
  return reading.paragraphs[paragraphIndex]?.sentences[sentenceIndex] ?? null;
}

// 対象の内容の読む材料を組み立てる。セットが無ければ null。
export function buildEnglishAnswerMaterial(
  db: Database,
  contentId: number,
  target: EnglishChatTarget,
): string | null {
  const set = findChatEnglishSet(db, contentId);
  if (set === null) return null;
  const reading = parseReading(set.readingJson);
  const lines = ["種類: 英語の教材", `学習テーマ: ${set.learningTheme}`];
  if (target.kind === "phrase") {
    const sentence = sentenceAt(reading, target);
    const notes = sentence?.notes ?? [];
    lines.push(
      `対象の文: ${target.sentence ?? ""}`,
      `対象の語句: ${target.phrase ?? ""}`,
      "その文の注:",
      ...(notes.length === 0
        ? ["（無い）"]
        : notes.map((note) => `- ${note.text}（${note.kind}）: ${note.ja}`)),
    );
    return lines.join("\n");
  }
  lines.push("教材の本文:", set.lessonBodyMd);
  if (reading !== null) {
    lines.push("", "読む教材（英文と和訳）:");
    for (const paragraph of reading.paragraphs) {
      for (const sentence of paragraph.sentences) {
        lines.push(`- ${sentence.en}`, `  ${sentence.ja}`);
      }
    }
  }
  return lines.join("\n");
}

export const englishChat = {
  kind: ENGLISH_KIND,
  buildAnswerMaterial: (
    db: Database,
    contentId: number,
    target: EnglishChatTarget,
  ) => buildEnglishAnswerMaterial(db, contentId, target),
};
