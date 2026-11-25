"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useId, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

// 確認の面（BD-09 2章、6章、DD-01 M07）。画面の中央に重ねて出し、選ぶまで後ろを操作させない。
// 使うのは MSG-006（完了した教材をやり直して前の答えを置き換えるとき）だけ（BD-09 5章）。
// 文言とボタンの名前は画面が渡す（BD-09 4章 「置き換える」「やめる」）。
// 押す場所は 44 ピクセル四方以上にする（RD-11 NFR-008）。
//
// 後ろを操作させないために、面は body の直下に出し、開いている間は
// body のほかの子に `inert` を付ける。あわせて、面の外へ移った操作は面の中へ戻し、
// 面の外で起きた押す操作は画面の処理に届く前に止める（`inert` を守らない環境のため）。
const BLOCKED_EVENTS = ["click", "pointerdown", "mousedown", "touchstart"];

const subscribeNothing = () => () => {};

export function ConfirmPanel({
  open,
  message,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const messageId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  // サーバで描くときは body が無いので、端末に来てから body の直下へ出す。
  const onClient = useSyncExternalStore(
    subscribeNothing,
    () => true,
    () => false,
  );

  // サーバで描いた面を端末で引き継ぐときは、初回の effect では面がまだ無い。
  // onClient が true になって面が出た後に、もう一度ここを通して後ろを止める。
  useEffect(() => {
    const host = overlayRef.current;
    if (!open || !host) return;
    const others = Array.from(document.body.children).filter(
      (element) => element !== host && !element.hasAttribute("inert"),
    );
    for (const element of others) element.setAttribute("inert", "");

    const isOutside = (target: EventTarget | null) =>
      !(target instanceof Node && host.contains(target));
    const keepFocusInside = (event: FocusEvent) => {
      if (isOutside(event.target)) cancelRef.current?.focus();
    };
    const blockOutside = (event: Event) => {
      if (!isOutside(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
    };
    document.addEventListener("focusin", keepFocusInside);
    for (const type of BLOCKED_EVENTS) {
      document.addEventListener(type, blockOutside, true);
    }

    // 開いたら面の中へ操作を移す。誤って置き換えないよう、やめる方に置く。
    cancelRef.current?.focus();

    return () => {
      for (const element of others) element.removeAttribute("inert");
      document.removeEventListener("focusin", keepFocusInside);
      for (const type of BLOCKED_EVENTS) {
        document.removeEventListener(type, blockOutside, true);
      }
    };
  }, [open, onClient]);

  if (!onClient) return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="confirm"
          ref={overlayRef}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6"
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-describedby={messageId}
            className="w-full max-w-sm rounded-2xl bg-white p-5 text-black shadow-xl"
          >
            <p id={messageId} className="leading-relaxed">
              {message}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                ref={cancelRef}
                type="button"
                onClick={onCancel}
                className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg px-4"
              >
                {cancelLabel}
              </button>
              <button
                type="button"
                onClick={onConfirm}
                className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg px-4 font-semibold"
              >
                {confirmLabel}
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
