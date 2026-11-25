"use client";

import { fetchInbox } from "../../client/contents";
import type { ContentSummary } from "../../contracts/contents";
import { ContentList, type LoadPage } from "./content-list";
import { LIST_MESSAGES } from "./messages";

// SCR-007 Inbox（DD-01 M05。BD-03 SCR-007、BD-02 FN-017）。新着と未読を、種類をまたいで
// 届いた日時の新しい順に出す。行には届いた日と、新着のタグと未読の印を出す。

const loadInbox: LoadPage = (cursor, signal) => fetchInbox({ cursor, signal });
const receivedAt = (item: ContentSummary) => item.receivedAt;

export function InboxScreen() {
  return (
    <ContentList
      load={loadInbox}
      emptyMessage={LIST_MESSAGES["MSG-008"]}
      dateOf={receivedAt}
      showNewAndUnread
    />
  );
}
