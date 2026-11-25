import Link from "next/link";
import { formatListDate } from "./list-date";

// 内容の一覧の行（BD-09 6章、DD-01 M07）。種類の印、新着のタグ、見出し、日付を出す。
// 未読の印は `isUnread` のときだけ出す（Inbox で新着と別の印で出す。BD-03 SCR-007-O04）。
// 種類は名前と色の印で出す（BD-09 3章、BD-03 SCR-007-O01）。色は種類ごとに1つで、
// この部品は決めずに画面か種類ごとの表示部品（M08）から `kindColor` で受け取る。
// 日付は一覧によって届いた日か保存した日で、時刻は出さない（BD-09 5章 表示書式）。
// 押すと内容を開く（行き先は画面が `href` で渡す。ニュースは SCR-003、英語は SCR-005）。
// 押す場所は 44 ピクセル四方以上にする（RD-11 NFR-008）。
export function ContentListRow({
  href,
  kindLabel,
  kindColor,
  isNew,
  isUnread = false,
  title,
  date,
  thisYear,
}: {
  href: string;
  kindLabel: string;
  /** 種類の色の印に使う CSS の色 */
  kindColor: string;
  isNew: boolean;
  /** 未読の印を出すか。省くと出さない */
  isUnread?: boolean;
  title: string;
  /** 日本時間の日付 `YYYY-MM-DD` */
  date: string;
  /** 今年（日本時間）。日付の書式を決める */
  thisYear: number;
}) {
  return (
    <li>
      <Link href={href} className="flex min-h-11 items-center gap-3 px-4 py-2">
        <span className="inline-flex shrink-0 items-center gap-1.5 text-xs">
          <span
            data-testid="kind-mark"
            aria-hidden="true"
            className="size-2.5 rounded-full"
            style={{ backgroundColor: kindColor }}
          />
          {kindLabel}
        </span>
        <span className="min-w-0 flex-1 truncate">{title}</span>
        {isNew && (
          <span className="shrink-0 rounded-full px-2 text-xs font-semibold">
            新着
          </span>
        )}
        {isUnread && <span className="shrink-0 text-xs">未読</span>}
        <span className="shrink-0 text-sm">
          {formatListDate(date, thisYear)}
        </span>
      </Link>
    </li>
  );
}
