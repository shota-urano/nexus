import Link from "next/link";
import { formatListDate } from "./list-date";

// 内容の一覧の行（BD-09 6章、DD-01 M07）。種類の印、新着のタグ、見出し、日付を出す。
// 日付は一覧によって届いた日か保存した日で、時刻は出さない（BD-09 5章 表示書式）。
// 押すと内容を開く（行き先は画面が `href` で渡す。ニュースは SCR-003、英語は SCR-005）。
// 押す場所は 44 ピクセル四方以上にする（RD-11 NFR-008）。
export function ContentListRow({
  href,
  kindLabel,
  isNew,
  title,
  date,
  thisYear,
}: {
  href: string;
  kindLabel: string;
  isNew: boolean;
  title: string;
  /** 日本時間の日付 `YYYY-MM-DD` */
  date: string;
  /** 今年（日本時間）。日付の書式を決める */
  thisYear: number;
}) {
  return (
    <li>
      <Link href={href} className="flex min-h-11 items-center gap-3 px-4 py-2">
        <span className="shrink-0 rounded border px-1.5 text-xs">
          {kindLabel}
        </span>
        <span className="min-w-0 flex-1 truncate">{title}</span>
        {isNew && (
          <span className="shrink-0 rounded-full px-2 text-xs font-semibold">
            新着
          </span>
        )}
        <span className="shrink-0 text-sm">
          {formatListDate(date, thisYear)}
        </span>
      </Link>
    </li>
  );
}
