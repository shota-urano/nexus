import type { GalaxyNode } from "../../../contracts/news";
import { formatListDate } from "../../list-date";

// ニュースの記事のカード（DD-01 M08。BD-03 SCR-002-O01）。図のノードの中身として、
// 記事の画像（無ければ代わりの印）と見出しを出す。既読の記事は薄く出す。
// 選んだ日でない記事（関係の先の過去の記事）には、その日付を添える。
// 画像は端末が記事のサイトから直に読む（RD-12 T12）。
export function NewsNodeCard({
  node,
  isCenter,
  date,
  thisYear,
}: {
  node: GalaxyNode;
  /** 中心の記事か */
  isCenter: boolean;
  /** 図で選んでいる日（日本時間の `YYYY-MM-DD`） */
  date: string;
  /** 今年（日本時間）。日付の書式を決める */
  thisYear: number;
}) {
  return (
    <div
      data-testid="news-node"
      data-content-id={node.contentId}
      data-center={isCenter}
      data-read={node.isRead}
      className={`w-28 rounded-lg border p-1.5 text-[10px] leading-snug text-[#f1ece4] ${
        isCenter
          ? "border-[#ffb040] bg-[#1b2230] shadow-[0_0_18px_#ffb04066]"
          : "border-[#ffb04040] bg-[#141923]"
      } ${node.isRead ? "opacity-50" : ""}`}
    >
      {node.imageUrl === null ? (
        <div
          aria-hidden="true"
          className="flex aspect-[16/10] w-full items-center justify-center rounded-md bg-[#0b0f17]"
        >
          <span className="size-3 rounded-full bg-[#ffb040] shadow-[0_0_10px_#ffb040]" />
        </div>
      ) : (
        // 画像は記事のサイトにあり、Next.js の画像の最適化を通さない（RD-12 T12）。
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={node.imageUrl}
          alt=""
          referrerPolicy="no-referrer"
          className="block aspect-[16/10] w-full rounded-md object-cover"
        />
      )}
      <p className="mt-1 line-clamp-3">{node.title}</p>
      {node.targetDate !== date && (
        <p className="mt-0.5 text-[#a8a196]">
          {formatListDate(node.targetDate, thisYear)}
        </p>
      )}
    </div>
  );
}
