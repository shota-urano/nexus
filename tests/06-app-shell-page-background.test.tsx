import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import tailwindcss from "@tailwindcss/postcss";
import postcss, { type Root } from "postcss";
import { isValidElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

// 06-app-shell の実装単位4（DD-01 M01、DD-01 3章 Tailwind CSS の決まり、BD-13）。
// ページ全体（html と body）の背景を BD-13 の試作 prototype/app/globals.css と同じ暗い色にし、
// 端末の上の帯の色（theme-color）と、ホーム画面に追加したときの上の帯の見え方を合わせる。
// 受け入れ基準:
// - html と body の背景の色が、Tailwind の設定のファイルの背景の色である。
// - ページの theme-color がその色である。
// - ホーム画面に追加したときの上の帯の見え方（apple-mobile-web-app-status-bar-style）が、
//   暗い背景に合う値である。

// 根の layout は要求ごとに描くため `connection()` を待つ。テストでは待たずに進める。
vi.mock("next/server", () => ({ connection: async () => undefined }));

const ROOT = resolve(__dirname, "..");
const GLOBALS_CSS = join(ROOT, "src/app/globals.css");

// ---- 色の扱い ----

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

// 試作の背景の色（prototype/app/globals.css の :root の --bg）。
function prototypeBackground(): string {
  const css = readFileSync(join(ROOT, "prototype/app/globals.css"), "utf8");
  const m = /--bg\s*:\s*([^;]+);/.exec(css);
  if (!m) throw new Error("試作の --bg が見つからない");
  return normalizeColor(m[1]);
}

function listFiles(dir: string, pattern: RegExp): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return listFiles(path, pattern);
    return pattern.test(name) ? [path] : [];
  });
}

// Tailwind の設定のファイル（src の CSS の @theme）が決める色。名前 → 値。
function themeColors(): Map<string, string> {
  const colors = new Map<string, string>();
  for (const file of listFiles(join(ROOT, "src"), /\.css$/)) {
    const css = readFileSync(file, "utf8");
    for (const block of css.matchAll(/@theme[^{]*\{([\s\S]*?)\}/g)) {
      for (const m of block[1].matchAll(
        /(--color-[a-z0-9-]+)\s*:\s*([^;]+);/g,
      )) {
        colors.set(m[1], m[2].trim());
      }
    }
  }
  return colors;
}

// ---- 根の layout（src/app/layout.tsx）と、道 `/` の layout・page ----

type PageModule = {
  default?: (props: never) => unknown;
  metadata?: Record<string, unknown>;
  generateMetadata?: (...args: never[]) => unknown;
  viewport?: Record<string, unknown>;
  generateViewport?: (...args: never[]) => unknown;
};

// 道 `/` を描くときに Next.js が重ねる順（外から内へ）。内の値が外の値を上書きする。
async function routeModules(): Promise<PageModule[]> {
  return [
    (await import("../src/app/layout")) as PageModule,
    (await import("../src/app/(screens)/layout")) as PageModule,
    (await import("../src/app/(screens)/page")) as PageModule,
  ];
}

async function resolvedMetadata(mod: PageModule) {
  if (mod.generateMetadata)
    return (await (mod.generateMetadata as (...a: unknown[]) => unknown)(
      { params: Promise.resolve({}), searchParams: Promise.resolve({}) },
      Promise.resolve({}),
    )) as Record<string, unknown> | undefined;
  return mod.metadata;
}

async function resolvedViewport(mod: PageModule) {
  if (mod.generateViewport)
    return (await (mod.generateViewport as (...a: unknown[]) => unknown)({
      params: Promise.resolve({}),
      searchParams: Promise.resolve({}),
    })) as Record<string, unknown> | undefined;
  return mod.viewport;
}

type Element = { type: unknown; props: Record<string, unknown> };

// 根の layout が描く要素の木（html と body と、その中の文字の名前の要素）。
async function rootLayoutTree(): Promise<Element> {
  const mod = (await import("../src/app/layout")) as {
    default: (props: { children: ReactNode }) => unknown;
  };
  const tree = await mod.default({ children: null });
  if (!isValidElement(tree)) throw new Error("根の layout が要素を返さない");
  return tree as unknown as Element;
}

function walk(node: unknown, visit: (el: Element) => void): void {
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit);
    return;
  }
  if (!isValidElement(node)) return;
  const el = node as unknown as Element;
  visit(el);
  if (typeof el.type === "string") walk(el.props.children, visit);
}

// 根の layout に直に書いた <meta name=...> の content。
async function metaTagsInLayout(name: string): Promise<string[]> {
  const found: string[] = [];
  walk(await rootLayoutTree(), (el) => {
    if (el.type === "meta" && el.props.name === name)
      found.push(String(el.props.content));
  });
  return found;
}

// html と body の要素に付けた class の名前。
async function rootClassNames(): Promise<{ html: string[]; body: string[] }> {
  const names = { html: [] as string[], body: [] as string[] };
  walk(await rootLayoutTree(), (el) => {
    if (el.type === "html" || el.type === "body") {
      const cls = el.props.className;
      if (typeof cls === "string")
        names[el.type].push(...cls.split(/\s+/).filter(Boolean));
    }
  });
  return names;
}

// ---- 組み上がった CSS（Tailwind を通した src/app/globals.css） ----

async function compiledGlobals(): Promise<Root> {
  const result = await postcss([tailwindcss({ base: ROOT })]).process(
    readFileSync(GLOBALS_CSS, "utf8"),
    { from: GLOBALS_CSS },
  );
  return result.root;
}

// 組み上がった CSS の中の変数の値（:root、:host などで決めたもの）と、@theme の値。
function variableValues(root: Root): Map<string, string> {
  const vars = new Map<string, string>(themeColors());
  root.walkDecls(/^--/, (decl) => {
    vars.set(decl.prop, decl.value.trim());
  });
  return vars;
}

function resolveVars(
  value: string,
  vars: Map<string, string>,
  depth = 0,
): string {
  if (depth > 10) return value;
  const replaced = value.replace(
    /var\(\s*(--[a-z0-9-]+)\s*(?:,\s*([^)]*))?\)/gi,
    (_, name: string, fallback?: string) =>
      vars.get(name) ?? fallback?.trim() ?? "",
  );
  return replaced === value
    ? value.trim()
    : resolveVars(replaced, vars, depth + 1);
}

function unescapeSelector(selector: string): string {
  return selector.replace(/\\(.)/g, "$1");
}

// 要素（html か body）の背景を決める宣言の値（変数は解いた後）。
function backgroundDeclarations(
  root: Root,
  element: "html" | "body",
  classNames: string[],
): string[] {
  const vars = variableValues(root);
  const targets = new Set<string>([element]);
  if (element === "html") targets.add(":root");
  for (const cls of classNames) targets.add(`.${cls}`);
  const values: string[] = [];
  root.walkRules((rule) => {
    const selectors = rule.selectors.map((s) => unescapeSelector(s.trim()));
    if (!selectors.some((s) => targets.has(s))) return;
    rule.each((node) => {
      if (
        node.type === "decl" &&
        (node.prop === "background" || node.prop === "background-color")
      ) {
        values.push(resolveVars(node.value, vars));
      }
    });
  });
  return values;
}

// ---- テスト ----

describe("ページ全体の背景（DD-01 3章 Tailwind CSS の決まり、BD-13 の試作 prototype/app/globals.css）", () => {
  it("Tailwind の設定のファイル（@theme）に、試作と同じ背景の色がある", () => {
    const bg = prototypeBackground();
    const names = [...themeColors()]
      .filter(([, value]) => normalizeColor(value) === bg)
      .map(([name]) => name);
    expect(names.length).toBeGreaterThan(0);
  });

  it.each(["html", "body"] as const)(
    "%s の背景の色が、Tailwind の設定のファイルの背景の色である",
    async (element) => {
      const bg = prototypeBackground();
      const root = await compiledGlobals();
      const classes = (await rootClassNames())[element];
      const values = backgroundDeclarations(root, element, classes);
      expect(values.length).toBeGreaterThan(0);
      for (const value of values) expect(normalizeColor(value)).toBe(bg);
    },
  );
});

describe("端末の上の帯（DD-01 M01）", () => {
  it("ページの theme-color が、Tailwind の設定のファイルの背景の色である", async () => {
    const bg = prototypeBackground();
    // Next.js の viewport の themeColor（外の layout から内の page へ、内が上書きする）。
    let themeColor: unknown;
    for (const mod of await routeModules()) {
      const viewport = await resolvedViewport(mod);
      if (viewport && viewport.themeColor !== undefined)
        themeColor = viewport.themeColor;
    }
    const colors: string[] = [];
    if (typeof themeColor === "string") colors.push(themeColor);
    if (Array.isArray(themeColor))
      for (const entry of themeColor as { color: string }[])
        colors.push(entry.color);
    // 根の layout に直に書いた <meta name="theme-color">。
    colors.push(...(await metaTagsInLayout("theme-color")));

    expect(colors.length).toBeGreaterThan(0);
    for (const color of colors) expect(normalizeColor(color)).toBe(bg);
  });

  it("ホーム画面に追加したときの上の帯の見え方（apple-mobile-web-app-status-bar-style）が、暗い背景に合う値である", async () => {
    // 暗い背景に合う値は black と black-translucent。default は白い帯になる。
    const DARK_STYLES = ["black", "black-translucent"];
    const styles: string[] = [];
    let fromMetadata: string | undefined;
    for (const mod of await routeModules()) {
      const metadata = await resolvedMetadata(mod);
      if (!metadata) continue;
      const appleWebApp = metadata.appleWebApp as
        { statusBarStyle?: string } | boolean | undefined;
      if (appleWebApp !== undefined) {
        fromMetadata =
          typeof appleWebApp === "object"
            ? appleWebApp.statusBarStyle
            : undefined;
      }
      const other = metadata.other as Record<string, unknown> | undefined;
      const otherStyle = other?.["apple-mobile-web-app-status-bar-style"];
      if (otherStyle !== undefined) styles.push(String(otherStyle));
    }
    if (fromMetadata !== undefined) styles.push(fromMetadata);
    styles.push(
      ...(await metaTagsInLayout("apple-mobile-web-app-status-bar-style")),
    );

    expect(styles.length).toBeGreaterThan(0);
    for (const style of styles) expect(DARK_STYLES).toContain(style);
  });
});
