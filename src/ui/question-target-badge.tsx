// 質問の対象の印（BD-09 6章、BD-03 SCR-006-O01、DD-01 M07）。AI チャットの上に、
// 何を対象にしているか（ページ、記事、語句と文、図のノード）と、見出しか語句を出す。
// 種類は API の QuestionTarget の kind に合わせる。

export type QuestionTargetKind = "page" | "article" | "phrase" | "node";

export const QUESTION_TARGET_KIND_LABELS: Record<QuestionTargetKind, string> = {
  page: "ページ",
  article: "記事",
  phrase: "語句と文",
  node: "図のノード",
};

export function QuestionTargetBadge({
  kind,
  label,
}: {
  kind: QuestionTargetKind;
  /** 対象の内容の見出しか、選んだ語句 */
  label: string;
}) {
  return (
    <p className="flex min-w-0 items-center gap-2 px-4 py-2 text-sm">
      <span className="shrink-0 rounded border px-1.5 text-xs">
        {QUESTION_TARGET_KIND_LABELS[kind]}
      </span>
      <span className="min-w-0 truncate">{label}</span>
    </p>
  );
}
