import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import tailwindcss from "@tailwindcss/postcss";
import postcss, { type Root } from "postcss";

// 押す場所の大きさ（BD-09 5章、RD-11 NFR-008）を、Tailwind を通した src/app/globals.css の規則で測る。
// jsdom は大きさを測れないので、要素の class（と style）に当たる規則の min-height・height・
// min-width・width のうち大きい方を、その要素の最小の大きさとする。`width: 100%`（`w-full`）は、
// 置かれた面の幅いっぱいなので、横は 44 ピクセル以上として扱う。

const ROOT = resolve(__dirname, "../..");
const GLOBALS_CSS = join(ROOT, "src/app/globals.css");

let compiled: Promise<Root> | null = null;
export function compiledGlobals(): Promise<Root> {
  compiled ??= postcss([tailwindcss({ base: ROOT })])
    .process(readFileSync(GLOBALS_CSS, "utf8"), { from: GLOBALS_CSS })
    .then((result) => result.root);
  return compiled;
}

function unescapeSelector(selector: string): string {
  return selector.replace(/\\(.)/g, "$1");
}

// 画面の幅や状態に依らずに当たる規則か（@media、@supports、@container の中ではない）。
function isUnconditional(rule: { parent?: unknown }): boolean {
  let parent = rule.parent as
    { type?: string; name?: string; parent?: unknown } | undefined;
  while (parent && parent.type !== "root") {
    if (parent.type === "atrule" && parent.name !== "layer") return false;
    if (parent.type === "rule") return false;
    parent = parent.parent as typeof parent;
  }
  return true;
}

type Decl = { prop: string; value: string };

function declarationsFor(root: Root, targets: Set<string>): Decl[] {
  const found: Decl[] = [];
  root.walkRules((rule) => {
    if (!isUnconditional(rule)) return;
    const selectors = rule.selectors.map((s) => unescapeSelector(s.trim()));
    if (!selectors.some((s) => targets.has(s))) return;
    rule.each((child) => {
      if (child.type === "decl")
        found.push({ prop: child.prop, value: child.value.trim() });
    });
  });
  return found;
}

function themeVariables(root: Root): Map<string, string> {
  const vars = new Map<string, string>();
  for (const decl of declarationsFor(root, new Set([":root", ":host"]))) {
    if (decl.prop.startsWith("--")) vars.set(decl.prop, decl.value);
  }
  return vars;
}

// 長さをピクセルにする。px、rem、var(--x)、calc(a * b) を扱う。読めなければ null。
function toPixels(raw: string, vars: Map<string, string>): number | null {
  let value = raw.replace(/\s*!important$/, "").trim();
  for (let i = 0; i < 10 && value.includes("var("); i += 1) {
    value = value.replace(
      /var\((--[\w-]+)(?:\s*,\s*([^()]*))?\)/g,
      (_, name: string, fallback?: string) =>
        vars.get(name) ?? fallback ?? "NaN",
    );
  }
  const single = (text: string): number | null => {
    const m = text.trim().match(/^(-?[\d.]+)(px|rem)?$/);
    if (!m) return null;
    const n = Number(m[1]);
    if (m[2] === "rem") return n * 16;
    if (m[2] === "px") return n;
    return n === 0 ? 0 : null;
  };
  const calc = value.match(/^calc\((.+)\)$/);
  if (calc) {
    const parts = calc[1].split("*").map((p) => p.trim());
    if (parts.length !== 2) return null;
    const [a, b] = parts;
    const unitA = single(a);
    const unitB = single(b);
    if (unitA !== null && /^[\d.]+$/.test(b)) return unitA * Number(b);
    if (unitB !== null && /^[\d.]+$/.test(a)) return unitB * Number(a);
    return null;
  }
  return single(value);
}

function elementDeclarations(root: Root, element: HTMLElement): Decl[] {
  const targets = new Set<string>(
    [...element.classList].map((name) => `.${name}`),
  );
  const decls = declarationsFor(root, targets);
  for (let i = 0; i < element.style.length; i += 1) {
    const prop = element.style.item(i);
    decls.push({ prop, value: element.style.getPropertyValue(prop) });
  }
  return decls;
}

export function minimumBox(
  root: Root,
  element: HTMLElement,
): { width: number; height: number } {
  const vars = themeVariables(root);
  let width = 0;
  let height = 0;
  for (const { prop, value } of elementDeclarations(root, element)) {
    const isWidth =
      prop === "min-width" || prop === "width" || prop === "inline-size";
    if (isWidth && value.replace(/\s*!important$/, "").trim() === "100%") {
      width = Number.POSITIVE_INFINITY;
      continue;
    }
    const px = toPixels(value, vars);
    if (px === null) continue;
    if (prop === "min-height" || prop === "height" || prop === "block-size")
      height = Math.max(height, px);
    if (isWidth) width = Math.max(width, px);
  }
  return { width, height };
}

export function describeElement(element: HTMLElement): string {
  const name =
    element.getAttribute("aria-label") ??
    element.textContent?.trim() ??
    element.tagName;
  return `${element.tagName.toLowerCase()}「${name}」`;
}

export const PRESSABLE_SELECTOR =
  'button, a[href], select, input, [role="button"], [role="switch"], [role="radio"], [role="checkbox"], [role="tab"], [role="option"]';

// 44 ピクセル四方に届かない押す場所の説明の一覧。見えない入力を包む label が押す場所なら、label で測る。
export function smallPressables(
  root: Root,
  elements: readonly HTMLElement[],
): string[] {
  const small: string[] = [];
  for (const element of elements) {
    const candidates = [element, element.closest("label")].filter(
      (el): el is HTMLElement => el !== null,
    );
    const ok = candidates.some((candidate) => {
      const box = minimumBox(root, candidate);
      return box.width >= 44 && box.height >= 44;
    });
    if (!ok) {
      const box = minimumBox(root, element);
      small.push(`${describeElement(element)} ${box.width}x${box.height}`);
    }
  }
  return small;
}
