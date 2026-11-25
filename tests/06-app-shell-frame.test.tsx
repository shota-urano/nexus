// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AppFrame,
  SERVICE_WORKER_URL,
  useDeviceApi,
} from "../src/app/(screens)/_frame/app-frame";
import { FULL_NOTICE_MESSAGES } from "../src/app/(screens)/_frame/full-notice-messages";
import { TopBar } from "../src/app/(screens)/_frame/top-bar";
import ScreensLayout from "../src/app/(screens)/layout";
import HomeRoute from "../src/app/(screens)/page";
import { MESSAGES } from "../src/server/shared/messages";

// DD-10 TC116: 全面の知らせ（BD-09 1.1 MSG-020・MSG-021）を M01 の枠で確かめる。
// 道 `/` は、Next.js が src/app/(screens)/layout.tsx と src/app/(screens)/page.tsx を
// 組み合わせて描く。ここでも同じ2つを同じ組み合わせで描く。

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const MSG_020 = MESSAGES["MSG-020"].text;
const MSG_021 = MESSAGES["MSG-021"].text;

// 道 `/` を開いたときに Next.js が描くものを、同じ layout と page から描く。
async function renderHomeRoute(
  searchParams: Record<string, string | undefined>,
) {
  const page = await HomeRoute({ searchParams: Promise.resolve(searchParams) });
  return render(<ScreensLayout>{page}</ScreensLayout>);
}

// 端末の API を呼ぶ画面の代わり。機能ごとの画面（07〜11）はこの実装単位の範囲の外なので、
// 画面が使う `useDeviceApi()` で `/api/app/` を呼ぶだけのものを置く。
function ScreenCallingApi() {
  const deviceApi = useDeviceApi();
  useEffect(() => {
    void deviceApi("/api/app/home");
  }, [deviceApi]);
  return <p>画面の中身</p>;
}

describe("TC116 全面の知らせ（MSG-020、MSG-021）", () => {
  it("`/?notice=MSG-021` を開くと、道 `/` の layout と page で MSG-021 が全面の知らせで出る", async () => {
    await renderHomeRoute({ notice: "MSG-021" });
    expect(screen.getByRole("alert").textContent).toBe(MSG_021);
  });

  it("API が 401 を返す画面を開くと、MSG-020 が全面の知らせで出て、画面の中身は消える", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          {
            error: {
              code: "unauthorized",
              message: MSG_020,
              messageId: "MSG-020",
            },
          },
          { status: 401 },
        ),
      ),
    );
    render(
      <ScreensLayout>
        <ScreenCallingApi />
      </ScreensLayout>,
    );
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe(MSG_020),
    );
    expect(screen.queryByText("画面の中身")).toBeNull();
  });

  it("API が 401 でない応答を返すときは、知らせを出さずに画面の中身を出す", async () => {
    const fetchMock = vi.fn(async () => Response.json({}, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(
      <ScreensLayout>
        <ScreenCallingApi />
      </ScreensLayout>,
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("画面の中身")).toBeTruthy();
  });

  it("`notice` が無いか全面の知らせの MSG でなければ、道 `/` は知らせを出さない", async () => {
    for (const searchParams of [
      {},
      { notice: "MSG-019" },
      { notice: "toString" },
    ]) {
      await renderHomeRoute(searchParams);
      expect(
        screen.queryByRole("alert"),
        JSON.stringify(searchParams),
      ).toBeNull();
      cleanup();
    }
  });

  it("全面の知らせの文言は MSG の一覧（BD-09 1.1）と同じ", () => {
    expect(FULL_NOTICE_MESSAGES["MSG-020"]).toBe(MSG_020);
    expect(FULL_NOTICE_MESSAGES["MSG-021"]).toBe(MSG_021);
  });
});

describe("M01 の枠", () => {
  it("service worker を `/sw.js` で登録する", async () => {
    const register = vi.fn(async () => ({}));
    Object.defineProperty(navigator, "serviceWorker", {
      value: { register },
      configurable: true,
    });
    try {
      render(
        <AppFrame>
          <p>画面の中身</p>
        </AppFrame>,
      );
      await waitFor(() =>
        expect(register).toHaveBeenCalledWith(SERVICE_WORKER_URL),
      );
      expect(SERVICE_WORKER_URL).toBe("/sw.js");
    } finally {
      Reflect.deleteProperty(navigator, "serviceWorker");
    }
  });

  it("上の帯に、ホームへ戻る操作と画面名と、渡した入口を出す", () => {
    render(<TopBar title="Inbox" action={<button type="button">AI</button>} />);
    const home = screen.getByRole("link", { name: "ホーム" });
    expect(home.getAttribute("href")).toBe("/");
    expect(screen.getByRole("heading", { name: "Inbox" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "AI" })).toBeTruthy();
  });
});
