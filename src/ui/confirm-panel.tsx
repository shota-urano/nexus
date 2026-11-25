"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useId, useRef } from "react";

// 確認の面（BD-09 2章、6章、DD-01 M07）。画面の中央に重ねて出し、選ぶまで後ろを操作させない。
// 使うのは MSG-006（完了した教材をやり直して前の答えを置き換えるとき）だけ（BD-09 5章）。
// 文言とボタンの名前は画面が渡す（BD-09 4章 「置き換える」「やめる」）。
// 押す場所は 44 ピクセル四方以上にする（RD-11 NFR-008）。
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

  // 開いたら面の中へ操作を移す。誤って置き換えないよう、やめる方に置く。
  useEffect(() => {
    if (open) cancelRef.current?.focus();
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="confirm"
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
    </AnimatePresence>
  );
}
