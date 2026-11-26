// @vitest-environment jsdom
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ChatMessage,
  Conversation,
  QuestionTarget,
} from "../src/contracts/chat";
import { ChatSheet } from "../src/screens/chat/chat-sheet";

// 10-chat の実装単位10（CR-017）。AI チャットの面 M06（src/screens/chat）。
// 受け入れ基準:
// - DD-10 TC75 が通る（tests/10-chat-screen.test.tsx）。
// - 面を開いたときの API の呼び出しが `listConversations` 1回と、一番新しい会話の
//   `getConversation` 1回だけである（前の会話の書き出しは `firstQuestionText` から取る）。
// - 面の色の値が Tailwind の設定のファイルの値を使い、部品の中に直に書いていない
//   （DD-01 3章 Tailwind CSS の決まり）。

const ROOT = resolve(__dirname, "..");
const NOW = new Date("2026-11-25T03:00:00.000Z"); // 日本時間 2026-11-25 12:00
const TARGET: QuestionTarget = { kind: "article", contentId: 7 };
const LIST_KEY = "GET /api/app/conversations?targetContentId=7";

function conversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    conversationId: 1,
    target: TARGET,
    targetTitle: "記事の見出し",
    startedAt: "2026-11-24T05:00:00.000+09:00",
    lastSpokenAt: "2026-11-24T05:30:00.000+09:00",
    ...overrides,
  };
}

function message(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    messageId: 10,
    conversationId: 1,
    speaker: "owner",
    bodyMd: "最初の質問",
    sentAt: "2026-11-24T05:30:00.000+09:00",
    replyState: null,
    replyToMessageId: null,
    notice: null,
    ...overrides,
  };
}

function aiMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return message({
    messageId: 11,
    speaker: "ai",
    bodyMd: "AI の応答",
    replyState: "done",
    replyToMessageId: 10,
    ...overrides,
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

// `METHOD path` ごとに応答を決める。決めていない呼び出しは 500。
function stubFetch(routes: Record<string, () => Response | Promise<Response>>) {
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${String(input)}`;
    const route = routes[key];
    return route ? route() : jsonResponse({}, 500);
  });
  vi.stubGlobal("fetch", fetchMock);
}

function calledKeys(): string[] {
  return fetchMock.mock.calls.map(
    ([input, init]) =>
      `${(init as RequestInit | undefined)?.method ?? "GET"} ${String(input)}`,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("面を開いたときの API の呼び出し（CR-017、DD-02 FN-014）", () => {
  it("listConversations 1回と、一番新しい会話の getConversation 1回だけを呼び、前の会話の書き出しは firstQuestionText から取る", async () => {
    stubFetch({
      [LIST_KEY]: () =>
        jsonResponse({
          items: [
            conversation({ firstQuestionText: "最初の質問" }),
            conversation({
              conversationId: 2,
              lastSpokenAt: "2026-11-23T08:00:00.000+09:00",
              firstQuestionText: "二つ目の会話の質問",
            }),
            conversation({
              conversationId: 3,
              lastSpokenAt: "2025-12-31T23:59:00.000+09:00",
              firstQuestionText: null,
            }),
          ],
          nextCursor: null,
        }),
      "GET /api/app/conversations/1": () =>
        jsonResponse({
          conversation: conversation({ firstQuestionText: "最初の質問" }),
          messages: [message(), aiMessage()],
        }),
      "GET /api/app/conversations/2": () =>
        jsonResponse({
          conversation: conversation({ conversationId: 2 }),
          messages: [message({ messageId: 20, conversationId: 2 })],
        }),
      "GET /api/app/conversations/3": () =>
        jsonResponse({
          conversation: conversation({ conversationId: 3 }),
          messages: [],
        }),
    });
    render(<ChatSheet open onClose={() => {}} target={TARGET} />);
    await screen.findByText("AI の応答");
    const select = screen.getByRole("combobox", {
      name: "前の会話",
    }) as HTMLSelectElement;
    await waitFor(() =>
      expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
        "最初の質問（11月24日（火） 05:30）",
        "二つ目の会話の質問（11月23日（月） 08:00）",
        "新しい会話（2025年12月31日 23:59）",
      ]),
    );
    expect(select.value).toBe("1");
    // 遅れて呼ぶ処理が残っていないかを見るため、少し待ってから数える。
    await new Promise((r) => setTimeout(r, 100));
    expect(calledKeys()).toEqual([LIST_KEY, "GET /api/app/conversations/1"]);
  });
});

// ---- 色の値の確かめ（DD-01 3章 Tailwind CSS の決まり） ----

// Tailwind に組み込みの色の名前（node_modules/tailwindcss/theme.css の --color-*）。
// これはプロジェクトの設定のファイルの値ではない。
function defaultColorNames(): Set<string> {
  const css = readFileSync(
    join(ROOT, "node_modules/tailwindcss/theme.css"),
    "utf8",
  );
  return new Set(
    [...css.matchAll(/--color-([a-z0-9-]+)\s*:/g)].map((m) => m[1]),
  );
}

function listFiles(dir: string, pattern: RegExp): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return listFiles(path, pattern);
    return pattern.test(name) ? [path] : [];
  });
}

function flattenColors(
  value: unknown,
  prefix: string,
  into: Set<string>,
): void {
  if (typeof value === "string") {
    into.add(prefix);
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      const name =
        key === "DEFAULT" ? prefix : prefix ? `${prefix}-${key}` : key;
      flattenColors(child, name, into);
    }
  }
}

// プロジェクトの Tailwind の設定のファイルが決める色の名前。
// Tailwind v4 の CSS の設定（src の CSS の @theme の --color-*）と、
// @config で読む JS/TS の設定のファイル（theme.colors、theme.extend.colors）の両方を見る。
async function projectColorNames(): Promise<Set<string>> {
  const names = new Set<string>();
  for (const file of listFiles(join(ROOT, "src"), /\.css$/)) {
    const css = readFileSync(file, "utf8");
    for (const block of css.matchAll(/@theme[^{]*\{([\s\S]*?)\}/g)) {
      for (const m of block[1].matchAll(/--color-([a-z0-9-]+)\s*:/g)) {
        if (m[1] !== "*") names.add(m[1]);
      }
    }
    for (const m of css.matchAll(/@config\s+["']([^"']+)["']/g)) {
      const configPath = resolve(dirname(file), m[1]);
      const loaded = (await import(pathToFileURL(configPath).href)) as {
        default?: { theme?: Record<string, unknown> };
      };
      const theme = loaded.default?.theme ?? {};
      flattenColors(theme.colors, "", names);
      flattenColors(
        (theme.extend as Record<string, unknown> | undefined)?.colors,
        "",
        names,
      );
    }
  }
  return names;
}

// 色を取るユーティリティの頭（長いものから当てる）。
const COLOR_PREFIXES = [
  "inset-shadow",
  "inset-ring",
  "drop-shadow",
  "ring-offset",
  "decoration",
  "outline",
  "border-x",
  "border-y",
  "border-t",
  "border-r",
  "border-b",
  "border-l",
  "border-s",
  "border-e",
  "border",
  "divide",
  "shadow",
  "accent",
  "stroke",
  "caret",
  "ring",
  "fill",
  "text",
  "from",
  "via",
  "bg",
  "to",
];
const COLOR_KEYWORDS = new Set(["transparent", "current", "inherit"]);
const COLOR_LITERAL =
  /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|hwb|oklch|oklab|lab|lch|color|color-mix)\(/;

interface ColorUse {
  className: string;
  kind: "project" | "default" | "literal";
}

function classifyClass(
  raw: string,
  project: Set<string>,
  defaults: Set<string>,
): ColorUse | null {
  // 変形の印（hover: など）と、重要の印（!）と、不透明度（/50）を外す。
  let name = raw.split(":").pop() ?? raw;
  name = name.replace(/^!|!$/g, "");
  if (COLOR_LITERAL.test(raw)) return { className: raw, kind: "literal" };
  for (const prefix of COLOR_PREFIXES) {
    if (!name.startsWith(`${prefix}-`)) continue;
    let value = name.slice(prefix.length + 1);
    // 任意の値（[...] か (...)）は、var(--color-x) か (--color-x) のときだけ色として見る。
    const variable = value.match(/^[[(](?:var\()?--color-([a-z0-9-]+)\)?[\])]/);
    if (variable) {
      return {
        className: raw,
        kind: project.has(variable[1]) ? "project" : "default",
      };
    }
    value = value.replace(/\/[^/]+$/, "");
    if (COLOR_KEYWORDS.has(value)) return null;
    if (project.has(value)) return { className: raw, kind: "project" };
    if (defaults.has(value)) return { className: raw, kind: "default" };
    return null;
  }
  return null;
}

const STYLE_COLOR_PROPERTIES = [
  "color",
  "background",
  "background-color",
  "background-image",
  "border",
  "border-color",
  "border-top-color",
  "border-right-color",
  "border-bottom-color",
  "border-left-color",
  "outline-color",
  "box-shadow",
  "text-shadow",
  "fill",
  "stroke",
  "caret-color",
  "accent-color",
];

// 面の部品のソース: chat-sheet.tsx から相対の import でたどれる src/screens/chat と src/ui のファイル。
function chatSourceFiles(): string[] {
  const allowed = [join(ROOT, "src/screens/chat"), join(ROOT, "src/ui")];
  const seen = new Set<string>();
  const queue = [join(ROOT, "src/screens/chat/chat-sheet.tsx")];
  while (queue.length > 0) {
    const file = queue.shift() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(file, "utf8");
    for (const m of source.matchAll(/from\s+["'](\.[^"']+)["']/g)) {
      const base = resolve(dirname(file), m[1]);
      const candidates = [
        base,
        `${base}.tsx`,
        `${base}.ts`,
        join(base, "index.tsx"),
        join(base, "index.ts"),
      ];
      const found = candidates.find(
        (path) => existsSync(path) && statSync(path).isFile(),
      );
      if (found && allowed.some((dir) => found.startsWith(dir))) {
        queue.push(found);
      }
    }
  }
  return [...seen];
}

function renderAllStates() {
  stubFetch({
    [LIST_KEY]: () =>
      jsonResponse({
        items: [conversation({ firstQuestionText: "最初の質問" })],
        nextCursor: null,
      }),
    "GET /api/app/conversations/1": () =>
      jsonResponse({
        conversation: conversation(),
        messages: [
          message({ messageId: 1 }),
          aiMessage({ messageId: 2, replyState: "done", bodyMd: "完了" }),
          message({ messageId: 3, bodyMd: "質問2" }),
          aiMessage({
            messageId: 4,
            replyState: "failed",
            bodyMd: "失敗",
            notice: "MSG-012",
          }),
          message({ messageId: 5, bodyMd: "質問3" }),
          aiMessage({
            messageId: 8,
            replyState: "cancelled",
            bodyMd: "中止",
            notice: "MSG-014",
          }),
          message({ messageId: 9, bodyMd: "質問4" }),
          aiMessage({ messageId: 12, replyState: "writing", bodyMd: "作成中" }),
        ],
      }),
    "GET /api/app/messages/12/stream": () => new Promise<Response>(() => {}),
  });
  return render(<ChatSheet open onClose={() => {}} target={TARGET} />);
}

describe("面の色の値（DD-01 3章 Tailwind CSS の決まり、BD-13 の試作 prototype/components/Chat.tsx）", () => {
  it("面に出る要素の色のクラスは、すべて Tailwind の設定のファイルが決めた色を使い、組み込みの色や任意の値を使わない", async () => {
    const project = await projectColorNames();
    const defaults = defaultColorNames();
    renderAllStates();
    await screen.findByText("作成中");
    const dialog = screen.getByRole("dialog", { name: "AI チャット" });
    const elements = [dialog, ...Array.from(dialog.querySelectorAll("*"))];
    const uses = elements.flatMap((element) =>
      (element.getAttribute("class") ?? "")
        .split(/\s+/)
        .filter(Boolean)
        .map((name) => classifyClass(name, project, defaults))
        .filter((use): use is ColorUse => use !== null),
    );
    const violations = uses.filter((use) => use.kind !== "project");
    expect(violations.map((use) => use.className)).toEqual([]);
    // 面には色が付いている（試作の暗い土台とアンバーの光）。その色は設定のファイルから取る。
    expect(project.size).toBeGreaterThan(0);
    expect(uses.filter((use) => use.kind === "project").length).toBeGreaterThan(
      0,
    );
    // 面の土台（role="dialog" の要素）の背景の色も、設定のファイルの色で付ける。
    const dialogBackground = (dialog.getAttribute("class") ?? "")
      .split(/\s+/)
      .map((name) => ({ name, use: classifyClass(name, project, defaults) }))
      .filter(
        ({ name, use }) => use?.kind === "project" && /(^|:)bg-/.test(name),
      );
    expect(dialogBackground.length).toBeGreaterThan(0);
  });

  it("面に出る要素の style に色を直に書いていない", async () => {
    renderAllStates();
    await screen.findByText("作成中");
    const dialog = screen.getByRole("dialog", { name: "AI チャット" });
    const elements = [dialog, ...Array.from(dialog.querySelectorAll("*"))];
    const inlineColors = elements.flatMap((element) => {
      const style = (element as HTMLElement).style;
      return STYLE_COLOR_PROPERTIES.filter(
        (property) => style.getPropertyValue(property) !== "",
      ).map(
        (property) =>
          `${element.tagName.toLowerCase()} ${property}: ${style.getPropertyValue(property)}`,
      );
    });
    expect(inlineColors).toEqual([]);
  });

  it("面の部品のソースに色の値（#rrggbb、rgb()、hsl()、oklch() など）を直に書いていない", () => {
    const files = chatSourceFiles();
    expect(files.some((file) => file.endsWith("chat-sheet.tsx"))).toBe(true);
    const found = files.flatMap((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .map((line, index) => ({ line, index }))
        .filter(({ line }) => COLOR_LITERAL.test(line))
        .map(
          ({ line, index }) =>
            `${file.slice(ROOT.length + 1)}:${index + 1}: ${line.trim()}`,
        ),
    );
    expect(found).toEqual([]);
  });
});
