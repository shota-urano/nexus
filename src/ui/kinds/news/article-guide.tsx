import type { ReactNode } from "react";
import type { ArticleDetail } from "../../../contracts/news";
import { formatListDate } from "../../list-date";
import { ReceivedText } from "../../received-text";
import { RELATION_TYPE_LABELS } from "./relation-type";

// 記事の案内（DD-01 M08。BD-03 SCR-003 の 3.2、3.3）。画像、テーマと届いた日時、見出し、案内、
// 元の記事を開く操作、既読と保存の操作（画面が `actions` で渡す）、関係のある記事を出す。
// - 画像が無ければ出さない（SCR-003-O01）。
// - 届いた日時は BD-09 5章の日付と時刻で出す（SCR-003-O03）。
// - 案内は届いた文の表示（M07）で出す（SCR-003-O05）。
// - 元の記事は端末のブラウザで開く（SCR-003-A07。NEXUS は何もしない）。
// - 関係のある記事は、関係の種類の名前、見出し、根拠（AI の判定として）を出す（SCR-003-O06）。
//   無いときは欄を出さない（SCR-003 の 3.5）。押すと `onSelectRelated` を呼ぶ（SCR-003-A06）。
// - 押す場所は 44 ピクセル四方以上にする（RD-11 NFR-008）。

// 日本時間の日時（`YYYY-MM-DDTHH:MM:SS.sss+09:00`）を「11月23日（月） 05:30」の形にする。
export function formatDateTime(dateTime: string, thisYear: number): string {
  return `${formatListDate(dateTime.slice(0, 10), thisYear)} ${dateTime.slice(11, 16)}`;
}

export function ArticleGuide({
  article,
  thisYear,
  actions,
  onSelectRelated,
}: {
  article: ArticleDetail;
  /** 今年（日本時間）。日付の書式を決める */
  thisYear: number;
  /** 既読と保存の操作（画面が置く） */
  actions: ReactNode;
  onSelectRelated: (contentId: number) => void;
}) {
  return (
    <article className="flex flex-col gap-3 px-4 pb-6">
      {article.imageUrl !== null && (
        // 画像は記事のサイトから直に読む（RD-12 T12）。
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={article.imageUrl}
          alt=""
          referrerPolicy="no-referrer"
          className="h-32 w-full rounded-xl object-cover"
        />
      )}
      <p className="text-xs text-gray-600">
        {article.theme} ・ {formatDateTime(article.receivedAt, thisYear)}
      </p>
      <h3 className="text-lg font-bold leading-snug">{article.title}</h3>
      <ReceivedText markdown={article.guideMd} />
      <a
        href={article.sourceUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex min-h-11 items-center self-start underline underline-offset-2"
      >
        元の記事を開く
      </a>
      <div className="flex flex-wrap gap-2">{actions}</div>
      {article.related.length > 0 && (
        <section aria-label="関係のある記事">
          <h4 className="mt-2 text-sm font-semibold">関係のある記事</h4>
          <ul>
            {article.related.map((related) => (
              <li
                key={`${related.direction}-${related.node.contentId}-${related.relationType}`}
              >
                <button
                  type="button"
                  onClick={() => onSelectRelated(related.node.contentId)}
                  className="flex min-h-11 w-full items-start gap-2 py-2 text-left"
                >
                  <span className="shrink-0 rounded-full border px-2 text-xs">
                    {RELATION_TYPE_LABELS[related.relationType]}
                  </span>
                  <span className="min-w-0 flex-1 text-sm">
                    {related.node.title}
                    <span className="block text-xs text-gray-600">
                      AI の判定: {related.reason}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}
