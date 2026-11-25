// News Galaxy（SCR-002）と記事の案内（SCR-003）で出す MSG（BD-09 1.1、2章）。文言は BD-09 を正とし、
// ここに写す。画面層はサーバの側の MSG の一覧（M23）を読み込まない（DD-01 1.1）ので、文言をここに持つ。
// M23 の文言と同じであることはテストで確かめる。

export const NEWS_MESSAGES = {
  "MSG-001": "{日付} の記事はありません。",
  "MSG-002": "記事が見つかりません。",
  "MSG-003": "{操作}できませんでした。もう一度押してください。",
  "MSG-019": "内容を読み込めませんでした。もう一度開いてください。",
} as const;

// MSG-003 の操作の名前（BD-09 1.1）。押した操作の名前を差し込む。
export type StateOperation = "保存" | "保存を外す" | "既読に" | "未読に戻す";

// MSG-001 に日付（画面に出す書式の日付）を差し込む。置換関数で渡し、$& などを置換の記号として読ませない。
export function noArticleMessage(date: string): string {
  return NEWS_MESSAGES["MSG-001"].replace("{日付}", () => date);
}

// MSG-003 に操作の名前を差し込む。
export function stateFailedMessage(operation: StateOperation): string {
  return NEWS_MESSAGES["MSG-003"].replace("{操作}", () => operation);
}
