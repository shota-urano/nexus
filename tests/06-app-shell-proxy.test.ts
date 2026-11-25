import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { config, proxy } from "../src/proxy";

// DD-10 TC104: 応答の欄（DD-09 2.4、BD-10 T05）。proxy をプロセスの中で呼んで確かめる。

const ORIGIN = "http://localhost:48401";

function nonceOf(csp: string | null): string {
  const match =
    /script-src 'self' 'nonce-([A-Za-z0-9+/=]+)' 'strict-dynamic'/.exec(
      csp ?? "",
    );
  expect(match, csp ?? "CSP が無い").not.toBeNull();
  return match![1];
}

const EXPECTED_CSP = (nonce: string) =>
  [
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

describe("TC104 応答の欄（DD-09 2.4）", () => {
  it("画面の道の応答に、nonce の付いた CSP と X-Content-Type-Options が付く", () => {
    for (const path of ["/", "/news", "/register?code=x"]) {
      const response = proxy(new NextRequest(`${ORIGIN}${path}`));
      const csp = response.headers.get("Content-Security-Policy");
      const nonce = nonceOf(csp);
      expect(csp, path).toBe(EXPECTED_CSP(nonce));
      expect(response.headers.get("X-Content-Type-Options"), path).toBe(
        "nosniff",
      );
      expect(response.headers.get("Referrer-Policy"), path).toBe("no-referrer");
      // 画面の応答は API ではないので、no-store を付けない。
      expect(response.headers.get("Cache-Control"), path).toBeNull();
      // Next.js が nonce を読む要求の CSP の欄にも、同じ値を渡す。
      expect(
        response.headers.get("x-middleware-request-content-security-policy"),
        path,
      ).toBe(csp);
    }
  });

  it("nonce は要求ごとに違う", () => {
    const nonces = new Set(
      Array.from({ length: 20 }, () =>
        nonceOf(
          proxy(new NextRequest(`${ORIGIN}/`)).headers.get(
            "Content-Security-Policy",
          ),
        ),
      ),
    );
    expect(nonces.size).toBe(20);
    for (const nonce of nonces) {
      // 128 ビットの乱数を base64 で書いたもの。
      expect(Buffer.from(nonce, "base64")).toHaveLength(16);
    }
  });

  it("API の応答に Cache-Control: no-store と X-Content-Type-Options が付く", () => {
    for (const path of ["/api/app/home", "/api/ingest/news"]) {
      const response = proxy(new NextRequest(`${ORIGIN}${path}`));
      expect(response.headers.get("Cache-Control"), path).toBe("no-store");
      expect(response.headers.get("X-Content-Type-Options"), path).toBe(
        "nosniff",
      );
    }
  });

  it("proxy は `/_next/static/` と `/_next/image` 以外の全ての道で動く", () => {
    const [source] = config.matcher;
    const pattern = new RegExp(`^${source}$`);
    for (const path of ["/", "/news", "/api/app/home", "/register", "/sw.js"]) {
      expect(pattern.test(path), path).toBe(true);
    }
    for (const path of ["/_next/static/chunks/app.js", "/_next/image"]) {
      expect(pattern.test(path), path).toBe(false);
    }
  });
});
