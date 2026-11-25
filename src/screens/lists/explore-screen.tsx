"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";
import { fetchSearch } from "../../client/contents";
import type { ContentSummary } from "../../contracts/contents";
import { ContentList, type LoadPage } from "./content-list";
import { noSearchResultMessage } from "./messages";

// SCR-008 Explore（DD-01 M05。BD-03 SCR-008、BD-02 FN-018）。言葉で内容を探し、
// 当たった内容を届いた日時の新しい順に出す。行には届いた日を出す。
// - 言葉が空（空白だけを含む）のときは「探す」を押せなくする（SCR-008-I01）。
// - 言葉は 200 文字まで（BD-10 4章。Q-079 の答え）。文字は Unicode の符号位置で数える。
// - 探し直すと前の検索を止め、最後の検索だけを出す（SCR-008-A02）。
// - 探した言葉は画面を離れて戻ったときに残し、その結果を読む（BD-09 5章、SCR-008-A01）。
//   残す場所は端末のブラウザのタブ（sessionStorage）。使えなければ残さない。

export const SEARCH_TERM_MAX_LENGTH = 200;
const LAST_TERM_KEY = "nexus.explore.lastTerm";

const receivedAt = (item: ContentSummary) => item.receivedAt;

function readLastTerm(): string {
  try {
    return window.sessionStorage.getItem(LAST_TERM_KEY) ?? "";
  } catch {
    // 使えないブラウザでは、前の言葉を残さない。
    return "";
  }
}

function writeLastTerm(term: string): void {
  try {
    window.sessionStorage.setItem(LAST_TERM_KEY, term);
  } catch {
    // 使えないブラウザでは、前の言葉を残さない。
    return;
  }
}

function limitLength(text: string): string {
  const chars = [...text];
  return chars.length > SEARCH_TERM_MAX_LENGTH
    ? chars.slice(0, SEARCH_TERM_MAX_LENGTH).join("")
    : text;
}

interface Search {
  term: string;
  /** 同じ言葉で探し直したときも一覧を作り直すための番号 */
  id: number;
}

export function ExploreScreen() {
  const [input, setInput] = useState("");
  const [search, setSearch] = useState<Search | null>(null);

  // 前に探した言葉があれば、欄に戻してその結果を読む（SCR-008-A01）。
  // サーバで描いた画面と合わせるため、読み込んだ後に戻す。
  useEffect(() => {
    const last = limitLength(readLastTerm().trim());
    if (last === "") return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- ブラウザにだけある値を描いた後に戻す
    setInput(last);
    setSearch({ term: last, id: 0 });
  }, []);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const term = input.trim();
    if (term === "") return;
    writeLastTerm(term);
    setSearch((previous) => ({ term, id: (previous?.id ?? 0) + 1 }));
  };

  const term = search?.term ?? null;
  const load = useCallback<LoadPage>(
    (cursor, signal) => fetchSearch(term ?? "", { cursor, signal }),
    [term],
  );

  return (
    <>
      <form role="search" onSubmit={onSubmit} className="flex gap-2 px-4 py-2">
        <input
          type="search"
          aria-label="検索の言葉"
          value={input}
          onChange={(event) => setInput(limitLength(event.target.value))}
          className="min-h-11 min-w-0 flex-1 rounded-md border px-3 text-base"
        />
        <button
          type="submit"
          disabled={input.trim() === ""}
          className="min-h-11 min-w-11 rounded-md px-4 disabled:opacity-40"
        >
          探す
        </button>
      </form>
      {search !== null && (
        <ContentList
          key={search.id}
          load={load}
          emptyMessage={noSearchResultMessage(search.term)}
          dateOf={receivedAt}
        />
      )}
    </>
  );
}
