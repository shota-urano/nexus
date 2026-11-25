// MSG の一覧（BD-09 1章）。文言は BD-09 を正とし、ここに写す。
// 1.1 は本人が画面で読むもの、1.2 は本人がログ、コマンドの出力、配信元の報告で読むもの。

export type MessageKind = "info" | "warning" | "error" | "confirm";

export const MESSAGES = {
  "MSG-001": { kind: "info", text: "{日付} の記事はありません。" },
  "MSG-002": { kind: "error", text: "記事が見つかりません。" },
  "MSG-003": {
    kind: "error",
    text: "{操作}できませんでした。もう一度押してください。",
  },
  "MSG-004": { kind: "info", text: "英語の教材はまだ届いていません。" },
  "MSG-005": {
    kind: "error",
    text: "○△× が付いていない問題があります。全ての問題に付けてから完了してください。",
  },
  "MSG-006": {
    kind: "confirm",
    text: "前の答えを、今回の答えで置き換えます。置き換えますか。",
  },
  "MSG-007": {
    kind: "error",
    text: "答えを残せませんでした。答えはこの画面に残っています。もう一度「完了」を押してください。",
  },
  "MSG-008": { kind: "info", text: "新着も未読もありません。" },
  "MSG-009": {
    kind: "info",
    text: "「{検索の言葉}」に当たる内容はありません。",
  },
  "MSG-010": { kind: "info", text: "保存した内容はありません。" },
  "MSG-011": {
    kind: "info",
    text: "質問の対象が見つからないため、対象の無い会話として開きました。",
  },
  "MSG-012": {
    kind: "error",
    text: "応答を作れませんでした。送り直すか、やめるかを選んでください。",
  },
  "MSG-013": {
    kind: "error",
    text: "今は AI に質問できません。質問は残してあります。後で送り直してください。",
  },
  "MSG-014": { kind: "info", text: "応答を止めました。" },
  "MSG-015": { kind: "warning", text: "今朝のニュースがまだ届いていません。" },
  "MSG-016": {
    kind: "warning",
    text: "今朝の英語の教材がまだ届いていません。",
  },
  "MSG-017": {
    kind: "warning",
    text: "この24時間に失敗した AI の実行があります。",
  },
  "MSG-018": {
    kind: "error",
    text: "NEXUS につながりません。Tailscale につながっているかを確かめてください。",
  },
  "MSG-019": {
    kind: "error",
    text: "内容を読み込めませんでした。もう一度開いてください。",
  },
  "MSG-020": {
    kind: "error",
    text: "この端末は NEXUS に登録されていません。Mac mini で登録の URL を出し、この端末で開いてください。",
  },
  "MSG-021": {
    kind: "error",
    text: "この登録の URL は使えません。Mac mini で新しい登録の URL を出してください。",
  },
  "MSG-031": {
    kind: "info",
    text: "{配信元} から {件数} 件を受け取りました。",
  },
  "MSG-032": { kind: "error", text: "鍵が正しくないため、受け取れません。" },
  "MSG-033": {
    kind: "error",
    text: "{項目} の形が正しくないため、受け取れません。",
  },
  "MSG-034": {
    kind: "error",
    text: "大きさが上限を超えているため、受け取れません。",
  },
  "MSG-035": { kind: "info", text: "{日付} の答えはまだありません。" },
  "MSG-036": { kind: "error", text: "{日付} の英語のセットはありません。" },
  "MSG-037": {
    kind: "error",
    text: "記事の関係を判定できませんでした（{理由}）。記事は関係をつながずに残しました。",
  },
  "MSG-038": { kind: "info", text: "バックアップを取りました（{置き場所}）。" },
  "MSG-039": {
    kind: "error",
    text: "バックアップを取れませんでした（{理由}）。別のディスクがつながっているかを確かめてください。",
  },
  "MSG-040": {
    kind: "info",
    text: "1年を過ぎた AI の実行の記録を {件数1} 件、受け取りの記録を {件数2} 件消しました。",
  },
  "MSG-041": { kind: "error", text: "古い記録を消せませんでした（{理由}）。" },
  "MSG-042": {
    kind: "error",
    text: "「{端末の名前}」という端末は登録されていません。",
  },
  "MSG-043": {
    kind: "error",
    text: "「{端末の名前}」という端末はもう登録されています。先に取り消してください。",
  },
  "MSG-044": {
    kind: "error",
    text: "「{配信元}」という配信元はありません。使える配信元は {配信元の一覧} です。",
  },
  "MSG-045": {
    kind: "error",
    text: "記事を残せませんでした（{理由}）。この送信の記事は1件も残していません。送り直してください。",
  },
} as const satisfies Record<string, { kind: MessageKind; text: string }>;

export type MessageId = keyof typeof MESSAGES;

export type MessageValues = Readonly<Record<string, string | number>>;

const PLACEHOLDER = /\{([^{}]+)\}/g;

// MSG を引き、`{差し込む値}` を埋めた文言を返す。値が足りなければ例外にする（文言を欠けたまま出さない）。
export function formatMessage(
  id: MessageId,
  values: MessageValues = {},
): string {
  return MESSAGES[id].text.replace(PLACEHOLDER, (_, name: string) => {
    if (!Object.hasOwn(values, name)) {
      throw new Error(`${id} の差し込む値 ${name} が無い`);
    }
    return String(values[name]);
  });
}
