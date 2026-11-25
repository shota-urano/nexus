// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AppFrame,
  SERVICE_WORKER_URL,
  useFullNotice,
} from "../src/app/(screens)/_frame/app-frame";
import { FULL_NOTICE_MESSAGES } from "../src/app/(screens)/_frame/full-notice-messages";
import { TopBar } from "../src/app/(screens)/_frame/top-bar";
import { MESSAGES } from "../src/server/shared/messages";

// DD-10 TC116: 全面の知らせ（BD-09 1.1 MSG-020・MSG-021）を M01 の枠で確かめる。

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
  vi.unstubAllGlobals();
});

const MSG_020 = MESSAGES["MSG-020"].text;
const MSG_021 = MESSAGES["MSG-021"].text;

// 端末の API を呼ぶ画面の見本。401（DD-04 3.4。MSG-020）を受けたら全面の知らせを出す。
function ScreenCallingApi() {
  const showFullNotice = useFullNotice();
  useEffect(() => {
    void fetch("/api/app/home").then(async (response) => {
      if (response.status !== 401) return;
      const body = (await response.json()) as {
        error: { messageId: string };
      };
      if (body.error.messageId === "MSG-020") showFullNotice("MSG-020");
    });
  }, [showFullNotice]);
  return <p>画面の中身</p>;
}

describe("TC116 全面の知らせ（MSG-020、MSG-021）", () => {
  it("`/?notice=MSG-021` を開くと、MSG-021 が全面の知らせで出て、画面の中身は出ない", () => {
    window.history.replaceState(null, "", "/?notice=MSG-021");
    render(
      <AppFrame>
        <p>画面の中身</p>
      </AppFrame>,
    );
    expect(screen.getByRole("alert").textContent).toBe(MSG_021);
    expect(screen.queryByText("画面の中身")).toBeNull();
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
      <AppFrame>
        <ScreenCallingApi />
      </AppFrame>,
    );
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe(MSG_020),
    );
    expect(screen.queryByText("画面の中身")).toBeNull();
  });

  it("`notice` が無いか全面の知らせの MSG でなければ、知らせを出さずに画面の中身を出す", () => {
    for (const search of ["", "?notice=MSG-019", "?notice=toString"]) {
      window.history.replaceState(null, "", `/${search}`);
      render(
        <AppFrame>
          <p>画面の中身</p>
        </AppFrame>,
      );
      expect(screen.queryByRole("alert"), search).toBeNull();
      expect(screen.getByText("画面の中身"), search).toBeTruthy();
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
