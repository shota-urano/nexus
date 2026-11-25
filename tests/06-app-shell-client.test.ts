import { afterEach, describe, expect, it, vi } from "vitest";
import { deviceFetch, onDeviceUnauthorized } from "../src/client/device-api";

// 通信層 M09 の端末の API の呼び出し（DD-01 1.1）。401（MSG-020）を登録した届け先に渡す。

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("M09 deviceFetch", () => {
  it("401 を受けたら届け先に渡し、応答はそのまま返す", async () => {
    const unauthorized = new Response(null, { status: 401 });
    const fetchMock = vi.fn(async () => unauthorized);
    vi.stubGlobal("fetch", fetchMock);
    const listener = vi.fn();
    const off = onDeviceUnauthorized(listener);
    try {
      const init = { method: "POST" };
      const response = await deviceFetch("/api/app/home", init);
      expect(response).toBe(unauthorized);
      expect(fetchMock).toHaveBeenCalledWith("/api/app/home", init);
      expect(listener).toHaveBeenCalledTimes(1);
    } finally {
      off();
    }
  });

  it("401 でない応答では届け先に渡さない", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 403 })),
    );
    const listener = vi.fn();
    const off = onDeviceUnauthorized(listener);
    try {
      await deviceFetch("/api/app/home");
      expect(listener).not.toHaveBeenCalled();
    } finally {
      off();
    }
  });

  it("登録を外した届け先には渡さない", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 401 })),
    );
    const listener = vi.fn();
    onDeviceUnauthorized(listener)();
    await deviceFetch("/api/app/home");
    expect(listener).not.toHaveBeenCalled();
  });
});
