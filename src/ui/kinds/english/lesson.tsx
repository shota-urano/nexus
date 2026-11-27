import type { Reading } from "../../../contracts/english";
import { ReceivedText } from "../../received-text";
import { EnglishReading, type ReadingSelection } from "./reading";

// 英語の教材の段の表示部品（DD-01 M08。BD-03 SCR-005-O03、O04、BD-02 FN-009）。
// 教材の本文の後に、読む教材を続けて置く（RD-03 R07、Q-033 の答え）。
// 読む教材があるときは、本文の「## 読む」の節を出さない（DD-02 FN-009 手順 5。BD-13 P07）。
// sharpen は読む教材を出せない cerebellum のために同じ英文を本文にも入れているので、2回出さないため。
// 読む教材が無い日は、その節を出す。

// 「## 読む」で始まる行から、次の「## 」で始まる行の前まで（無ければ終わりまで）を除く。
export function lessonWithoutReadingSection(lessonMd: string): string {
  const kept: string[] = [];
  let skipping = false;
  for (const line of lessonMd.split("\n")) {
    if (line.startsWith("## ")) skipping = line.startsWith("## 読む");
    if (!skipping) kept.push(line);
  }
  return kept.join("\n");
}

export function EnglishMaterial({
  lessonMd,
  reading,
  onSelect,
}: {
  lessonMd: string;
  reading: Reading | null;
  /** 読む教材で選んでいる箇所が替わったとき（SCR-005-A09 の対象） */
  onSelect?: (selection: ReadingSelection | null) => void;
}) {
  return (
    <div>
      <section aria-label="教材の本文">
        <ReceivedText
          markdown={
            reading === null ? lessonMd : lessonWithoutReadingSection(lessonMd)
          }
        />
      </section>
      {reading !== null && (
        <EnglishReading reading={reading} onSelect={onSelect} />
      )}
    </div>
  );
}
