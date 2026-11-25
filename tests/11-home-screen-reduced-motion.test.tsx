// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Home } from "../src/contracts/home";
import { HomeScreen } from "../src/screens/home/home-screen";
import { MotionSettings } from "../src/ui/motion";

// 11-home の実装単位2。ホームの画面 M02 の、動きを減らす設定（NFR-008、BD-09 5章）。
// 受け入れ基準 DD-10 TC114。Motion は端末の設定を最初に読んだときに覚えるので、
// 動きを減らさないときのテスト（11-home-screen.test.tsx）とファイルを分ける。

const HOME: Home = {
  newCount: 3,
  unreadCount: 5,
  learning: { contentId: 7, learningTheme: "文型", isCompleted: false },
  ai: { writingCount: 0, hasFailure: false },
  picks: [],
  notices: [],
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeAll(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      // Motion は "(prefers-reduced-motion)" で問い合わせる。
      matches:
        query.includes("prefers-reduced-motion") &&
        !query.includes("no-preference"),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      onchange: null,
      dispatchEvent: () => false,
    })),
  );
  fetchMock = vi.fn(async () => Response.json(HOME));
  vi.stubGlobal("fetch", fetchMock);
});

afterAll(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("TC114 動きを減らす設定で HUD のセグメントを押す", () => {
  it("回転の動きをせず、選んだ機能に切り替わる", async () => {
    render(
      <MotionSettings>
        <HomeScreen />
      </MotionSettings>,
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await screen.findByRole("link", { name: "文型" });

    const ring = screen.getByTestId("hud-ring");
    expect(ring.getAttribute("transform")).toBe("rotate(0 0 0)");
    expect(
      screen.getByRole("button", { name: "News Galaxy" }).ariaPressed,
    ).toBe("true");
    expect(screen.getByRole("link", { name: /News Galaxy/ })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "English" }));

    // 押した直後（時間を進めずに）、回した後の角度で描かれている。動きの途中の角度を経ない。
    expect(screen.getByTestId("hud-ring").getAttribute("transform")).toBe(
      "rotate(-60 0 0)",
    );
    // 選んだ機能が光り、そのカードが前に出て、押すとその画面へ移る。
    expect(screen.getByRole("button", { name: "English" }).ariaPressed).toBe(
      "true",
    );
    expect(
      screen.getByRole("button", { name: "News Galaxy" }).ariaPressed,
    ).toBe("false");
    expect(
      screen.getByRole("link", { name: /^English/ }).getAttribute("href"),
    ).toBe("/english");
    expect(screen.queryByRole("link", { name: /News Galaxy/ })).toBeNull();

    // カードも動かさずに、置いた後の位置で描かれている。
    const front = screen.getByTestId("card-english");
    expect(front.dataset.front).toBe("true");
    expect(front.style.transform).toBe(
      "translateY(-70px) rotate(-4deg) scale(1)",
    );
    expect(front.style.opacity).toBe("1");

    // 離れたセグメント（AI Chat）を押しても、近い向き（English の -60 度から +120 度）の角度にすぐ切り替わる。
    fireEvent.click(screen.getByRole("button", { name: "AI Chat" }));
    expect(screen.getByTestId("hud-ring").getAttribute("transform")).toBe(
      "rotate(60 0 0)",
    );
    expect(screen.getByTestId("card-chat").dataset.front).toBe("true");
  });

  it("前のカードを押すと、移る動きをせずに、道のとおりすぐ移る（SCR-001-A03）", () => {
    fireEvent.click(screen.getByRole("button", { name: "English" }));
    const english = screen.getByRole("link", { name: /^English/ });
    // 道（Link）のとおりに移る（押した動きを止めない）。光、カードの移動、広がる動きを出さない。
    expect(fireEvent.click(english)).toBe(true);
    expect(
      screen.getByRole("button", { name: "English" }).dataset.flashing,
    ).toBeUndefined();
    expect(screen.getByTestId("card-english").dataset.leaving).toBeUndefined();
    expect(screen.queryByTestId("home-leave-expand")).toBeNull();
  });
});
