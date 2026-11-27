// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { HomeScreen } from "../src/screens/home/home-screen";
import { MotionSettings } from "../src/ui/motion";
import type { HomeWithResearch } from "./fixtures/home";

// 11-home の実装単位2。ホームの画面 M02 の、動きを減らす設定（NFR-008、BD-09 5章）。
// 受け入れ基準 DD-10 TC114。Motion は端末の設定を最初に読んだときに覚えるので、
// 動きを減らさないときのテスト（11-home-screen.test.tsx）とファイルを分ける。

const HOME: HomeWithResearch = {
  newCount: 3,
  unreadCount: 5,
  learning: { contentId: 7, learningTheme: "文型", isCompleted: false },
  ai: { writingCount: 0, hasFailure: false },
  picks: [],
  notices: [],
  research: { unreadCount: 0 },
};

// HUD は7つのセグメント（14-research の実装単位5。CR-020。Q-095 の答えで7分割は試作のまま）。
// 1つのセグメントの角度は 360 / 7 度。
const STEP = 360 / 7;

// HUD の輪の回した角度（transform の rotate(角度 0 0)）を読む。
function ringDegrees(): number {
  const transform = screen.getByTestId("hud-ring").getAttribute("transform");
  const match = /^rotate\((-?[\d.e+-]+) 0 0\)$/.exec(transform ?? "");
  if (match === null) throw new Error(`角度が読めない: ${transform}`);
  return Number(match[1]);
}

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
    expect(ringDegrees()).toBeCloseTo(-STEP, 2);
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

    // 離れたセグメント（AI Chat）を押しても、近い向き（English の -STEP 度から +2 × STEP 度）の角度にすぐ切り替わる。
    fireEvent.click(screen.getByRole("button", { name: "AI Chat" }));
    expect(ringDegrees()).toBeCloseTo(STEP, 2);
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
