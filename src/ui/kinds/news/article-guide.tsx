import type { ReactNode } from "react";
import type { ArticleDetail } from "../../../contracts/news";
import { formatListDate } from "../../list-date";
import { ReceivedText } from "../../received-text";
import { RELATION_TYPE_LABELS } from "./relation-type";

// 記事の案内（DD-01 M08。BD-03 SCR-003 の 3.2、3.3）。画像、テーマと届いた日時、見出し、案内、
// 元の記事を開く操作、既読と保存の操作（画面が `actions` で渡す）、関係のある記事を出す。
// - 見た目は `references/news-galaxy-reference.png` の下の面に合わせ、暗い面の色（Tailwind の hud の色）で、
//   画像を左、テーマと届いた日時と見出しを右に置く。操作（アイコンのボタン）は右上に置き、
//   幅の狭い画面では記事の情報の幅を確保するため下の行の右に移す。
//   関係のある記事は小さい画像付きの行にする（CR-018）。下から出る面でも全画面でも同じ見た目にする。
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
    <article className="flex flex-col gap-4 px-4 pb-6 pt-3 text-hud-text">
      {/* 画像と記事の情報と操作の並び。幅の狭い画面（640 ピクセル未満）では操作を下の行の右に移し、
          テーマと届いた日時と見出しの幅を確保する。広い画面では操作を右上に置く。 */}
      <div
        className={
          article.imageUrl !== null
            ? "grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-2 sm:grid-cols-[auto_minmax(0,1fr)_auto]"
            : "grid grid-cols-[minmax(0,1fr)] items-start gap-x-3 gap-y-2 sm:grid-cols-[minmax(0,1fr)_auto]"
        }
      >
        {article.imageUrl !== null && (
          // 画像は記事のサイトから直に読む（RD-12 T12）。
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={article.imageUrl}
            alt=""
            referrerPolicy="no-referrer"
            className="aspect-[4/3] w-24 rounded-xl border border-hud-line object-cover sm:w-28"
          />
        )}
        <div className="flex min-w-0 flex-col gap-2">
          <p className="flex flex-wrap items-center gap-y-1 pt-2 text-xs text-hud-muted">
            <span className="inline-flex items-center gap-1 rounded-full border border-hud-line px-2 py-0.5 text-hud-amber">
              <span
                aria-hidden="true"
                className="size-1.5 rounded-full bg-hud-amber"
              />
              {article.theme}
            </span>
            <span>
              {" ・ "}
              {formatDateTime(article.receivedAt, thisYear)}
            </span>
          </p>
          <h3 className="text-lg font-bold leading-snug">{article.title}</h3>
        </div>
        <div
          className={
            article.imageUrl !== null
              ? "col-span-2 flex gap-1 justify-self-end sm:col-span-1 sm:col-start-3 sm:row-start-1"
              : "flex gap-1 justify-self-end sm:col-start-2 sm:row-start-1"
          }
        >
          {actions}
        </div>
      </div>
      <ReceivedText
        markdown={article.guideMd}
        linkClassName="inline-flex min-h-11 min-w-11 items-center justify-center text-hud-amber underline underline-offset-2"
      />
      <a
        href={article.sourceUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex min-h-11 min-w-11 items-center self-start text-hud-amber underline underline-offset-2"
      >
        元の記事を開く
      </a>
      {article.related.length > 0 && (
        <section
          aria-label="関係のある記事"
          className="border-t border-hud-line pt-3"
        >
          <h4 className="text-base font-semibold">関係のある記事</h4>
          <ul className="mt-1 divide-y divide-hud-veil">
            {article.related.map((related) => (
              <li
                key={`${related.direction}-${related.node.contentId}-${related.relationType}`}
              >
                <button
                  type="button"
                  onClick={() => onSelectRelated(related.node.contentId)}
                  className="flex min-h-11 w-full items-center gap-3 py-2 text-left"
                >
                  {related.node.imageUrl === null ? (
                    <span
                      aria-hidden="true"
                      className="flex aspect-[16/10] w-16 shrink-0 items-center justify-center rounded-md bg-hud-field"
                    >
                      <span className="size-2 rounded-full bg-hud-amber" />
                    </span>
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={related.node.imageUrl}
                      alt=""
                      referrerPolicy="no-referrer"
                      className="aspect-[16/10] w-16 shrink-0 rounded-md object-cover"
                    />
                  )}
                  <span className="min-w-0 flex-1 text-sm">
                    <span className="mr-1 inline-block rounded-full border border-hud-line px-2 text-xs text-hud-amber">
                      {RELATION_TYPE_LABELS[related.relationType]}
                    </span>
                    {related.node.title}
                    <span className="block truncate text-xs text-hud-muted">
                      AI の判定: {related.reason}
                    </span>
                  </span>
                  <svg
                    viewBox="0 0 24 24"
                    width={18}
                    height={18}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                    focusable="false"
                    className="shrink-0 text-hud-muted"
                  >
                    <path d="m9 6 6 6-6 6" />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}
