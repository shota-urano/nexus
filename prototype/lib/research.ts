// Q-095 の試作の作り物のデータ（CR-020）。週報の形は brain-harness の依頼書（handoff-nexus.md）と BD-06 IF-005 に合わせた。
// 中身は作り物で、本当の調査の結果ではない。出典の URL は example.com にしている。
export type Mark = "added" | "more_sources" | "disputed";

export type Approach = {
  title: string;
  howToMd: string;
  sourceUrls: string[];
  marks: Mark[];
  counterMd: string | null;
};

export type Report = {
  contentId: number;
  topicId: string;
  topicTitle: string;
  week: number;
  sentOn: string;
  status: "active" | "ended";
  answerMd: string;
  approaches: Approach[];
  unknownsMd: string;
  changesMd: string;
  isRead: boolean;
};

export const MARKS: Record<Mark, { label: string; short: string; color: string; symbol: string }> = {
  added: { label: "今週足した", short: "新", color: "#5fd3a2", symbol: "+" },
  more_sources: { label: "出典が増えた", short: "出典+", color: "#ffb85e", symbol: "↑" },
  disputed: { label: "反対の意見あり", short: "反対", color: "#ff7f8e", symbol: "!" },
};

const src = (n: number, slug: string) => Array.from({ length: n }, (_, i) => `https://example.com/${slug}/${i + 1}`);

export const reports: Report[] = [
  {
    contentId: 102,
    topicId: "second-brain",
    topicTitle: "第二の脳はどうやるのがよいか",
    week: 3,
    sentOn: "2026-11-27",
    status: "active",
    answerMd: "メモは「あとで使う場面」ごとにまとめ、週に1回だけ見直して要らないものを捨てるのがよい。道具より、見直す時間を決めることのほうが効く、という材料が多い。",
    approaches: [
      {
        title: "使う場面ごとにまとめる（プロジェクト・分野・資料・保管の4つに分ける）",
        howToMd: "- 新しいメモは、まず今のプロジェクトのどれに使うかを決めて置く\n- どれにも使わないものは「資料」に置き、半年使わなければ「保管」に移す\n- 分け方を細かくしすぎない（4つより増やさない）",
        sourceUrls: src(6, "para"),
        marks: ["more_sources"],
        counterMd: null,
      },
      {
        title: "週に1回の見直しの時間を先に決める",
        howToMd: "- 曜日と時刻を決め、15〜30分だけ見直す\n- 見直しでは「捨てる」「プロジェクトに移す」「そのまま」の3つだけを決める",
        sourceUrls: src(4, "review"),
        marks: ["added"],
        counterMd: null,
      },
      {
        title: "メモどうしをリンクでつなぎ、つながりから考えを育てる",
        howToMd: "- 1つのメモには1つの考えだけを書く\n- 書いたら、関係のある前のメモを1つ以上リンクする\n- リンクの多いメモを週の見直しで読み返す",
        sourceUrls: src(5, "zettel"),
        marks: ["disputed", "more_sources"],
        counterMd: "リンクを張る手間が大きく、続かなかったという報告が複数ある。メモが少ないうちは効果が見えにくい。",
      },
      {
        title: "AI に要約させてから残す",
        howToMd: "- 読んだものは、残す前に AI に3行で要約させる\n- 要約の下に、自分が使う場面を1行だけ書き足す",
        sourceUrls: src(2, "ai-summary"),
        marks: ["added", "disputed"],
        counterMd: "要約だけを残すと、元の文の細かいところを後で確かめられない。元の URL は必ず残すべき、という意見がある。",
      },
      {
        title: "道具は1つに決め、乗り換えない",
        howToMd: "- 道具を選ぶ時間に上限を決める（1週間など）\n- 決めたら、困ったことが3回起きるまで乗り換えない",
        sourceUrls: src(1, "tool"),
        marks: [],
        counterMd: null,
      },
    ],
    unknownsMd: "- 見直しの頻度を週1より減らしても効果が保てるか、比べた材料がまだ無い\n- 日本語のメモで、AI の要約がどこまで使えるか",
    changesMd: "「週に1回の見直しの時間を先に決める」と「AI に要約させてから残す」を足した。続かなかったという報告が見つかったので、「リンクでつなぐ」に反対の意見を付けた。",
    isRead: false,
  },
  {
    contentId: 101,
    topicId: "second-brain",
    topicTitle: "第二の脳はどうやるのがよいか",
    week: 2,
    sentOn: "2026-11-20",
    status: "active",
    answerMd: "メモは使う場面ごとにまとめるのがよい、という材料が多い。",
    approaches: [],
    unknownsMd: "",
    changesMd: "変化なし",
    isRead: true,
  },
  {
    contentId: 100,
    topicId: "second-brain",
    topicTitle: "第二の脳はどうやるのがよいか",
    week: 1,
    sentOn: "2026-11-13",
    status: "active",
    answerMd: "まだ材料が少ない。",
    approaches: [],
    unknownsMd: "",
    changesMd: "初めての報告。",
    isRead: true,
  },
  {
    contentId: 200,
    topicId: "rag-eval",
    topicTitle: "RAG の答えの良さはどう測るのがよいか",
    week: 4,
    sentOn: "2026-11-22",
    status: "ended",
    answerMd: "質問と正解の組を小さく作り、毎回同じ組で比べるのがよい。",
    approaches: [],
    unknownsMd: "",
    changesMd: "2週続けて新しい方法が出なかったので、この報告で終える。",
    isRead: true,
  },
];

export const topics = [
  { topicId: "second-brain", title: "第二の脳はどうやるのがよいか", status: "active" as const, lastWeek: 3, lastReceivedOn: "2026-11-27", latestContentId: 102, hasUnread: true },
  { topicId: "rag-eval", title: "RAG の答えの良さはどう測るのがよいか", status: "ended" as const, lastWeek: 4, lastReceivedOn: "2026-11-22", latestContentId: 200, hasUnread: false },
];

export const host = (u: string) => new URL(u).host;
