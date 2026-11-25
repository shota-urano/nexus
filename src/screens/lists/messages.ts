// 一覧の画面（SCR-007〜SCR-009）で出す MSG（BD-09 1.1、2章）。文言は BD-09 を正とし、ここに写す。
// 画面層はサーバの側の MSG の一覧（M23）を読み込まない（DD-01 1.1）ので、文言をここに持つ。
// M23 の文言と同じであることはテストで確かめる。

export const LIST_MESSAGES = {
  "MSG-008": "新着も未読もありません。",
  "MSG-009": "「{検索の言葉}」に当たる内容はありません。",
  "MSG-010": "保存した内容はありません。",
  "MSG-019": "内容を読み込めませんでした。もう一度開いてください。",
} as const;

// MSG-009 に検索の言葉を差し込む。
export function noSearchResultMessage(term: string): string {
  return LIST_MESSAGES["MSG-009"].replace("{検索の言葉}", term);
}
