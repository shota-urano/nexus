import { type NextRequest, NextResponse } from "next/server";

// 応答の欄を付ける Next.js の proxy（Next.js 16 で middleware から名前が変わった。DD-09 2.4）。
// 要求ごとの乱数（nonce）を作り、CSP と、そのほかの欄を付ける。
// 端末の鍵はここで確かめない（DD-01 3章。各 handler の最初で M12 を呼ぶ）。

// 乱数のバイトの数。128 ビット。
const NONCE_BYTES = 16;

export function createNonce(): string {
  const bytes = new Uint8Array(NONCE_BYTES);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

// DD-09 2.4 の CSP。
export function contentSecurityPolicy(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' https: data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
}

function isApi(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

export function proxy(request: NextRequest): NextResponse {
  const nonce = createNonce();
  const csp = contentSecurityPolicy(nonce);

  // Next.js は要求の CSP の欄から nonce を読み、画面に入れるスクリプトに付ける。
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("Content-Security-Policy", csp);
  requestHeaders.set("x-nonce", nonce);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "no-referrer");
  if (isApi(request.nextUrl.pathname)) {
    // API の応答を途中で保存させない（DD-09 2.4）。
    response.headers.set("Cache-Control", "no-store");
  }
  return response;
}

export const config = {
  // 名前に版の付いた静的なファイルと画像の最適化には付けない。
  matcher: ["/((?!_next/static|_next/image).*)"],
};
