// 日時の形（DD-02 3章 P09、DD-03 1章）。日本時間で、時差を付けた文字にする。
// 日本は夏時間が無いので、TZ の設定に頼らず、9 時間を足して作る。

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const pad = (value: number, width = 2) => String(value).padStart(width, "0");

// `YYYY-MM-DDTHH:MM:SS.sss+09:00`
export function formatDateTime(at: Date): string {
  const jst = new Date(at.getTime() + JST_OFFSET_MS);
  return (
    `${formatDate(at)}T${pad(jst.getUTCHours())}:${pad(jst.getUTCMinutes())}` +
    `:${pad(jst.getUTCSeconds())}.${pad(jst.getUTCMilliseconds(), 3)}+09:00`
  );
}

// 日本時間の日付 `YYYY-MM-DD`（BD-01 6章。「今日」は日本時間で数える）。
export function formatDate(at: Date): string {
  const jst = new Date(at.getTime() + JST_OFFSET_MS);
  return `${pad(jst.getUTCFullYear(), 4)}-${pad(jst.getUTCMonth() + 1)}-${pad(jst.getUTCDate())}`;
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

// 2つの日付（`YYYY-MM-DD`）の間の日数（to − from）。日付として読めなければ null。
export function daysBetween(from: string, to: string): number | null {
  const a = dateToDayNumber(from);
  const b = dateToDayNumber(to);
  return a === null || b === null ? null : b - a;
}

function dateToDayNumber(date: string): number | null {
  const match = DATE_PATTERN.exec(date);
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  const time = Date.UTC(year, month - 1, day);
  // 2月30日のような、存在しない日付を断る。
  if (new Date(time).getUTCDate() !== day) return null;
  return time / DAY_MS;
}
