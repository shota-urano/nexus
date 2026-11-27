// 週報の画面（SCR-010、SCR-011）で出す MSG（BD-09 1.1、2章）。文言は BD-09 を正とし、ここに写す。
// 画面層はサーバの側の MSG の一覧（M23）を読み込まない（DD-01 1.1）ので、文言をここに持つ。

export const RESEARCH_MESSAGES = {
  "MSG-003": "{操作}できませんでした。もう一度押してください。",
  "MSG-019": "内容を読み込めませんでした。もう一度開いてください。",
  "MSG-047": "調査の週報はまだ届いていません。",
  "MSG-048": "週報が見つかりません。",
} as const;

// MSG-003 の操作の名前（BD-09 1.1）。押した操作の名前を差し込む。
export type StateOperation = "保存" | "保存を外す" | "既読に" | "未読に戻す";

// MSG-003 に操作の名前を差し込む。置換関数で渡し、$& などを置換の記号として読ませない。
export function stateFailedMessage(operation: StateOperation): string {
  return RESEARCH_MESSAGES["MSG-003"].replace("{操作}", () => operation);
}
