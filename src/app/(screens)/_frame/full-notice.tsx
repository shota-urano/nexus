import {
  FULL_NOTICE_MESSAGES,
  type FullNoticeId,
} from "./full-notice-messages";

// 全面の知らせ（BD-09 2章）。画面全体に出し、ほかの操作を出さない。
export function FullNotice({ messageId }: { messageId: FullNoticeId }) {
  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <p
        role="alert"
        className="max-w-md text-center text-base leading-relaxed"
      >
        {FULL_NOTICE_MESSAGES[messageId]}
      </p>
    </main>
  );
}
