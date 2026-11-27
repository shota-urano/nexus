// @vitest-environment jsdom
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import tailwindcss from "@tailwindcss/postcss";
import { cleanup, render, screen, within } from "@testing-library/react";
import postcss, { type Root } from "postcss";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { TopBar } from "../src/app/(screens)/_frame/top-bar";

// 06-app-shell の実装単位7（BD-09 5章、BD-03 SCR-002、DD-01 M01、CR-018）。
// 上の帯（M01 の TopBar）のホームへ戻る操作を NEXUS のロゴ（public/img/home/logo_001.png）にし、
// 上の帯を端末の上端の安全な余白とホームの上の余白（pt-6）の大きいほうだけ下げる。
// 題名の最後の語（「News Galaxy」なら「Galaxy」）をアンバー（Tailwind の設定の値）にする。
// 受け入れ基準:
// - 上の帯に「ホーム」の文字が無く、`/` へのリンクが NEXUS のロゴの画像を持ち、
//   ボタンの名前（aria-label）が「ホーム」である。
// - そのリンクの押す場所が 44 ピクセル四方以上である。
// - 上の帯の上の余白が `max(1.5rem, env(safe-area-inset-top))` である。
// - ページの viewport に `viewport-fit=cover` がある。
// - 題名「News Galaxy」の「Galaxy」が Tailwind の設定のアンバーの色で出る。

// 根の layout は要求ごとに描くため `connection()` を待つ。テストでは待たずに進める。
vi.mock("next/server", () => ({ connection: async () => undefined }));

afterEach(() => {
  cleanup();
});

const ROOT = resolve(__dirname, "..");
const GLOBALS_CSS = join(ROOT, "src/app/globals.css");
const LOGO_PATH = "/img/home/logo_001.png";
// 1rem を 16 ピクセルとして扱う（ブラウザの既定）。
const REM_PX = 16;

// ---- Tailwind の設定と、組み上がった CSS ----

function listFiles(dir: string, pattern: RegExp): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return listFiles(path, pattern);
    return pattern.test(name) ? [path] : [];
  });
}

// Tailwind の設定のファイル（src の CSS の @theme）が決める値。名前 → 値。
function themeValues(): Map<string, string> {
  const values = new Map<string, string>();
  for (const file of listFiles(join(ROOT, "src"), /\.css$/)) {
    const css = readFileSync(file, "utf8");
    for (const block of css.matchAll(/@theme[^{]*\{([\s\S]*?)\}/g)) {
      for (const m of block[1].matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
        values.set(m[1], m[2].trim());
      }
    }
  }
  return values;
}

// 色の書き方をそろえる（#rrggbb、透明度があれば #rrggbbaa）。読めない書き方は小文字のまま返す。
function normalizeColor(value: string): string {
  const v = value.trim().toLowerCase();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])([0-9a-f])?$/.exec(v);
  if (short) {
    const [r, g, b, a] = short.slice(1).map((c) => (c ? c + c : undefined));
    return `#${r}${g}${b}${a && a !== "ff" ? a : ""}`;
  }
  const long = /^#([0-9a-f]{6})([0-9a-f]{2})?$/.exec(v);
  if (long) return `#${long[1]}${long[2] && long[2] !== "ff" ? long[2] : ""}`;
  const rgb = /^rgba?\(\s*([^)]*)\)$/.exec(v);
  if (rgb) {
    const parts = rgb[1].split(/[\s,/]+/).filter(Boolean);
    if (parts.length === 3 || parts.length === 4) {
      const hex = parts
        .slice(0, 3)
        .map((p) => Number(p).toString(16).padStart(2, "0"));
      let alpha = "";
      if (parts[3] !== undefined) {
        const a = parts[3].endsWith("%")
          ? Number(parts[3].slice(0, -1)) / 100
          : Number(parts[3]);
        if (a < 1)
          alpha = Math.round(a * 255)
            .toString(16)
            .padStart(2, "0");
      }
      return `#${hex.join("")}${alpha}`;
    }
  }
  return v;
}

let compiled: Root;
let vars: Map<string, string>;

// Tailwind を通した src/app/globals.css（src の部品が使う class の規則を含む）。
beforeAll(async () => {
  const result = await postcss([tailwindcss({ base: ROOT })]).process(
    readFileSync(GLOBALS_CSS, "utf8"),
    { from: GLOBALS_CSS },
  );
  compiled = result.root;
  vars = new Map(themeValues());
  compiled.walkDecls(/^--/, (decl) => {
    vars.set(decl.prop, decl.value.trim());
  });
}, 60_000);

function resolveVars(value: string, depth = 0): string {
  if (depth > 10) return value;
  const replaced = value.replace(
    /var\(\s*(--[a-z0-9-]+)\s*(?:,\s*([^)]*))?\)/gi,
    (_, name: string, fallback?: string) =>
      vars.get(name) ?? fallback?.trim() ?? "",
  );
  return replaced === value ? value.trim() : resolveVars(replaced, depth + 1);
}

// 長さ（px か rem）をピクセルにする。読めなければ undefined。
function lengthToPx(value: string): number | undefined {
  const m = /^(-?[\d.]+)(px|rem)$/.exec(value.trim());
  if (!m) return undefined;
  return m[2] === "rem" ? Number(m[1]) * REM_PX : Number(m[1]);
}

// `calc(0.25rem * 11)` のような、長さと数の掛け算の calc を、ピクセルの長さに直す。
function simplifyCalc(value: string): string {
  let current = value;
  for (;;) {
    const next = current.replace(
      /calc\(\s*([-\d.]+(?:px|rem)?)\s*\*\s*([-\d.]+(?:px|rem)?)\s*\)/g,
      (whole, a: string, b: string) => {
        const aPx = lengthToPx(a);
        const bPx = lengthToPx(b);
        if (aPx !== undefined && bPx === undefined && !isNaN(Number(b)))
          return `${aPx * Number(b)}px`;
        if (bPx !== undefined && aPx === undefined && !isNaN(Number(a)))
          return `${bPx * Number(a)}px`;
        return whole;
      },
    );
    if (next === current) return current;
    current = next;
  }
}

function unescapeSelector(selector: string): string {
  return selector.replace(/\\(.)/g, "$1");
}

// 要素の class と style が決める CSS の宣言（変数は解いた後）。名前 → 値の並び。
function declarationsOf(el: Element): Map<string, string[]> {
  const result = new Map<string, string[]>();
  const add = (prop: string, value: string) => {
    const list = result.get(prop) ?? [];
    list.push(simplifyCalc(resolveVars(value)));
    result.set(prop, list);
  };
  const classes = new Set(
    (el.getAttribute("class") ?? "")
      .split(/\s+/)
      .filter(Boolean)
      .map((c) => `.${c}`),
  );
  compiled.walkRules((rule) => {
    const selectors = rule.selectors.map((s) => unescapeSelector(s.trim()));
    if (!selectors.some((s) => classes.has(s))) return;
    rule.walkDecls((decl) => {
      add(decl.prop, decl.value);
    });
  });
  const style = (el as HTMLElement).style;
  if (style) {
    for (let i = 0; i < style.length; i += 1) {
      const prop = style.item(i);
      add(prop, style.getPropertyValue(prop));
    }
  }
  return result;
}

// ---- 上の帯 ----

function renderTopBar(title = "News Galaxy") {
  const { container } = render(<TopBar title={title} />);
  const bar = container.firstElementChild;
  if (!bar) throw new Error("上の帯が描かれない");
  return bar as HTMLElement;
}

function homeLink(bar: HTMLElement): HTMLAnchorElement {
  const links = Array.from(bar.querySelectorAll("a")).filter(
    (a) => a.getAttribute("href") === "/",
  );
  expect(links).toHaveLength(1);
  return links[0];
}

// 画像の src が指す元の道（next/image の `/_next/image?url=...` も元の道に戻す）。
function imageSourcePath(img: Element): string {
  const src = img.getAttribute("src") ?? "";
  if (src.startsWith("/_next/image")) {
    const url = new URL(src, "http://localhost").searchParams.get("url");
    return url ?? src;
  }
  return src.replace(/^https?:\/\/[^/]+/, "");
}

describe("上の帯のホームへ戻る操作（BD-09 5章、CR-018）", () => {
  it.each(["News Galaxy", "Inbox"])(
    "上の帯（題名「%s」）に「ホーム」の文字が無い",
    (title) => {
      const bar = renderTopBar(title);
      expect(bar.textContent ?? "").not.toContain("ホーム");
    },
  );

  it("`/` へのリンクが NEXUS のロゴの画像（public/img/home/logo_001.png）を持つ", () => {
    const bar = renderTopBar();
    const link = homeLink(bar);
    const images = Array.from(link.querySelectorAll("img"));
    expect(images.map(imageSourcePath)).toContain(LOGO_PATH);
    expect(existsSync(join(ROOT, "public", LOGO_PATH))).toBe(true);
  });

  it("`/` へのリンクのボタンの名前（aria-label）が「ホーム」である", () => {
    const bar = renderTopBar();
    const link = homeLink(bar);
    expect(link.getAttribute("aria-label")).toBe("ホーム");
    expect(
      within(bar).getByRole("link", { name: "ホーム" }).getAttribute("href"),
    ).toBe("/");
  });

  it("そのリンクの押す場所が 44 ピクセル四方以上である", () => {
    const bar = renderTopBar();
    const link = homeLink(bar);
    const decls = declarationsOf(link);
    const sizeOf = (props: string[]) =>
      Math.max(
        0,
        ...props.flatMap((p) =>
          (decls.get(p) ?? []).map((v) => lengthToPx(v) ?? 0),
        ),
      );
    const width = sizeOf([
      "width",
      "min-width",
      "inline-size",
      "min-inline-size",
    ]);
    const height = sizeOf([
      "height",
      "min-height",
      "block-size",
      "min-block-size",
    ]);
    expect(width).toBeGreaterThanOrEqual(44);
    expect(height).toBeGreaterThanOrEqual(44);
  });
});

describe("上の帯の上の余白（BD-09 5章、CR-018）", () => {
  it("上の帯の上の余白が max(1.5rem, env(safe-area-inset-top)) である", () => {
    const bar = renderTopBar();
    const decls = declarationsOf(bar);
    const values = [
      ...(decls.get("padding-top") ?? []),
      ...(decls.get("padding-block-start") ?? []),
    ];
    expect(values.length).toBeGreaterThan(0);
    for (const value of values) {
      const m = /^max\((.*)\)$/.exec(value.replace(/\s+/g, ""));
      expect(m, `上の余白の値: ${value}`).not.toBeNull();
      const args = (m?.[1] ?? "")
        .split(/,(?![^(]*\))/)
        .map((a) => {
          const px = lengthToPx(a);
          return px === undefined ? a : `${px}px`;
        })
        .sort();
      expect(args).toEqual(["24px", "env(safe-area-inset-top)"].sort());
    }
  });
});

// ---- ページの viewport ----

type PageModule = {
  viewport?: Record<string, unknown>;
  generateViewport?: (...args: never[]) => unknown;
};

async function resolvedViewport(mod: PageModule) {
  if (mod.generateViewport)
    return (await (mod.generateViewport as (...a: unknown[]) => unknown)({
      params: Promise.resolve({}),
      searchParams: Promise.resolve({}),
    })) as Record<string, unknown> | undefined;
  return mod.viewport;
}

describe("ページの viewport（DD-01 M01、CR-018）", () => {
  it.each([
    [
      "/",
      async () => [
        (await import("../src/app/layout")) as PageModule,
        (await import("../src/app/(screens)/layout")) as PageModule,
        (await import("../src/app/(screens)/page")) as PageModule,
      ],
    ],
    [
      "/news",
      async () => [
        (await import("../src/app/layout")) as PageModule,
        (await import("../src/app/(screens)/layout")) as PageModule,
        (await import("../src/app/(screens)/news/page")) as PageModule,
      ],
    ],
  ])("道 %s の viewport に viewport-fit=cover がある", async (_, load) => {
    // 外の layout から内の page へ、内の値が外の値を上書きする（Next.js の決まり）。
    let viewportFit: unknown;
    for (const mod of await load()) {
      const viewport = await resolvedViewport(mod);
      if (viewport && viewport.viewportFit !== undefined)
        viewportFit = viewport.viewportFit;
    }
    expect(viewportFit).toBe("cover");
  });
});

// ---- 題名 ----

describe("上の帯の題名（BD-03 SCR-002、CR-018）", () => {
  it("題名「News Galaxy」の「Galaxy」が Tailwind の設定のアンバーの色で出る", () => {
    const amber = [...themeValues()]
      .filter(([name]) => /^--color-.*amber/.test(name))
      .map(([, value]) => normalizeColor(value));
    expect(amber.length).toBeGreaterThan(0);

    const bar = renderTopBar("News Galaxy");
    const heading = within(bar).getByRole("heading");
    expect((heading.textContent ?? "").replace(/\s+/g, " ").trim()).toBe(
      "News Galaxy",
    );

    // 「Galaxy」だけを包む要素（中で一番内側のもの）。
    const candidates = Array.from(heading.querySelectorAll("*")).filter(
      (el) => (el.textContent ?? "").trim() === "Galaxy",
    );
    expect(candidates.length).toBeGreaterThan(0);
    const galaxy = candidates[candidates.length - 1];

    // 「Galaxy」の要素から題名の要素までのうち、一番内側で色を決めたものの色。
    let colors: string[] | undefined;
    for (
      let el: Element | null = galaxy;
      el && heading.contains(el);
      el = el.parentElement
    ) {
      const found = declarationsOf(el).get("color");
      if (found && found.length > 0) {
        colors = found;
        break;
      }
    }
    expect(colors, "「Galaxy」の色が決まっていない").toBeDefined();
    for (const color of colors ?? []) {
      expect(amber).toContain(normalizeColor(color));
    }
    expect(screen.getByText("Galaxy")).toBeTruthy();
  });
});
