// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { MotionSettings, useReduceMotion } from "../src/ui/motion";

// 動きを減らす設定（NFR-008、BD-09 5章、DD-01 M07）。
// Motion は端末の設定を最初に読んだときに覚えるので、別のファイルで確かめる。

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
});

afterAll(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function Probe() {
  return <p>{useReduceMotion() ? "減らす" : "減らさない"}</p>;
}

describe("動きを減らす設定", () => {
  it("端末が動きを減らす設定なら、M07 がそれを読んで部品に渡す", () => {
    render(
      <MotionSettings>
        <Probe />
      </MotionSettings>,
    );
    expect(screen.getByText("減らす")).toBeTruthy();
  });
});
