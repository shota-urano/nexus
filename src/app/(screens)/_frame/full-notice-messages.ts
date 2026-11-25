// 全面の知らせで出す MSG（BD-09 1.1、2章）。文言は BD-09 を正とし、ここに写す。
// 画面層はサーバの側の MSG の一覧（M23）を読み込まない（DD-01 1.1）ので、文言をここに持つ。
// M23 の文言と同じであることはテストで確かめる。

export const FULL_NOTICE_MESSAGES = {
  "MSG-020":
    "この端末は NEXUS に登録されていません。Mac mini で登録の URL を出し、この端末で開いてください。",
  "MSG-021":
    "この登録の URL は使えません。Mac mini で新しい登録の URL を出してください。",
} as const;

export type FullNoticeId = keyof typeof FULL_NOTICE_MESSAGES;

export function isFullNoticeId(value: unknown): value is FullNoticeId {
  return (
    typeof value === "string" && Object.hasOwn(FULL_NOTICE_MESSAGES, value)
  );
}
