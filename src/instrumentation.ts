// Next.js がサーバを起動したときに1回だけ呼び、終わるまで要求を受け付けない（Next.js の instrumentation）。
// Web サーバの起動の処理（マイグレーションを当てる。DD-03 5章）を動かす。
// DB を使うので Node.js の実行環境のときだけ読み込む。
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startWebServer } = await import("./app/api/_entry/web-startup");
  startWebServer();
}
