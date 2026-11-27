"use client";

import {
  type KeyboardEvent,
  type MouseEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import type {
  Reading,
  ReadingNote,
  ReadingSentence,
} from "../../../contracts/english";

// 読む教材の表示部品（DD-01 M08。BD-03 SCR-005-O04、O05、A02、BD-13 P07）。
// - 題、場面、段落の英文を出す。
// - 注のある語句を種類（今日の規則、単語、熟語、文法）ごとに色分けし、凡例と「印を隠す」を置く。
// - 注を押すと、その注の種類と説明を語句の近くに重ねて出す。AI もサーバも呼ばない（FN-009 手順 3）。
// - 文の注の無い所を押すと、その文の和訳を下に出す。
// - 開いている注の語句か和訳を出している文を、選んでいる箇所として `onSelect` で知らせる
//   （SCR-005-A09 の対象。BD-03）。どちらも閉じたときと、この部品が消えるときは null を知らせる。

// 選んでいる箇所。注の語句を選んだときは `phrase` に語句を入れ、文を選んだときは入れない。
export type ReadingSelection = {
  phrase?: string;
  sentence: string;
  paragraphIndex: number;
  sentenceIndex: number;
};

// 注の種類の名前と色（sharpen の read.html と同じ見せ方。画面の試作 `prototype/` に合わせる）。
const NOTE_KINDS: Record<string, { label: string; color: string }> = {
  today: { label: "今日の規則", color: "#c4a5ff" },
  word: { label: "単語", color: "#7aa7ff" },
  phrase: { label: "熟語", color: "#5fd3a2" },
  grammar: { label: "文法", color: "#ff9a62" },
};

// 知らない種類は、届いた値を名前にし、色を付けない。
export function noteKindLabel(kind: string): string {
  return Object.hasOwn(NOTE_KINDS, kind) ? NOTE_KINDS[kind].label : kind;
}

function noteKindColor(kind: string): string | undefined {
  return Object.hasOwn(NOTE_KINDS, kind) ? NOTE_KINDS[kind].color : undefined;
}

type Part = string | ReadingNote;

// 英文を、注の語句と、それ以外の文字に分ける。語句は注の順に、まだ分けていない文字の中で
// 初めに現れる所に当てる。見つからない注は印を付けない。
export function splitSentence(sentence: ReadingSentence): Part[] {
  let parts: Part[] = [sentence.en];
  for (const note of sentence.notes) {
    if (note.text === "") continue;
    let placed = false;
    parts = parts.flatMap((part) => {
      if (placed || typeof part !== "string") return [part];
      const index = part.indexOf(note.text);
      if (index < 0) return [part];
      placed = true;
      return [
        part.slice(0, index),
        note,
        part.slice(index + note.text.length),
      ].filter((piece) => piece !== "");
    });
  }
  return parts;
}

// 押せる文字（キーボードでは Enter と空白で押す）。
function pressable(onPress: () => void) {
  return {
    role: "button" as const,
    tabIndex: 0,
    onClick: (event: MouseEvent) => {
      event.stopPropagation();
      onPress();
    },
    onKeyDown: (event: KeyboardEvent) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      event.stopPropagation();
      onPress();
    },
  };
}

export function EnglishReading({
  reading,
  onSelect,
}: {
  reading: Reading;
  /** 選んでいる箇所が替わったとき。選んでいなければ null */
  onSelect?: (selection: ReadingSelection | null) => void;
}) {
  const [plain, setPlain] = useState(false);
  // 開いている注（段落、文、注の番号）と、和訳を出している文（段落、文の番号）。
  const [openNote, setOpenNote] = useState<string | null>(null);
  const [openSentence, setOpenSentence] = useState<string | null>(null);
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);
  // 部品が消える（教材の段を離れる）ときは、選んでいる箇所も無くなる。
  useEffect(() => () => onSelectRef.current?.(null), []);

  return (
    <section aria-label="読む教材" className="mt-6 border-t pt-4">
      <h2 className="text-lg font-bold">{reading.title}</h2>
      <div className="my-3 rounded-lg border px-3 py-2 text-sm">
        <p className="text-xs font-semibold">場面</p>
        <p>{reading.scene}</p>
      </div>
      <p className="text-sm">
        色の付いた語を押すと意味が出ます。文のそれ以外の所を押すと、その文の和訳が出ます。
      </p>
      <div className="my-3 flex flex-wrap items-center gap-3 text-sm">
        <ul aria-label="凡例" className="flex flex-wrap gap-3">
          {Object.entries(NOTE_KINDS).map(([kind, { label, color }]) => (
            <li
              key={kind}
              style={{ color, borderBottom: `2px solid ${color}` }}
            >
              {label}
            </li>
          ))}
        </ul>
        <label className="ml-auto inline-flex min-h-11 items-center gap-2">
          <input
            type="checkbox"
            checked={plain}
            onChange={(event) => setPlain(event.target.checked)}
          />
          印を隠す
        </label>
      </div>
      <div className="text-lg leading-loose">
        {reading.paragraphs.map((paragraph, p) => {
          const shown = paragraph.sentences.findIndex(
            (_sentence, s) => openSentence === `${p}-${s}`,
          );
          return (
            <div key={p}>
              <p className="my-2">
                {paragraph.sentences.map((sentence, s) => {
                  const sentenceKey = `${p}-${s}`;
                  return (
                    <span
                      key={s}
                      data-sentence={sentenceKey}
                      className={
                        openSentence === sentenceKey
                          ? "rounded bg-yellow-200/30"
                          : "rounded"
                      }
                      {...pressable(() => {
                        const next =
                          openSentence === sentenceKey ? null : sentenceKey;
                        setOpenNote(null);
                        setOpenSentence(next);
                        onSelect?.(
                          next === null
                            ? null
                            : {
                                sentence: sentence.en,
                                paragraphIndex: p,
                                sentenceIndex: s,
                              },
                        );
                      })}
                    >
                      {splitSentence(sentence).map((part, n) => {
                        if (typeof part === "string") {
                          return <span key={n}>{part}</span>;
                        }
                        const noteKey = `${sentenceKey}-${n}`;
                        const color = plain
                          ? undefined
                          : noteKindColor(part.kind);
                        return (
                          <span key={n} className="relative">
                            <span
                              data-note-kind={part.kind}
                              style={
                                color === undefined
                                  ? undefined
                                  : {
                                      color,
                                      borderBottom: `2px dotted ${color}`,
                                    }
                              }
                              {...pressable(() => {
                                const next =
                                  openNote === noteKey ? null : noteKey;
                                setOpenSentence(null);
                                setOpenNote(next);
                                onSelect?.(
                                  next === null
                                    ? null
                                    : {
                                        phrase: part.text,
                                        sentence: sentence.en,
                                        paragraphIndex: p,
                                        sentenceIndex: s,
                                      },
                                );
                              })}
                            >
                              {part.text}
                            </span>
                            {openNote === noteKey && (
                              <span
                                role="tooltip"
                                className="absolute top-full left-0 z-10 mt-1 block w-max max-w-[min(320px,86vw)] rounded-lg border bg-white px-3 py-2 text-sm leading-normal text-black shadow-lg"
                              >
                                <b className="block">
                                  {noteKindLabel(part.kind)}
                                </b>
                                {part.ja}
                              </span>
                            )}
                          </span>
                        );
                      })}{" "}
                    </span>
                  );
                })}
              </p>
              {shown >= 0 && (
                <p role="note" className="my-2 rounded-lg border px-3 py-2">
                  <span className="block text-xs">和訳</span>
                  {paragraph.sentences[shown].ja}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
