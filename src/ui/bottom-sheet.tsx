"use client";

import {
  AnimatePresence,
  motion,
  type PanInfo,
  useDragControls,
} from "motion/react";
import { type ReactNode, useState } from "react";

// 下から出る面（BD-09 5章、6章、DD-01 M07）。本文に重ねて下から出し、引き上げると
// 全画面に広がり、下げるか閉じると戻る。SCR-003（記事の案内）と SCR-006（AI チャット）が使う。
// iPad でも下から出る面にする（BD-09 5章）。
// - 指で引けるのは上の帯だけにする（中身のスクロールと取り合わないため）。
//   引き上げと引き下げは、取っ手のボタンでもできる（指で引けないときの代わり）。
// - 動きを減らす設定のときは、M07 の MotionSettings が動きを止める（NFR-008）。
// - 押す場所は 44 ピクセル四方以上にする（RD-11 NFR-008）。
// - 中身のスクロールは端に着いても後ろの画面へ伝えない（overscroll-behavior: contain）。
// - tone="hud" は、BD-13 の試作の面（暗い土台、アンバーの枠と光）の色にする。色は Tailwind の設定の値を使う。

type SheetTone = "plain" | "hud";

const TONE_CLASSES: Record<
  SheetTone,
  { surface: string; handle: string; header: string; closeButton: string }
> = {
  plain: {
    surface: "bg-white text-black shadow-2xl",
    handle: "bg-gray-300",
    header: "px-2",
    closeButton: "px-2",
  },
  hud: {
    surface:
      "border-t border-hud-line bg-hud-panel text-hud-text shadow-2xl shadow-hud-amber/10 backdrop-blur-md",
    handle: "bg-hud-muted",
    // 試作の .topbar（上下 10px、左右 12px、下の線、暗い背景）に合わせる。
    header: "border-b border-hud-line bg-hud-bar px-3 py-2.5",
    // 試作の button（アンバーの枠、角の丸み 10px、左右 12px）に合わせる。
    closeButton: "rounded-hud border border-hud-line px-3",
  },
};

// 指で引いたときに、広げるか戻すかを決める距離（ピクセル）。
const DRAG_THRESHOLD = 80;

export function BottomSheet({
  open,
  title,
  onClose,
  children,
  tone = "plain",
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** 面の色の組（省くと plain） */
  tone?: SheetTone;
}) {
  // 面の中身は開いている間だけ置く。閉じたら、次に開くときは広げる前の高さから出す。
  return (
    <AnimatePresence>
      {open && (
        <SheetPanel key="sheet" title={title} onClose={onClose} tone={tone}>
          {children}
        </SheetPanel>
      )}
    </AnimatePresence>
  );
}

function SheetPanel({
  title,
  onClose,
  children,
  tone,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  tone: SheetTone;
}) {
  const colors = TONE_CLASSES[tone];
  const [expanded, setExpanded] = useState(false);
  const dragControls = useDragControls();

  function handleDragEnd(_: unknown, info: PanInfo) {
    if (info.offset.y < -DRAG_THRESHOLD) {
      setExpanded(true);
    } else if (info.offset.y > DRAG_THRESHOLD) {
      if (expanded) setExpanded(false);
      else onClose();
    }
  }

  return (
    <motion.section
      role="dialog"
      aria-label={title}
      data-expanded={expanded}
      initial={{ y: "100%" }}
      animate={{ y: 0, height: expanded ? "100dvh" : "60dvh" }}
      exit={{ y: "100%" }}
      transition={{ type: "spring", damping: 30, stiffness: 300 }}
      drag="y"
      dragControls={dragControls}
      dragListener={false}
      dragConstraints={{ top: 0, bottom: 0 }}
      dragElastic={0.2}
      onDragEnd={handleDragEnd}
      className={`fixed inset-x-0 bottom-0 z-30 flex flex-col ${colors.surface} ${
        expanded ? "" : "rounded-t-2xl"
      }`}
    >
      <header
        onPointerDown={(event) => dragControls.start(event)}
        className={`flex touch-none items-center gap-2 ${colors.header}`}
      >
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-label={expanded ? "面を戻す" : "面を広げる"}
          className="inline-flex min-h-11 min-w-11 items-center justify-center"
        >
          <span className={`block h-1.5 w-10 rounded-full ${colors.handle}`} />
        </button>
        <h2 className="flex-1 truncate text-base font-semibold">{title}</h2>
        <button
          type="button"
          onClick={onClose}
          className={`inline-flex min-h-11 min-w-11 items-center justify-center ${colors.closeButton}`}
        >
          閉じる
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {children}
      </div>
    </motion.section>
  );
}
