// 一覧の日付の書式（BD-09 5章 表示書式）。時刻は出さない。
// 今年なら「11月23日（月）」、今年でなければ「2025年11月23日」。
// 日付は日本時間の `YYYY-MM-DD`（API の Date）で受け取る。

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function formatListDate(date: string, thisYear: number): string {
  const match = DATE_PATTERN.exec(date);
  if (!match) return date;
  const [year, month, day] = match.slice(1).map(Number);
  if (year !== thisYear) return `${year}年${month}月${day}日`;
  const weekday =
    WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  return `${month}月${day}日（${weekday}）`;
}
