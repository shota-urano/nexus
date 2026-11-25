import { FullNotice } from "./_frame/full-notice";
import { isFullNoticeId } from "./_frame/full-notice-messages";

// ホーム（SCR-001）の道 `/`（DD-01 M01）。ホームの中身（M02）は 11-home で作る。
// 登録の URL が使えないとき、Web サーバは `/?notice=MSG-021` へ移す
// （DD-04 `openRegistration`、DD-06 E03）。`notice` が全面の知らせの MSG なら、
// 画面の中身の代わりに全面の知らせを出す（BD-09 1.1）。サーバで描くので、
// スクリプトが動く前から知らせが出る。
export default async function HomeRoute({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { notice } = await searchParams;
  if (isFullNoticeId(notice)) return <FullNotice messageId={notice} />;
  return null;
}
