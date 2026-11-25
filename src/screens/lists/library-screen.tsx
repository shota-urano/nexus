"use client";

import { fetchSaved } from "../../client/contents";
import type { ContentSummary } from "../../contracts/contents";
import { ContentList, type LoadPage } from "./content-list";
import { LIST_MESSAGES } from "./messages";

// SCR-009 Library（DD-01 M05。BD-03 SCR-009、BD-02 FN-019）。保存した内容を、保存した日時の
// 新しい順に出す。行には保存した日を出す。

const loadSaved: LoadPage = (cursor, signal) => fetchSaved({ cursor, signal });
// `listSaved` の内容は全て保存してあるので、保存した日時がある。
const savedAt = (item: ContentSummary) => item.savedAt ?? item.receivedAt;

export function LibraryScreen() {
  return (
    <ContentList
      load={loadSaved}
      emptyMessage={LIST_MESSAGES["MSG-010"]}
      dateOf={savedAt}
    />
  );
}
