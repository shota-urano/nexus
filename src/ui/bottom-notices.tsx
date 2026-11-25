"use client";

import { AnimatePresence, motion } from "motion/react";

// 下の知らせ（BD-09 2章、6章、DD-01 M07）。画面の下に重ねて出す。
// - 自動では消さない。エラーは、本人が閉じるか、同じ操作をやり直して成功するまで残す。
//   消すのは画面が `notices` から外すか、本人が「閉じる」を押したとき（`onClose`）。
// - 同じ時に2つ出たら、新しい方を上に重ねる。`notices` は古い順に渡す。
// - 押す場所は 44 ピクセル四方以上にする（RD-11 NFR-008）。

export type BottomNotice = {
  id: string;
  kind: "info" | "error";
  text: string;
};

export function BottomNotices({
  notices,
  onClose,
}: {
  notices: readonly BottomNotice[];
  onClose: (id: string) => void;
}) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex flex-col-reverse gap-2 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <AnimatePresence initial={false}>
        {notices.map((notice) => (
          <motion.div
            key={notice.id}
            role={notice.kind === "error" ? "alert" : "status"}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            className="pointer-events-auto mx-auto flex w-full max-w-md items-center gap-2 rounded-xl border bg-white py-1 pl-4 pr-1 text-sm text-black shadow-lg"
          >
            <p className="flex-1 leading-relaxed">{notice.text}</p>
            <button
              type="button"
              onClick={() => onClose(notice.id)}
              className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center px-2"
            >
              閉じる
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
