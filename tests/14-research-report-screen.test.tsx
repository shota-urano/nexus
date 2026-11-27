// @vitest-environment jsdom
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ResearchReportScreen } from "../src/screens/research/report-screen";

// 14-research の実装単位3（FN-027、FN-005、FN-006、DD-01 M32・M08、BD-03 SCR-011、Q-095、CR-020）。
// 課題の週報の画面 SCR-011 の部品（M32。`src/screens/research`）。
// 受け入れ基準:
// - DD-10 TC141 が通る。
// - 幅 390 ピクセルと iPad の幅（1180 ピクセル）のどちらでも、方法がその場で広がり、左右に並ばない。
//
// TC141: M32 の部品に `getResearchReport` の応答（D2 の課題 A の2週目。印が「今週足した」「出典が増えた」
// 「反対の意見あり」の方法が1件ずつ）を渡し、週報を描き、方法を押し、週を選び、「読んだ」「保存」
// 「AI に質問」を押す。期待結果は DD-10 TC141 の行のとおり（各 describe に写す）。
//
// 部品の渡し方（課題の一覧の画面 SCR-010 の部品 `ResearchTopicsScreen` と同じ置き場所と名前の付け方）:
// - 部品は `ResearchReportScreen`（src/screens/research/report-screen.tsx）で、開く週報の内容ID を
//   `contentId` で受け取る。SCR-011-A01 で `getResearchReport`（GET /api/app/research/reports/{contentId}）
//   を呼ぶ。テストは fetch を差し替えて応答を渡す（ほかの画面のテストと同じ渡し方）。
// - 方法の行は押す場所（button）で、見出しを中に持つ（SCR-011-A02「方法の行を押す」）。
// - 印のタグは「記号と文字」（「+ 今週足した」「↑ 出典が増えた」「! 反対の意見あり」。BD-03 SCR-011 3.2）を
//   中身に持つ要素として探す。
// - 行の左の色の帯は `data-testid="approach-band"` の要素（未読の点 `unread-mark`、種類の印 `kind-mark` と
//   同じ見分け方）。印の無い方法には出さない。
// - 色は Tailwind の class（DD-01 3章。値は src の CSS の @theme か Tailwind に組み込みの色）か、
//   要素の style から読む。jsdom は CSS を計算しないので、class の色の名前を値に引き当てて確かめる。
// - 「左右に並ばない」は、jsdom が並べ方を計算しないので、広げた中身が DOM の上でその方法の行の
//   すぐ後ろ（次の方法の行より前）にあり、行と中身を横に並べる class や style（画面の幅で切り替わる
//   `md:` などの付いたものも含む）が無いことで確かめる。

vi.mock("next/navigation", () => {
  const router = {
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  };
  return {
    useRouter: () => router,
    usePathname: () => `/research/${WEEK2_ID}`,
    useSearchParams: () => new URLSearchParams(),
  };
});

const ROOT = resolve(__dirname, "..");
const NOW = new Date("2026-12-02T00:00:00.000Z"); // 日本時間 2026-12-02 09:00

// ---- D2（DD-10 3章）の課題 A（second-brain、進行中）の1週目と2週目 ----

const WEEK1_ID = 11;
const WEEK2_ID = 12;

type Mark = "added" | "more_sources" | "disputed";

type ApproachFixture = {
  title: string;
  howToMd: string;
  sourceUrls: string[];
  sourceCount: number;
  marks: Mark[];
  counterMd: string | null;
};

function approach(
  title: string,
  marks: Mark[],
  howToMd: string,
  sourceUrls: string[],
  counterMd: string | null = null,
): ApproachFixture {
  return {
    title,
    howToMd,
    sourceUrls,
    sourceCount: sourceUrls.length,
    marks,
    counterMd,
  };
}

// 印が「今週足した」「出典が増えた」「反対の意見あり」の方法が1件ずつと、印の無い方法1件（D2）。
// 帯の優先順を確かめるため、印が2つある方法を2件足す（TC141「今週足した」と「反対の意見あり」の両方）。
// 見出しは互いに含み合わない。
const ADDED = approach("毎日ノートを書く", ["added"], "朝に5分だけ書く。", [
  "https://notes.example.com/daily",
  "http://journal.example.org/old-habit",
]);
const MORE = approach(
  "タグで分ける",
  ["more_sources"],
  "タグは10個までに絞る。",
  [
    "https://tags-a.example.com/1",
    "https://tags-b.example.net/2",
    "https://tags-c.example.org/3",
  ],
);
const DISPUTED = approach(
  "全部を1か所に集める",
  ["disputed"],
  "受け取り口を1つに決める。",
  ["https://inbox.example.com/one-place"],
  "集めすぎると探せなくなるという意見がある。",
);
const PLAIN = approach("紙の手帳を併用する", [], "週に1回だけ書き写す。", []);
const ADDED_AND_DISPUTED = approach(
  "索引を先に作る",
  ["added", "disputed"],
  "見出しの一覧を最初に書く。",
  ["https://index.example.com/first"],
  "索引は後から作れば足りるという意見がある。",
);
const MORE_AND_ADDED = approach(
  "リンクでつなぐ",
  ["more_sources", "added"],
  "似た内容のノート同士を結ぶ。",
  ["https://links.example.com/a", "https://links.example.com/b"],
);

const WEEK2_APPROACHES = [
  ADDED,
  MORE,
  DISPUTED,
  PLAIN,
  ADDED_AND_DISPUTED,
  MORE_AND_ADDED,
];

const WEEKS = [
  { contentId: WEEK2_ID, week: 2, sentOn: "2026-12-01", isRead: false },
  { contentId: WEEK1_ID, week: 1, sentOn: "2026-11-24", isRead: true },
];

const WEEK2 = {
  contentId: WEEK2_ID,
  topicId: "second-brain",
  topicTitle: "第二の脳の作り方",
  week: 2,
  sentOn: "2026-12-01",
  status: "active",
  answerMd: "まず小さく始めるのがよい。",
  approaches: WEEK2_APPROACHES,
  unknownsMd: "長く続けたときの重さはまだ分からない。",
  changesMd: "今週は方法を3件足した。",
  receivedAt: "2026-12-01T07:30:00.000+09:00",
  state: {
    contentId: WEEK2_ID,
    isNew: true,
    isRead: false,
    isSaved: false,
    savedAt: null,
  },
  weeks: WEEKS,
};

const WEEK1 = {
  ...WEEK2,
  contentId: WEEK1_ID,
  week: 1,
  sentOn: "2026-11-24",
  answerMd: "まだ答えは定まらない。",
  approaches: [
    approach("最初に試した方法", ["added"], "とにかく書き始める。", [
      "https://first.example.com/start",
    ]),
  ],
  unknownsMd: "どの道具がよいか分からない。",
  changesMd: "最初の週の報告。",
  receivedAt: "2026-11-24T07:30:00.000+09:00",
  state: {
    contentId: WEEK1_ID,
    isNew: false,
    isRead: true,
    isSaved: false,
    savedAt: null,
  },
};

// ---- 差し替えた fetch ----

type Call = { url: string; method: string; body: string | null };
let calls: Call[];
let reports: Record<number, unknown>;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

type StateFixture = {
  contentId: number;
  isNew: boolean;
  isRead: boolean;
  isSaved: boolean;
  savedAt: string | null;
};

// 週報、開いた日時、既読、保存、AI チャットの会話の API。会話は前の会話が無いものとして、
// 渡された対象どおりに新しい会話を作る。
function stubApi(): void {
  calls = [];
  const states: Record<number, StateFixture> = {
    [WEEK1_ID]: { ...WEEK1.state },
    [WEEK2_ID]: { ...WEEK2.state },
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const call: Call = {
        url: String(input),
        method: init?.method ?? "GET",
        body: typeof init?.body === "string" ? init.body : null,
      };
      calls.push(call);
      const key = `${call.method} ${call.url}`;
      const report = /^GET \/api\/app\/research\/reports\/(\d+)$/.exec(key);
      if (report && reports[Number(report[1])] !== undefined) {
        return jsonResponse(reports[Number(report[1])]);
      }
      const opened = /^POST \/api\/app\/contents\/(\d+)\/opened$/.exec(key);
      if (opened && states[Number(opened[1])]) {
        const id = Number(opened[1]);
        states[id] = { ...states[id], isNew: false };
        return jsonResponse(states[id]);
      }
      const change = /^PUT \/api\/app\/contents\/(\d+)\/(read|saved)$/.exec(
        key,
      );
      if (change && states[Number(change[1])]) {
        const id = Number(change[1]);
        const body = JSON.parse(call.body ?? "{}") as {
          isRead?: boolean;
          isSaved?: boolean;
        };
        if (body.isRead !== undefined) {
          states[id] = { ...states[id], isNew: false, isRead: body.isRead };
        }
        if (body.isSaved !== undefined) {
          states[id] = {
            ...states[id],
            isNew: false,
            isSaved: body.isSaved,
            savedAt: body.isSaved ? "2026-12-02T09:00:00.000+09:00" : null,
          };
        }
        return jsonResponse(states[id]);
      }
      if (
        call.method === "GET" &&
        call.url.startsWith("/api/app/conversations?")
      ) {
        return jsonResponse({ items: [], nextCursor: null });
      }
      if (key === "POST /api/app/conversations") {
        const { target } = JSON.parse(call.body ?? "{}") as {
          target?: { kind: string; contentId: number };
        };
        return jsonResponse(
          {
            conversation: {
              conversationId: 70,
              target: target ?? null,
              targetTitle: target === undefined ? null : WEEK2.topicTitle,
              firstQuestionText: null,
              startedAt: "2026-12-02T09:00:00.000+09:00",
              lastSpokenAt: "2026-12-02T09:00:00.000+09:00",
            },
            notice: null,
          },
          201,
        );
      }
      throw new Error(`知らない呼び出し: ${key}`);
    }),
  );
}

function reportReads(): string[] {
  return calls
    .filter(
      (call) =>
        call.method === "GET" &&
        call.url.startsWith("/api/app/research/reports/"),
    )
    .map((call) => call.url);
}

// ---- 画面の幅（jsdom は大きさを計算しないので、innerWidth と matchMedia を差し替える） ----

let viewportWidth = 390;

// `(min-width: Npx)` と `(max-width: Npx)` を今の幅で判定する。ほかの条件は合わないとする。
function mediaMatches(query: string): boolean {
  const parts = query
    .toLowerCase()
    .split(/\band\b/)
    .map((part) => part.trim())
    .filter((part) => part !== "" && part !== "screen" && part !== "all");
  if (parts.length === 0) return true;
  return parts.every((part) => {
    const min = /\(\s*min-width\s*:\s*([\d.]+)px\s*\)/.exec(part);
    if (min) return viewportWidth >= Number(min[1]);
    const max = /\(\s*max-width\s*:\s*([\d.]+)px\s*\)/.exec(part);
    if (max) return viewportWidth <= Number(max[1]);
    const wide = /\(\s*width\s*>=\s*([\d.]+)px\s*\)/.exec(part);
    if (wide) return viewportWidth >= Number(wide[1]);
    const narrow = /\(\s*width\s*<\s*([\d.]+)px\s*\)/.exec(part);
    if (narrow) return viewportWidth < Number(narrow[1]);
    return false;
  });
}

function setViewport(width: number, height: number): void {
  viewportWidth = width;
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    writable: true,
    value: height,
  });
  Object.defineProperty(document.documentElement, "clientWidth", {
    configurable: true,
    value: width,
  });
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: mediaMatches(query),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
  window.dispatchEvent(new Event("resize"));
}

// ---- 色の読み方 ----

type Rgb = [number, number, number];
type ColorValue = Rgb | "transparent" | "current";

// 色の名前と値。Tailwind に組み込みの色（node_modules/tailwindcss/theme.css）を先に読み、
// src の CSS の @theme の --color-* で上書きする。
function cssFilesUnder(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((path) => path.endsWith(".css"))
    .map((path) => join(dir, path));
}

const THEME_COLORS: Map<string, string> = (() => {
  const colors = new Map<string, string>();
  const files = [
    join(ROOT, "node_modules/tailwindcss/theme.css"),
    ...cssFilesUnder(join(ROOT, "src")),
  ];
  for (const file of files) {
    const css = readFileSync(file, "utf8");
    for (const match of css.matchAll(/--color-([a-z0-9-]+)\s*:\s*([^;]+);/g)) {
      colors.set(match[1], match[2].trim());
    }
  }
  return colors;
})();

function resolveVars(value: string, depth = 0): string {
  if (depth > 10) return value;
  const replaced = value.replace(
    /var\(\s*--color-([a-z0-9-]+)\s*(?:,\s*([^)]+))?\)/g,
    (_, name: string, fallback?: string) =>
      THEME_COLORS.get(name) ?? fallback ?? "",
  );
  return replaced === value ? value : resolveVars(replaced, depth + 1);
}

function srgbFromLinear(x: number): number {
  const v = x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, v)) * 255);
}

function oklchToRgb(l: number, c: number, h: number): Rgb {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    srgbFromLinear(4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_),
    srgbFromLinear(-1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_),
    srgbFromLinear(-0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_),
  ];
}

// 色の値を読む。読めなければ null。
function parseColor(raw: string): ColorValue | null {
  const value = resolveVars(raw).trim().toLowerCase();
  if (value === "") return null;
  if (value === "transparent" || value === "none") return "transparent";
  if (value === "currentcolor" || value === "inherit") return "current";
  const hex = /^#([0-9a-f]{3,8})$/.exec(value);
  if (hex) {
    let digits = hex[1];
    if (digits.length === 3 || digits.length === 4) {
      digits = [...digits].map((d) => d + d).join("");
    }
    if (digits.length === 8 && digits.slice(6) === "00") return "transparent";
    return [
      parseInt(digits.slice(0, 2), 16),
      parseInt(digits.slice(2, 4), 16),
      parseInt(digits.slice(4, 6), 16),
    ];
  }
  const rgb =
    /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(
      value,
    );
  if (rgb) {
    if (rgb[4] !== undefined && parseFloat(rgb[4]) === 0) return "transparent";
    return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])].map((n) =>
      Math.round(n),
    ) as Rgb;
  }
  const oklch =
    /^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+%?))?\s*\)$/.exec(
      value,
    );
  if (oklch) {
    if (oklch[5] !== undefined && parseFloat(oklch[5]) === 0) {
      return "transparent";
    }
    const l = Number(oklch[1]) / (oklch[2] === "%" ? 100 : 1);
    return oklchToRgb(l, Number(oklch[3]), Number(oklch[4]));
  }
  return null;
}

// 画面の幅などの条件の付いていない class。
function baseClasses(element: Element): string[] {
  return Array.from(element.classList).filter((name) => !name.includes(":"));
}

// class の色。`text-` などの後ろの名前を色の名前か任意の値（`[#abc]`）として読む。色でなければ飛ばす。
function classColor(element: Element, prefixes: string[]): ColorValue | null {
  for (const name of baseClasses(element)) {
    for (const prefix of prefixes) {
      if (!name.startsWith(prefix)) continue;
      const rest = name.slice(prefix.length).replace(/\/[^/]+$/, "");
      if (rest === "current") return "current";
      if (rest === "transparent" || rest === "none") return "transparent";
      const arbitrary = /^\[(?:color:)?(.+)\]$/.exec(rest);
      const raw = arbitrary ? arbitrary[1] : THEME_COLORS.get(rest);
      if (raw === undefined) continue;
      const color = parseColor(raw);
      if (color !== null) return color;
    }
  }
  return null;
}

function styleColor(element: Element, property: string): ColorValue | null {
  if (!(element instanceof HTMLElement)) return null;
  const value = element.style.getPropertyValue(property);
  return value === "" ? null : parseColor(value);
}

// 文字の色。自分か一番近い祖先の style か class から読む。
function textColor(element: Element): ColorValue | null {
  for (let cur: Element | null = element; cur; cur = cur.parentElement) {
    const color = styleColor(cur, "color") ?? classColor(cur, ["text-"]);
    if (color !== null && color !== "current") return color;
  }
  return null;
}

// 枠の色。色を決めていなければ文字の色（Tailwind v4 の枠の色の既定は currentColor）。
function borderColor(element: Element): ColorValue | null {
  const color =
    styleColor(element, "border-color") ?? classColor(element, ["border-"]);
  if (color === null || color === "current") return textColor(element);
  return color;
}

// 枠を持つか（`border`、`border-2`、`border-[1px]` か style の枠の太さ）。
function hasBorder(element: Element): boolean {
  if (
    baseClasses(element).some((name) =>
      /^border(-[0-9]+|-\[[\d.]+(px|rem|em)\])?$/.test(name),
    )
  ) {
    return true;
  }
  if (!(element instanceof HTMLElement)) return false;
  const width = element.style.borderWidth || element.style.borderTopWidth;
  return width !== "" && parseFloat(width) > 0;
}

// 塗り（背景の色）。無いか透明なら null。
function fillColor(element: Element): Rgb | null {
  const color =
    styleColor(element, "background-color") ??
    styleColor(element, "background") ??
    classColor(element, ["bg-"]);
  if (color === null || color === "transparent") return null;
  if (color === "current") return textColor(element) as Rgb | null;
  return color;
}

// 帯の色。背景か左の枠（か枠）の色を style か class から読む。
function bandColor(element: Element): ColorValue | null {
  const color =
    styleColor(element, "background-color") ??
    styleColor(element, "background") ??
    styleColor(element, "border-left-color") ??
    styleColor(element, "border-inline-start-color") ??
    styleColor(element, "border-color") ??
    classColor(element, [
      "bg-",
      "border-l-",
      "border-s-",
      "border-x-",
      "border-",
    ]);
  if (color === "current") return textColor(element);
  return color;
}

// HSL の色相（度）。
function hueOf([r, g, b]: Rgb): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return Number.NaN;
  let hue: number;
  if (max === r) hue = ((g - b) / (max - min)) * 60;
  else if (max === g) hue = (2 + (b - r) / (max - min)) * 60;
  else hue = (4 + (r - g) / (max - min)) * 60;
  return (hue + 360) % 360;
}

function asRgb(color: ColorValue | null, what: string): Rgb {
  if (color === null || color === "transparent" || color === "current") {
    throw new Error(`${what}の色が読めない: ${String(color)}`);
  }
  return color;
}

// ---- 画面の読み方 ----

const MARK_TAGS: Record<Mark, { symbol: string; label: string }> = {
  added: { symbol: "+", label: "今週足した" },
  more_sources: { symbol: "↑", label: "出典が増えた" },
  disputed: { symbol: "!", label: "反対の意見あり" },
};

const MARK_ORDER: Mark[] = ["added", "more_sources", "disputed"];

const squash = (text: string | null | undefined) =>
  (text ?? "").replace(/\s+/g, "");

async function renderReport(contentId = WEEK2_ID) {
  const view = render(<ResearchReportScreen contentId={contentId} />);
  await screen.findByText(WEEK2.changesMd);
  return view;
}

// 方法の行（押す場所）。見出しを持つ button。
function approachRow(title: string): HTMLElement {
  const text = screen.getByText(title);
  const row = text.closest<HTMLElement>('button, [role="button"]');
  if (row === null) throw new Error(`「${title}」の行が押す場所でない`);
  return row;
}

// 方法1件の入れ物。行から、ほかの方法の見出しを含まない一番外側の祖先までのぼる。
function approachContainer(
  title: string,
  approaches: ApproachFixture[] = WEEK2_APPROACHES,
): HTMLElement {
  const others = approaches.map((a) => a.title).filter((t) => t !== title);
  let element = approachRow(title);
  while (
    element.parentElement &&
    element.parentElement !== document.body &&
    !others.some((t) => element.parentElement?.textContent?.includes(t))
  ) {
    element = element.parentElement;
  }
  return element;
}

// 入れ物の中の印のタグ（記号と文字を中身に持つ一番外側の要素）。
function markTags(container: HTMLElement, mark: Mark): HTMLElement[] {
  const { symbol, label } = MARK_TAGS[mark];
  const text = `${symbol}${label}`;
  return Array.from(container.querySelectorAll<HTMLElement>("*")).filter(
    (element) =>
      squash(element.textContent) === text &&
      squash(element.parentElement?.textContent) !== text,
  );
}

function markTag(title: string, mark: Mark): HTMLElement {
  const tags = markTags(approachContainer(title), mark);
  expect(tags, `「${title}」の「${MARK_TAGS[mark].label}」のタグ`).toHaveLength(
    1,
  );
  return tags[0];
}

function bands(container: HTMLElement): HTMLElement[] {
  const found = Array.from(
    container.querySelectorAll<HTMLElement>('[data-testid="approach-band"]'),
  );
  if (container.dataset.testid === "approach-band") found.unshift(container);
  return found;
}

// 印のタグの文字の色（その印の色）。
function markColor(mark: Mark): Rgb {
  const owner = WEEK2_APPROACHES.find(
    (a) => a.marks.length === 1 && a.marks[0] === mark,
  );
  if (owner === undefined) throw new Error(`${mark} だけの方法が無い`);
  return asRgb(textColor(markTag(owner.title, mark)), `${mark} のタグの文字`);
}

function isBefore(a: Node, b: Node): boolean {
  return (
    (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
  );
}

function commonAncestor(a: Element, b: Element): Element {
  for (let cur: Element | null = a; cur; cur = cur.parentElement) {
    if (cur.contains(b)) return cur;
  }
  throw new Error("共通の祖先が無い");
}

// 子を横に並べる class（画面の幅などの条件の付いたものも含む）。
const SIDE_BY_SIDE_CLASS =
  /^(?:.*:)?(?:grid-cols-(?:[2-9]|1[0-2]|\[.+\]|subgrid)|grid-flow-col(?:-dense)?|auto-cols-.+|columns-.+|flex-row(?:-reverse)?|float-(?:left|right|start|end))$/;

function sideBySideReasons(element: Element): string[] {
  const reasons = Array.from(element.classList).filter((name) =>
    SIDE_BY_SIDE_CLASS.test(name),
  );
  const base = baseClasses(element);
  const isFlex = base.includes("flex") || base.includes("inline-flex");
  const isColumn =
    base.includes("flex-col") || base.includes("flex-col-reverse");
  if (isFlex && !isColumn) reasons.push("flex（横向き）");
  if (element instanceof HTMLElement) {
    const { display, flexDirection, gridTemplateColumns, columnCount } =
      element.style;
    if (
      /flex/.test(display) &&
      !/column/.test(flexDirection || element.style.flexFlow)
    ) {
      reasons.push(`style display:${display}`);
    }
    if (
      gridTemplateColumns !== "" &&
      gridTemplateColumns.trim().split(/\s+/).length > 1
    ) {
      reasons.push(`style grid-template-columns:${gridTemplateColumns}`);
    }
    if (columnCount !== "" && columnCount !== "1" && columnCount !== "auto") {
      reasons.push(`style column-count:${columnCount}`);
    }
  }
  return reasons;
}

// 方法を押して、その場で下に広がり、左右に並ばないことを確かめる。
function expectOpensInPlace(item: ApproachFixture, next: ApproachFixture) {
  const row = approachRow(item.title);
  const container = approachContainer(item.title);
  const howTo = screen.getByText(item.howToMd);
  // 広げた中身は、その方法の入れ物の中で、行の後ろ、次の方法の行より前にある。
  expect(container.contains(howTo)).toBe(true);
  expect(row.contains(howTo)).toBe(false);
  expect(isBefore(row, howTo)).toBe(true);
  expect(isBefore(howTo, approachRow(next.title))).toBe(true);
  // 中身は1か所にだけ出る（右の面などに同じ中身を出さない）。
  expect(screen.getAllByText(item.howToMd)).toHaveLength(1);
  // 行と中身を横に並べない。行と中身の共通の祖先は子を横に並べず、
  // そこから上の祖先も、画面の幅で横に並べる形に切り替えない。
  const shared = commonAncestor(row, howTo);
  expect(sideBySideReasons(shared), "行と中身の共通の祖先").toEqual([]);
  for (
    let cur: Element | null = shared.parentElement;
    cur && cur !== document.body;
    cur = cur.parentElement
  ) {
    const responsive = Array.from(cur.classList).filter(
      (name) => name.includes(":") && SIDE_BY_SIDE_CLASS.test(name),
    );
    expect(responsive, `祖先 <${cur.tagName.toLowerCase()}>`).toEqual([]);
  }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  window.sessionStorage.clear();
  setViewport(390, 844);
  reports = { [WEEK1_ID]: WEEK1, [WEEK2_ID]: WEEK2 };
  stubApi();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("TC141 課題の週報 SCR-011（M32）: 週報を描く", () => {
  it("getResearchReport をその内容ID で呼び、今週の変化、現時点の答え、方法の一覧、まだ分かっていないことを1つの画面にこの順で出す", async () => {
    await renderReport();
    expect(reportReads()).toEqual([`/api/app/research/reports/${WEEK2_ID}`]);
    const changes = screen.getByText(WEEK2.changesMd);
    const answer = screen.getByText(WEEK2.answerMd);
    const unknowns = screen.getByText(WEEK2.unknownsMd);
    const firstRow = approachRow(ADDED.title);
    const lastRow = approachRow(MORE_AND_ADDED.title);
    // 項目のラベル（BD-03 SCR-011 3.3）。
    for (const label of [
      "今週の変化",
      "現時点の答え",
      "方法の一覧",
      "まだ分かっていないこと",
    ]) {
      expect(screen.getAllByText(new RegExp(label)).length).toBeGreaterThan(0);
    }
    // 今週の変化を一番上に、続けて全体像（BD-03 SCR-011 3.2）。
    expect(isBefore(changes, answer)).toBe(true);
    expect(isBefore(answer, firstRow)).toBe(true);
    expect(isBefore(lastRow, unknowns)).toBe(true);
  });

  it("課題名、「2週目」、「進行中」を出す", async () => {
    const { container } = await renderReport();
    expect(container.textContent).toContain(WEEK2.topicTitle);
    expect(container.textContent).toContain("2週目");
    expect(container.textContent).toContain("進行中");
  });

  it("方法を送られた順に全て出し、行に見出しと「出典 {n}」を出し、初めは全て閉じている", async () => {
    await renderReport();
    const rows = WEEK2_APPROACHES.map((a) => approachRow(a.title));
    for (let i = 1; i < rows.length; i += 1) {
      expect(isBefore(rows[i - 1], rows[i])).toBe(true);
    }
    for (const a of WEEK2_APPROACHES) {
      expect(squash(approachRow(a.title).textContent)).toContain(
        squash(`出典 ${a.sourceCount}`),
      );
      expect(screen.queryByText(a.howToMd)).toBeNull();
      if (a.counterMd !== null)
        expect(screen.queryByText(a.counterMd)).toBeNull();
    }
  });
});

describe("TC141 方法の印（BD-03 SCR-011 3.2。Q-095 の答え）", () => {
  it("3つの印が記号と文字のタグで、その印のある方法の行にだけ出る", async () => {
    await renderReport();
    for (const a of WEEK2_APPROACHES) {
      const row = approachRow(a.title);
      for (const mark of MARK_ORDER) {
        const tags = markTags(approachContainer(a.title), mark);
        if (a.marks.includes(mark)) {
          expect(tags, `「${a.title}」の ${mark}`).toHaveLength(1);
          expect(row.contains(tags[0])).toBe(true);
        } else {
          expect(tags, `「${a.title}」の ${mark}`).toHaveLength(0);
        }
      }
    }
  });

  it("タグは印ごとの色の枠と文字の色で出し、塗らない", async () => {
    await renderReport();
    for (const a of WEEK2_APPROACHES) {
      for (const mark of a.marks) {
        const tag = markTag(a.title, mark);
        const what = `「${a.title}」の「${MARK_TAGS[mark].label}」`;
        const text = asRgb(textColor(tag), `${what}の文字`);
        expect(hasBorder(tag), `${what}に枠がある`).toBe(true);
        expect(asRgb(borderColor(tag), `${what}の枠`)).toEqual(text);
        expect(fillColor(tag), `${what}を塗らない`).toBeNull();
        // 同じ印のタグは、どの方法でも同じ色。
        expect(text).toEqual(markColor(mark));
      }
    }
  });

  it("印の色は3つとも違い、今週足したは緑、出典が増えたはアンバー、反対の意見ありは赤みのある色", async () => {
    await renderReport();
    const added = markColor("added");
    const more = markColor("more_sources");
    const disputed = markColor("disputed");
    expect(added).not.toEqual(more);
    expect(added).not.toEqual(disputed);
    expect(more).not.toEqual(disputed);
    const addedHue = hueOf(added);
    const moreHue = hueOf(more);
    const disputedHue = hueOf(disputed);
    expect(addedHue, `緑 ${added.join(",")}`).toBeGreaterThanOrEqual(75);
    expect(addedHue, `緑 ${added.join(",")}`).toBeLessThanOrEqual(180);
    expect(moreHue, `アンバー ${more.join(",")}`).toBeGreaterThanOrEqual(25);
    expect(moreHue, `アンバー ${more.join(",")}`).toBeLessThanOrEqual(60);
    expect(
      disputedHue >= 320 || disputedHue <= 20,
      `赤みのある色 ${disputed.join(",")}（色相 ${disputedHue}）`,
    ).toBe(true);
  });

  it("印のある方法の行の左に帯を1本出し、帯の色は 反対の意見あり → 今週足した → 出典が増えた の優先順で先の印の色。印の無い方法には帯を出さない", async () => {
    await renderReport();
    const expected: Array<[ApproachFixture, Mark | null]> = [
      [ADDED, "added"],
      [MORE, "more_sources"],
      [DISPUTED, "disputed"],
      [PLAIN, null],
      // 「今週足した」と「反対の意見あり」の両方がある方法は反対の意見ありの色（TC141）。
      [ADDED_AND_DISPUTED, "disputed"],
      // 「出典が増えた」と「今週足した」の両方がある方法は今週足したの色（印の並び順によらない）。
      [MORE_AND_ADDED, "added"],
    ];
    for (const [a, mark] of expected) {
      const found = bands(approachContainer(a.title));
      if (mark === null) {
        expect(found, `「${a.title}」に帯を出さない`).toHaveLength(0);
        continue;
      }
      expect(found, `「${a.title}」の帯`).toHaveLength(1);
      expect(asRgb(bandColor(found[0]), `「${a.title}」の帯`)).toEqual(
        markColor(mark),
      );
    }
  });
});

describe("TC141 方法を広げる（SCR-011-A02）", () => {
  it("方法を押すと、そのためには、出典のリンク、反対の意見がその方法の下に広がり、もう一度押すと閉じる", async () => {
    await renderReport();
    fireEvent.click(approachRow(DISPUTED.title));
    const container = approachContainer(DISPUTED.title);
    expect(await within(container).findByText(DISPUTED.howToMd)).toBeTruthy();
    expect(within(container).getByText(DISPUTED.counterMd ?? "")).toBeTruthy();
    const link = within(container).getByRole("link", {
      name: /inbox\.example\.com/,
    });
    expect(link.getAttribute("href")).toBe(DISPUTED.sourceUrls[0]);
    // ほかの方法は閉じたまま。
    expect(screen.queryByText(ADDED.howToMd)).toBeNull();

    fireEvent.click(approachRow(DISPUTED.title));
    await waitFor(() =>
      expect(screen.queryByText(DISPUTED.howToMd)).toBeNull(),
    );
    expect(screen.queryByText(DISPUTED.counterMd ?? "")).toBeNull();
    expect(
      screen.queryByRole("link", { name: /inbox\.example\.com/ }),
    ).toBeNull();
  });

  it("出典は http と https の URL がどちらもリンク（a）になり、ホスト名を出す", async () => {
    await renderReport();
    fireEvent.click(approachRow(ADDED.title));
    const container = approachContainer(ADDED.title);
    await within(container).findByText(ADDED.howToMd);
    const links = within(container).getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual(
      ADDED.sourceUrls,
    );
    expect(links[0].textContent).toContain("notes.example.com");
    expect(links[1].textContent).toContain("journal.example.org");
  });

  it("反対の意見が無い方法は、広げても反対の意見を出さない", async () => {
    await renderReport();
    fireEvent.click(approachRow(MORE.title));
    const container = approachContainer(MORE.title);
    await within(container).findByText(MORE.howToMd);
    expect(within(container).queryByText(/^反対の意見$/)).toBeNull();
    expect(within(container).getAllByRole("link")).toHaveLength(
      MORE.sourceUrls.length,
    );
  });

  it("http でも https でもない出典の URL は a にならない", async () => {
    reports[WEEK2_ID] = {
      ...WEEK2,
      approaches: WEEK2_APPROACHES.map((a) =>
        a === ADDED
          ? {
              ...a,
              sourceUrls: ["javascript:alert(1)", ...a.sourceUrls],
              sourceCount: a.sourceUrls.length + 1,
            }
          : a,
      ),
    };
    const { container } = render(<ResearchReportScreen contentId={WEEK2_ID} />);
    // 応答を受けて描くか、形が違うとして MSG-019 を出すかは問わない。どちらでも javascript: の a を作らない。
    const failed = /内容を読み込めませんでした/;
    await waitFor(() =>
      expect(
        screen.queryByText(ADDED.title) ?? screen.queryByText(failed),
      ).not.toBeNull(),
    );
    if (screen.queryByText(ADDED.title) !== null) {
      fireEvent.click(approachRow(ADDED.title));
      await screen.findByText(ADDED.howToMd);
    }
    const hrefs = Array.from(container.querySelectorAll("a")).map(
      (a) => a.getAttribute("href") ?? "",
    );
    expect(hrefs.filter((href) => /^\s*javascript:/i.test(href))).toEqual([]);
    expect(container.innerHTML).not.toMatch(/href="\s*javascript:/i);
  });

  it("複数の方法を同時に開ける", async () => {
    await renderReport();
    fireEvent.click(approachRow(ADDED.title));
    fireEvent.click(approachRow(DISPUTED.title));
    await screen.findByText(DISPUTED.howToMd);
    expect(screen.getByText(ADDED.howToMd)).toBeTruthy();
    expect(screen.getByText(DISPUTED.howToMd)).toBeTruthy();
    expect(
      approachContainer(ADDED.title).contains(screen.getByText(ADDED.howToMd)),
    ).toBe(true);
    expect(
      approachContainer(DISPUTED.title).contains(
        screen.getByText(DISPUTED.howToMd),
      ),
    ).toBe(true);
  });
});

describe("受け入れ基準: 幅 390 ピクセルと iPad の幅（1180 ピクセル）のどちらでも、方法がその場で広がり、左右に並ばない", () => {
  for (const [width, height] of [
    [390, 844],
    [1180, 820],
  ] as const) {
    it(`幅 ${width} ピクセル: 押した方法の行のすぐ下に中身が広がり、左右に並ばない`, async () => {
      setViewport(width, height);
      await renderReport();
      fireEvent.click(approachRow(ADDED.title));
      await screen.findByText(ADDED.howToMd);
      expectOpensInPlace(ADDED, MORE);
      // 2つ目を開いても、それぞれの行の下に広がる。
      fireEvent.click(approachRow(DISPUTED.title));
      await screen.findByText(DISPUTED.howToMd);
      expectOpensInPlace(ADDED, MORE);
      expectOpensInPlace(DISPUTED, PLAIN);
    });
  }
});

describe("TC141 週を選ぶ（SCR-011-I01、SCR-011-A03）", () => {
  it("週の選択欄に「{n}週目（{送った日}）」を新しい週を上に出し、週を選ぶとその週の内容ID で getResearchReport を呼んでその週に替わる", async () => {
    await renderReport();
    const select = screen.getByRole("combobox", { name: "週" });
    const options = within(select).getAllByRole("option");
    expect(options.map((option) => option.textContent ?? "")).toEqual([
      expect.stringContaining("2週目（12月1日（火）"),
      expect.stringContaining("1週目（11月24日（火）"),
    ]);
    const week1 = options[1] as HTMLOptionElement;
    fireEvent.change(select, { target: { value: week1.value } });
    await screen.findByText(WEEK1.changesMd);
    expect(reportReads()).toEqual([
      `/api/app/research/reports/${WEEK2_ID}`,
      `/api/app/research/reports/${WEEK1_ID}`,
    ]);
    expect(screen.getByText(WEEK1.answerMd)).toBeTruthy();
    expect(screen.queryByText(WEEK2.changesMd)).toBeNull();
  });
});

describe("TC141 読んだ、保存、AI に質問（SCR-011-A04〜A07。ボタンの名前は BD-09 4章の言葉）", () => {
  it("「読んだ」を押すと setRead（isRead 真）を呼び、名前が「未読に戻す」に替わる", async () => {
    await renderReport();
    expect(screen.queryByRole("button", { name: "未読に戻す" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "読んだ" }));
    await screen.findByRole("button", { name: "未読に戻す" });
    const puts = calls.filter(
      (call) =>
        call.method === "PUT" &&
        call.url === `/api/app/contents/${WEEK2_ID}/read`,
    );
    expect(puts).toHaveLength(1);
    expect(JSON.parse(puts[0].body ?? "null")).toEqual({ isRead: true });
  });

  it("「保存」を押すと setSaved（isSaved 真）を呼び、名前が「保存を外す」に替わる", async () => {
    await renderReport();
    expect(screen.queryByRole("button", { name: "保存を外す" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await screen.findByRole("button", { name: "保存を外す" });
    const puts = calls.filter(
      (call) =>
        call.method === "PUT" &&
        call.url === `/api/app/contents/${WEEK2_ID}/saved`,
    );
    expect(puts).toHaveLength(1);
    expect(JSON.parse(puts[0].body ?? "null")).toEqual({ isSaved: true });
  });

  it("「AI に質問」を押すと、対象 page とその週報の内容ID の AI チャットを開く", async () => {
    await renderReport();
    expect(screen.queryByRole("dialog", { name: "AI チャット" })).toBeNull();
    expect(
      calls.filter((call) => call.url.startsWith("/api/app/conversations")),
    ).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "AI に質問" }));
    expect(
      await screen.findByRole("dialog", { name: "AI チャット" }),
    ).toBeTruthy();
    await waitFor(() =>
      expect(
        calls.filter(
          (call) =>
            call.method === "POST" && call.url === "/api/app/conversations",
        ),
      ).toHaveLength(1),
    );
    const listCalls = calls.filter(
      (call) =>
        call.method === "GET" && call.url.startsWith("/api/app/conversations?"),
    );
    expect(listCalls.map((call) => call.url)).toEqual([
      `/api/app/conversations?targetContentId=${WEEK2_ID}`,
    ]);
    const created = calls.find(
      (call) => call.method === "POST" && call.url === "/api/app/conversations",
    );
    const body = JSON.parse(created?.body ?? "null") as { target?: unknown };
    expect(body.target).toEqual({ kind: "page", contentId: WEEK2_ID });
  });
});
