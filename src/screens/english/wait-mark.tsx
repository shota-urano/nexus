// 読み込み中の待つ印（BD-03 SCR-004 3.5）。
export function WaitMark() {
  return (
    <div role="status" className="flex justify-center px-4 py-6">
      <span className="sr-only">読み込み中</span>
      <span
        aria-hidden="true"
        className="size-6 rounded-full border-2 border-current border-t-transparent motion-safe:animate-spin"
      />
    </div>
  );
}
