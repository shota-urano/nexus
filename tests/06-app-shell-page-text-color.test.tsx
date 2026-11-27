// @vitest-environment jsdom
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import tailwindcss from "@tailwindcss/postcss";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import postcss, { type Root } from "postcss";
import { isValidElement, type ReactNode, useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ScreensLayout from "../src/app/(screens)/layout";
import HomeRoute from "../src/app/(screens)/page";
import { deviceFetch } from "../src/client/device-api";
import { MESSAGES } from "../src/server/shared/messages";

// 06-app-shell の実装単位5（DD-01 M01、DD-01 3章 Tailwind CSS の決まり、BD-13）。
// ページ全体（html と body）の文字の色を BD-13 の試作 prototype/app/globals.css と同じ明るい色
// （Tailwind の設定のファイルの文字の色）にし、文字の色を決めていない画面と全面の知らせ
// （MSG-020、MSG-021）が、暗い背景の上で読めるようにする。
// 受け入れ基準:
// - DD-10 TC116 が通る。
// - html と body の文字の色が、Tailwind の設定のファイルの文字の色である。
// - 全面の知らせの文の色が、ページ全体の背景の色と同じでない。

// 根の layout は要求ごとに描くため `connection()` を待つ。テストでは待たずに進める。
vi.mock("next/server", () => ({ connection: async () => undefined }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ROOT = resolve(__dirname, "..");
const GLOBALS_CSS = join(ROOT, "src/app/globals.css");
const PROTOTYPE_CSS = join(ROOT, "prototype/app/globals.css");

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

// 試作の :root の変数（--bg が背景、--text が文字）。
function prototypeVariable(name: "--bg" | "--text"): string {
  const css = readFileSync(PROTOTYPE_CSS, "utf8");
  const m = new RegExp(`${name}\\s*:\\s*([^;]+);`).exec(css);
  if (!m) throw new Error(`試作の ${name} が見つからない`);
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

// ---- 根の layout（src/app/layout.tsx） ----

type Element = { type: unknown; props: Record<string, unknown> };

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

// html と body の要素に付けた class の名前と、直に書いた style の color。
async function rootElements(): Promise<{
  html: { classes: string[]; inline: string[] };
  body: { classes: string[]; inline: string[] };
}> {
  const found = {
    html: { classes: [] as string[], inline: [] as string[] },
    body: { classes: [] as string[], inline: [] as string[] },
  };
  walk(await rootLayoutTree(), (el) => {
    if (el.type !== "html" && el.type !== "body") return;
    const cls = el.props.className;
    if (typeof cls === "string")
      found[el.type].classes.push(...cls.split(/\s+/).filter(Boolean));
    const style = el.props.style as Record<string, unknown> | undefined;
    if (style && typeof style.color === "string")
      found[el.type].inline.push(style.color);
  });
  return found;
}

// ---- 組み上がった CSS（Tailwind を通した src/app/globals.css） ----

let compiled: Promise<Root> | undefined;
function compiledGlobals(): Promise<Root> {
  compiled ??= postcss([tailwindcss({ base: ROOT })])
    .process(readFileSync(GLOBALS_CSS, "utf8"), { from: GLOBALS_CSS })
    .then((result) => result.root);
  return compiled;
}

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

// 選択子のどれかが targets に当たる規則の、prop の宣言の値（変数は解いた後）。
function declarationsFor(
  root: Root,
  targets: Set<string>,
  props: string[],
): string[] {
  const vars = variableValues(root);
  const values: string[] = [];
  root.walkRules((rule) => {
    const selectors = rule.selectors.map((s) => unescapeSelector(s.trim()));
    if (!selectors.some((s) => targets.has(s))) return;
    rule.each((node) => {
      if (node.type === "decl" && props.includes(node.prop))
        values.push(resolveVars(node.value, vars));
    });
  });
  return values;
}

// html か body の文字の色を決める値（CSS の html・:root・body の規則、付けた class、直の style）。
async function rootTextColors(element: "html" | "body"): Promise<string[]> {
  const root = await compiledGlobals();
  const { classes, inline } = (await rootElements())[element];
  const targets = new Set<string>([element]);
  if (element === "html") targets.add(":root");
  for (const cls of classes) targets.add(`.${cls}`);
  return [...declarationsFor(root, targets, ["color"]), ...inline];
}

// 描いた要素の文字の色。自分か先祖の class・style が決めた色を、近いものから探す。
// どれも決めていなければ、ページ全体（body、無ければ html）の文字の色を受け継ぐ。
// 何も決めていなければ undefined。
async function effectiveTextColor(
  el: HTMLElement,
): Promise<string | undefined> {
  const root = await compiledGlobals();
  for (
    let node: HTMLElement | null = el;
    node && node !== document.body && node !== document.documentElement;
    node = node.parentElement
  ) {
    if (node.style.color) return node.style.color;
    const targets = new Set([...node.classList].map((cls) => `.${cls}`));
    const values = declarationsFor(root, targets, ["color"]);
    if (values.length > 0) return values[values.length - 1];
  }
  const body = await rootTextColors("body");
  if (body.length > 0) return body[body.length - 1];
  const html = await rootTextColors("html");
  if (html.length > 0) return html[html.length - 1];
  return undefined;
}

// ---- 全面の知らせを出す画面 ----

const MSG_020 = MESSAGES["MSG-020"].text;
const MSG_021 = MESSAGES["MSG-021"].text;

// 道 `/` を開いたときに Next.js が描くものを、同じ layout と page から描く。
async function renderHomeRoute(
  searchParams: Record<string, string | undefined>,
) {
  const page = await HomeRoute({ searchParams: Promise.resolve(searchParams) });
  return render(<ScreensLayout>{page}</ScreensLayout>);
}

// 端末の API を呼ぶ画面の代わり（通信層 M09 の deviceFetch で /api/app/ を呼ぶだけ）。
function ScreenCallingApi() {
  useEffect(() => {
    void deviceFetch("/api/app/home");
  }, []);
  return <p>画面の中身</p>;
}

async function showMsg021(): Promise<HTMLElement> {
  await renderHomeRoute({ notice: "MSG-021" });
  const alert = screen.getByRole("alert");
  expect(alert.textContent).toBe(MSG_021);
  return alert;
}

async function showMsg020(): Promise<HTMLElement> {
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
  return screen.getByRole("alert");
}

// ---- テスト ----

describe("ページ全体の文字の色（DD-01 3章 Tailwind CSS の決まり、BD-13 の試作 prototype/app/globals.css）", () => {
  it("Tailwind の設定のファイル（@theme）に、試作と同じ文字の色がある", () => {
    const text = prototypeVariable("--text");
    const names = [...themeColors()]
      .filter(([, value]) => normalizeColor(value) === text)
      .map(([name]) => name);
    expect(names.length).toBeGreaterThan(0);
  });

  it.each(["html", "body"] as const)(
    "%s の文字の色が、Tailwind の設定のファイルの文字の色である",
    async (element) => {
      const text = prototypeVariable("--text");
      const values = await rootTextColors(element);
      expect(values.length).toBeGreaterThan(0);
      for (const value of values) expect(normalizeColor(value)).toBe(text);
    },
  );
});

describe("全面の知らせの文の色（MSG-020、MSG-021。DD-10 TC116 の画面）", () => {
  it.each([
    ["MSG-021（`/?notice=MSG-021` を開く）", showMsg021],
    ["MSG-020（API が 401 を返す画面を開く）", showMsg020],
  ] as const)(
    "%s の文の色が決まっていて、ページ全体の背景の色と同じでない",
    async (_, show) => {
      const bg = prototypeVariable("--bg");
      const alert = await show();
      const color = await effectiveTextColor(alert);
      expect(color).toBeDefined();
      expect(normalizeColor(color ?? "")).not.toBe(bg);
    },
  );
});
