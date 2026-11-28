// @vitest-environment jsdom
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

// 14-research の CR-024 の行（FN-027、DD-01 M08・M32、DD-02 FN-027 手順 7、BD-03 SCR-011 3.2 道のり・
// O12〜O14・A02、Q-101、Q-102）。課題の週報の画面 SCR-011 の道のり（1本の幹から枝が生えた木）と NEW。
// 受け入れ基準は DD-10 TC155（TC141 は tests/14-research-report-screen.test.tsx で、通るまま）。
//
// 部品の見分け方:
// - 道のりは `data-testid="roadmap"`。段は `data-testid="roadmap-step"` で、`data-step-no` に段の番号、
//   `data-state` に状態（done / doing / current / todo）を持つ。
// - ゴールは `data-testid="roadmap-goal"`、根元は `data-testid="roadmap-root"`。
// - 方法の節は `data-testid="roadmap-node"` で、`data-approach-no` と `data-side`（right / left）を持つ。
// - 幹の線は `data-testid="roadmap-trunk"` で、`data-line` が solid（根元から今ここまで）か dashed。
// - 段の NEW の数は `data-testid="step-new-count"`。
// - jsdom は CSS を計算しないので、幅は innerWidth と matchMedia を差し替えて決め、枝の向きは
//   `data-side` で確かめる。

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
    usePathname: () => `/research/${REPORT_ID}`,
    useSearchParams: () => new URLSearchParams(),
  };
});

const REPORT_ID = 21;
const NOW = new Date("2026-12-02T00:00:00.000Z");

type Mark = "added" | "more_sources" | "disputed";

function approach(
  no: number | null,
  step: number | null,
  title: string,
  marks: Mark[],
  seen = false,
) {
  return {
    title,
    howToMd: `${title}のやり方。`,
    sourceUrls: ["https://example.com/" + encodeURIComponent(title)],
    sourceCount: 1,
    marks,
    counterMd: null,
    no,
    step,
    seen,
  };
}

// 段3件（段1 できた、段2 今ここ、段3 まだ）。段2 に今週足した方法2件（no 1、2。no 2 は確かめ済み）と
// 出典が増えた方法1件、段1 に方法1件、段の無い方法1件。
const APPROACHES = [
  approach(1, 2, "候補を見せて人が選ぶ", ["added"]),
  approach(2, 2, "理由を書いてつなぐ", ["added"], true),
  approach(5, 2, "つながりを2つの軸で採点する", ["more_sources"]),
  approach(3, 1, "原文のまま残す", []),
  approach(9, null, "段に入らない方法", []),
];

const REPORT = {
  contentId: REPORT_ID,
  topicId: "second-brain",
  topicTitle: "第二の脳はどうやるのがよいか",
  week: 2,
  sentOn: "2026-12-01",
  status: "active",
  answerMd: "つながりは人が選ぶのがよい。",
  approaches: APPROACHES,
  unknownsMd: "良し悪しの測り方。",
  changesMd: "方法を1件足した。",
  receivedAt: "2026-12-01T07:30:00.000+09:00",
  state: {
    contentId: REPORT_ID,
    isNew: true,
    isRead: false,
    isSaved: false,
    savedAt: null,
  },
  weeks: [
    { contentId: REPORT_ID, week: 2, sentOn: "2026-12-01", isRead: false },
  ],
  steps: [
    { no: 1, title: "材料を原文のまま残す", status: "done" },
    { no: 2, title: "つながりの良し悪しを見分ける", status: "current" },
    { no: 3, title: "つながりからアイデアを出す", status: "todo" },
  ],
  stepChangesMd: "段3を2つに分ける案。",
};

// ---- 画面の幅 ----

let viewportWidth = 390;

function setViewport(width: number): void {
  viewportWidth = width;
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => {
      const min = /min-width\s*:\s*([\d.]+)px/.exec(query);
      return {
        matches: min ? viewportWidth >= Number(min[1]) : false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      };
    },
  });
}

// ---- 通信 ----

type Call = { url: string; method: string };
let calls: Call[];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function stubApi(): void {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const call = { url: String(input), method: init?.method ?? "GET" };
      calls.push(call);
      const key = `${call.method} ${call.url}`;
      if (key === `GET /api/app/research/reports/${REPORT_ID}`) {
        return jsonResponse(REPORT);
      }
      if (key === `POST /api/app/contents/${REPORT_ID}/opened`) {
        return jsonResponse({ ...REPORT.state, isNew: false });
      }
      const seen =
        /^POST \/api\/app\/research\/reports\/(\d+)\/approaches\/(\d+)\/seen$/.exec(
          key,
        );
      if (seen) {
        return jsonResponse({
          contentId: Number(seen[1]),
          no: Number(seen[2]),
          seenAt: "2026-12-02T09:00:00.000+09:00",
        });
      }
      return jsonResponse({ error: { code: "not_found" } }, 404);
    }),
  );
}

const seenCalls = () =>
  calls.filter((c) => c.method === "POST" && c.url.includes("/seen"));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  setViewport(390);
  stubApi();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function renderReport() {
  render(<ResearchReportScreen contentId={REPORT_ID} />);
  await screen.findByTestId("roadmap");
}

const steps = () => screen.getAllByTestId("roadmap-step");
const stepOf = (no: number) => {
  const found = steps().find((s) => s.dataset.stepNo === String(no));
  if (found === undefined) throw new Error(`段${no} が無い`);
  return found;
};
const nodeOf = (no: number) => {
  const found = screen
    .getAllByTestId("roadmap-node")
    .find((n) => n.dataset.approachNo === String(no));
  if (found === undefined) throw new Error(`方法${no} の節が無い`);
  return found;
};
const rowOf = (no: number) => {
  const row = nodeOf(no).querySelector<HTMLElement>("button[aria-expanded]");
  if (row === null) throw new Error(`方法${no} の行が押す場所でない`);
  return row;
};
const hasNewTag = (element: HTMLElement) =>
  Array.from(element.querySelectorAll("*")).some(
    (e) => e.textContent?.trim() === "NEW" && e.children.length === 0,
  );

function isBefore(a: Node, b: Node): boolean {
  return (
    (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
  );
}

describe("TC155 道のりの並びと段の状態（BD-03 SCR-011 3.2 道のり、O12〜O14）", () => {
  it("先頭に「今ここ: 段2 {中身}」を出し、節の順が 今ここ → 今週の変化 → 現時点の答え → 道のり → 段に入らない方法 → 段の変更の案 → まだ分かっていないこと", async () => {
    await renderReport();
    const here = screen.getByText("今ここ: 段2 つながりの良し悪しを見分ける");
    const order = [
      here,
      screen.getByText(REPORT.changesMd),
      screen.getByText(REPORT.answerMd),
      screen.getByTestId("roadmap"),
      screen.getByText("段に入らない方法", { selector: "h2" }),
      screen.getByText(REPORT.stepChangesMd),
      screen.getByText(REPORT.unknownsMd),
    ];
    for (let i = 1; i < order.length; i += 1) {
      expect(isBefore(order[i - 1], order[i]), `${i} 番目の順`).toBe(true);
    }
    expect(screen.getByText("段の変更の案")).toBeTruthy();
  });

  it("木は上から ゴール、段3、段2、段1、根元の順で、段ごとに状態の文字と data-state が出る", async () => {
    await renderReport();
    const goal = screen.getByTestId("roadmap-goal");
    const root = screen.getByTestId("roadmap-root");
    expect(goal.textContent).toContain("ゴール");
    expect(steps().map((s) => s.dataset.stepNo)).toEqual(["3", "2", "1"]);
    expect(isBefore(goal, stepOf(3))).toBe(true);
    expect(isBefore(stepOf(1), root)).toBe(true);
    const states: [number, string, string][] = [
      [1, "done", "できた"],
      [2, "current", "今ここ"],
      [3, "todo", "まだ"],
    ];
    for (const [no, state, label] of states) {
      const step = stepOf(no);
      expect(step.dataset.state).toBe(state);
      expect(step.textContent).toContain(`段${no}`);
      expect(step.textContent).toContain(label);
    }
  });

  it("幹は根元から今ここまでが実線、今ここより上が点線", async () => {
    await renderReport();
    const lineOf = (no: number) =>
      within(stepOf(no)).getAllByTestId("roadmap-trunk")[0].dataset.line;
    expect(lineOf(1)).toBe("solid");
    expect(lineOf(2)).toBe("solid");
    expect(lineOf(3)).toBe("dashed");
  });

  it("方法は段ごとに枝の先の節に出て、見出しの前に「方法N」を出す。段の無い方法は木の外に出る", async () => {
    await renderReport();
    for (const a of APPROACHES.filter((x) => x.step !== null)) {
      const node = nodeOf(a.no as number);
      expect(stepOf(a.step as number).contains(node), a.title).toBe(true);
      expect(node.textContent).toContain(`方法${a.no}`);
      expect(node.textContent).toContain(a.title);
    }
    const heading = screen.getByText("段に入らない方法", { selector: "h2" });
    const section = heading.closest("section");
    const outsideTitle = screen.getByText("段に入らない方法", {
      selector: "span",
    });
    expect(section?.contains(outsideTitle)).toBe(true);
    expect(screen.getByTestId("roadmap").contains(outsideTitle)).toBe(false);
    expect(
      screen
        .getAllByTestId("roadmap-node")
        .map((n) => n.dataset.approachNo)
        .sort(),
    ).toEqual(["1", "2", "3", "5"]);
  });
});

describe("TC155 NEW（Q-101 の答え。RD-03 R26、DD-02 FN-027 手順 7）", () => {
  it("段2 に「NEW 1」、方法1 に NEW のタグ。確かめ済みの方法2 と、今週足したでない方法には NEW が無い", async () => {
    await renderReport();
    expect(within(stepOf(2)).getByTestId("step-new-count").textContent).toMatch(
      /NEW\s*1/,
    );
    expect(within(stepOf(1)).queryByTestId("step-new-count")).toBeNull();
    expect(within(stepOf(3)).queryByTestId("step-new-count")).toBeNull();
    expect(hasNewTag(nodeOf(1))).toBe(true);
    expect(hasNewTag(nodeOf(2))).toBe(false);
    expect(hasNewTag(nodeOf(5))).toBe(false);
    expect(nodeOf(5).textContent).toContain("出典が増えた");
  });

  it("方法1 を押すと詳細が広がり、markApproachSeen が1回だけ呼ばれ、方法1 の NEW と段2 の NEW の数が消える。もう一度押すと閉じ、呼ばれない", async () => {
    await renderReport();
    fireEvent.click(rowOf(1));
    expect(
      within(nodeOf(1)).getByText("候補を見せて人が選ぶのやり方。"),
    ).toBeTruthy();
    await waitFor(() => expect(seenCalls()).toHaveLength(1));
    expect(seenCalls()[0].url).toBe(
      `/api/app/research/reports/${REPORT_ID}/approaches/1/seen`,
    );
    expect(hasNewTag(nodeOf(1))).toBe(false);
    expect(within(stepOf(2)).queryByTestId("step-new-count")).toBeNull();

    fireEvent.click(rowOf(1));
    expect(
      within(nodeOf(1)).queryByText("候補を見せて人が選ぶのやり方。"),
    ).toBeNull();
    fireEvent.click(rowOf(1));
    await Promise.resolve();
    expect(seenCalls()).toHaveLength(1);
  });

  it("確かめ済みの方法2 と、今週足したでない方法5 を押しても markApproachSeen は呼ばれない", async () => {
    await renderReport();
    fireEvent.click(rowOf(2));
    fireEvent.click(rowOf(5));
    await Promise.resolve();
    expect(seenCalls()).toHaveLength(0);
  });
});

describe("TC155 画面の幅と枝の向き（Q-102 の答え）", () => {
  it("幅 390 ピクセルでは、全ての節が幹の右に出る", async () => {
    setViewport(390);
    await renderReport();
    for (const node of screen.getAllByTestId("roadmap-node")) {
      expect(node.dataset.side, node.dataset.approachNo).toBe("right");
    }
  });

  it("幅 1180 ピクセルでは、段2 の節が送られた順に右、左、右と交互に出る", async () => {
    setViewport(1180);
    await renderReport();
    expect([1, 2, 5].map((no) => nodeOf(no).dataset.side)).toEqual([
      "right",
      "left",
      "right",
    ]);
  });
});

describe("TC155 段の欄の無い週報は今の方法の一覧のまま", () => {
  it("steps が空なら道のりも今ここの1行も出さず、方法の一覧を出す", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const key = `${init?.method ?? "GET"} ${String(input)}`;
        if (key === `GET /api/app/research/reports/${REPORT_ID}`) {
          return jsonResponse({
            ...REPORT,
            steps: [],
            stepChangesMd: null,
            approaches: APPROACHES.map((a) => ({ ...a, no: null, step: null })),
          });
        }
        return jsonResponse({ ...REPORT.state, isNew: false });
      }),
    );
    render(<ResearchReportScreen contentId={REPORT_ID} />);
    await screen.findByText(REPORT.changesMd);
    expect(screen.queryByTestId("roadmap")).toBeNull();
    expect(screen.queryByText(/^今ここ:/)).toBeNull();
    expect(screen.getByText(`方法の一覧（${APPROACHES.length}）`)).toBeTruthy();
    expect(screen.queryByText("段の変更の案")).toBeNull();
  });
});
