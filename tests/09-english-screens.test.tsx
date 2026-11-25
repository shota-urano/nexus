// @vitest-environment jsdom
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDeviceApiContext } from "../src/app/api/_entry/device-api";
import {
  type EnglishLearningApiContext,
  listEnglishSets,
} from "../src/app/api/_entry/english-learning";
import type { EnglishSetDetail, Reading } from "../src/contracts/english";
import { EnglishListScreen } from "../src/screens/english/english-list-screen";
import { EnglishStudy } from "../src/screens/english/english-study";
import { EnglishStudyScreen } from "../src/screens/english/english-study-screen";
import { autoGrade } from "../src/screens/english/grading";
import { ENGLISH_MESSAGES } from "../src/screens/english/messages";
import { createDeviceKeyVerifier } from "../src/server/auth/device-key";
import {
  type Database,
  databasePath,
  openDatabase,
} from "../src/server/db/connection";
import { createEnglishLearning } from "../src/server/kinds/english/learning";
import { createFakeClock } from "../src/server/shared/clock";
import { createLogger } from "../src/server/shared/logger";
import { MESSAGES } from "../src/server/shared/messages";
import { createSecret, hashSecret } from "../src/server/shared/secret";
import { EnglishMaterial } from "../src/ui/kinds/english/lesson";
import { NOW, migrate } from "./fixtures/news";

// 09-english の実装単位2: 教材の一覧と学習の画面 M04（教材、問題、採点の段と自動の採点）と、
// 英語の表示部品 M08（SCR-004、SCR-005、FN-010、FN-011）。
// 受け入れ基準は DD-10 TC39、TC41、TC42、TC43、TC44。

const ORIGIN = "http://localhost:48401";

// 教材の本文。「## 読む」の節に、読む教材と同じ英文がある（BD-13 P07）。
const LESSON_MD = [
  "# 現在形",
  "",
  "習慣を表す。",
  "",
  "## 読む",
  "",
  "I walk in the park every morning.",
  "",
  "## まとめ",
  "",
  "毎日の習慣に使う。",
].join("\n");

const READING: Reading = {
  date: "2026-12-01",
  format: "story",
  title: "A Morning Walk",
  scene: "朝の公園",
  summary: "朝の散歩",
  paragraphs: [
    {
      sentences: [
        {
          en: "I walk in the park every morning.",
          ja: "私は毎朝公園を歩く。",
          notes: [
            { text: "every morning", kind: "phrase", ja: "毎朝" },
            { text: "walk", kind: "word", ja: "歩く" },
          ],
        },
        {
          en: "It makes me happy.",
          ja: "それは私を幸せにする。",
          notes: [],
        },
      ],
    },
  ],
};

// D1 の E1（DD-10 3章）: 2026-12-01、問題 3 問（choice、text、answerType なし）、読む教材あり、
// 答えなし。
function e1(): EnglishSetDetail {
  return {
    contentId: 7,
    learningTheme: "現在形の使い方",
    targetDate: "2026-12-01",
    lessonMd: LESSON_MD,
    problems: [
      {
        no: 1,
        kind: "quiz",
        questionMd: "正しいものを選ぶ",
        answerMd: "正解は b",
        answerType: "choice",
        expected: "b",
        choices: ["a", "b", "c"],
      },
      {
        no: 2,
        kind: "quiz",
        questionMd: "語を書く",
        answerMd: "正解は walk",
        answerType: "text",
        expected: "walk",
      },
      { no: 3, kind: "quiz", questionMd: "訳す", answerMd: "私は歩く。" },
    ],
    closingMd: "また明日。",
    reading: READING,
    state: { contentId: 7, isNew: true, isRead: false, isSaved: false },
    lastAnswer: null,
  };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(() => {
    throw new Error("API を呼んではいけない");
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("TC39 セットが無い DB で、一覧が空になり、画面に MSG-004 が出る", () => {
  let dir: string;
  let db: Database;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(NOW));
    dir = mkdtempSync(join(tmpdir(), "nexus-09-screens-"));
    db = openDatabase(databasePath(dir));
    migrate(db);
  });

  afterEach(() => {
    if (db.isOpen) db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("listEnglishSets は items が空で、M04 の一覧の部品は MSG-004 を出す", async () => {
    const clock = createFakeClock(NOW);
    const key = createSecret();
    db.prepare(
      "INSERT INTO device (device_name, device_key_hash, registered_at, last_used_at) VALUES ('ipad', ?, ?, ?)",
    ).run(hashSecret(key), "2026-11-20T09:00:00.000+09:00", NOW);
    const context: EnglishLearningApiContext = {
      deviceApi: createDeviceApiContext({
        clock,
        logger: createLogger({
          process: "web",
          clock,
          dir: join(dir, "logs"),
        }),
        origin: ORIGIN,
        deviceKeys: createDeviceKeyVerifier({ db, clock }),
      }),
      english: createEnglishLearning({ db, clock }),
    };
    const handle = listEnglishSets(context);
    const call = (input: RequestInfo | URL) => {
      const url = new URL(String(input), ORIGIN);
      expect(url.pathname).toBe("/api/app/english/sets");
      return handle(
        new Request(url, { headers: { cookie: `nexus_device=${key}` } }),
      );
    };

    const response = await call("/api/app/english/sets");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ items: [], nextCursor: null });

    fetchMock.mockImplementation(call);
    render(<EnglishListScreen />);
    expect(await screen.findByText(ENGLISH_MESSAGES["MSG-004"])).toBeTruthy();
    expect(screen.queryByRole("listitem")).toBeNull();
  });
});

describe("TC41 読む教材があるときは「## 読む」の節を出さない（M08）", () => {
  it("読む教材がある教材では節が出ず、本文の後に読む教材が出る", () => {
    const { container } = render(
      <EnglishMaterial lessonMd={LESSON_MD} reading={READING} />,
    );
    const lesson = screen.getByRole("region", { name: "教材の本文" });
    expect(within(lesson).queryByRole("heading", { name: "読む" })).toBeNull();
    expect(lesson.textContent).not.toContain("I walk in the park");
    // 「## 読む」の次の節は出す。
    expect(
      within(lesson).getByRole("heading", { name: "まとめ" }),
    ).toBeTruthy();
    expect(lesson.textContent).toContain("毎日の習慣に使う。");

    const reading = screen.getByRole("region", { name: "読む教材" });
    expect(reading.textContent).toContain("A Morning Walk");
    expect(reading.textContent).toContain("朝の公園");
    expect(reading.textContent).toContain("every morning");
    // 本文の後に読む教材が出る。
    expect(
      lesson.compareDocumentPosition(reading) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // 英文は1か所だけに出る。
    expect(
      container.textContent?.split("I walk in the park").length,
    ).toBeLessThanOrEqual(2);
  });

  it("読む教材が無い教材では節が出る", () => {
    render(<EnglishMaterial lessonMd={LESSON_MD} reading={null} />);
    const lesson = screen.getByRole("region", { name: "教材の本文" });
    expect(within(lesson).getByRole("heading", { name: "読む" })).toBeTruthy();
    expect(lesson.textContent).toContain("I walk in the park every morning.");
    expect(
      within(lesson).getByRole("heading", { name: "まとめ" }),
    ).toBeTruthy();
    expect(screen.queryByRole("region", { name: "読む教材" })).toBeNull();
  });

  it("「## 読む」の節が本文の終わりにあるときは、終わりまで出さない", () => {
    render(
      <EnglishMaterial
        lessonMd={"# 題\n\n前の節。\n\n## 読む\n\nI walk."}
        reading={READING}
      />,
    );
    const lesson = screen.getByRole("region", { name: "教材の本文" });
    expect(lesson.textContent).toContain("前の節。");
    expect(lesson.textContent).not.toContain("I walk.");
  });
});

describe("TC42 注のある語句を押すと、その注の説明が出る（AI も API も呼ばない）", () => {
  it("M04 の学習の部品に E1 を渡し、語句を押すと説明が出て、API の呼び出しは0回", () => {
    render(<EnglishStudy set={e1()} />);
    expect(screen.queryByRole("tooltip")).toBeNull();

    fireEvent.click(screen.getByText("every morning"));
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip.textContent).toContain("熟語");
    expect(tooltip.textContent).toContain("毎朝");

    fireEvent.click(screen.getByText("walk"));
    const next = screen.getByRole("tooltip");
    expect(next.textContent).toContain("単語");
    expect(next.textContent).toContain("歩く");
    expect(screen.getAllByRole("tooltip")).toHaveLength(1);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("文の注の無い所を押すと、その文の和訳を下に出す", () => {
    render(<EnglishStudy set={e1()} />);
    fireEvent.click(screen.getByText("It makes me happy."));
    expect(screen.getByRole("note").textContent).toContain(
      "それは私を幸せにする。",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("TC43 自動の採点の比べ方（DD-02 FN-011 の表）", () => {
  it("○、○、○、×、×、×。answerType なしの問題は付かない", () => {
    const choice = { answerType: "choice" as const, expected: "b" };
    const number = { answerType: "number" as const, expected: "12.5" };
    const text = { answerType: "text" as const, expected: "abc" };
    expect(autoGrade(choice, "b")).toBe("o");
    expect(autoGrade(number, "12.50")).toBe("o");
    expect(autoGrade(text, "ＡＢｃ ")).toBe("o");
    expect(autoGrade(choice, "a")).toBe("x");
    expect(autoGrade(number, "abc")).toBe("x");
    expect(autoGrade(text, "")).toBe("x");
    expect(autoGrade({ answerType: null, expected: null }, "何か")).toBeNull();
    expect(autoGrade({}, "何か")).toBeNull();
  });

  it("number は十進の数の値を桁を落とさずに比べる", () => {
    const big = { answerType: "number" as const, expected: "9007199254740992" };
    expect(autoGrade(big, "9007199254740993")).toBe("x");
    expect(autoGrade(big, "9007199254740992.0")).toBe("o");
    expect(
      autoGrade(
        { answerType: "number", expected: "0.1" },
        "0.10000000000000000001",
      ),
    ).toBe("x");
    expect(
      autoGrade({ answerType: "number", expected: "1.5" }, " +01.50 "),
    ).toBe("o");
    expect(autoGrade({ answerType: "number", expected: "0" }, "-0.0")).toBe(
      "o",
    );
    expect(autoGrade({ answerType: "number", expected: "0.5" }, ".5")).toBe(
      "o",
    );
    expect(autoGrade({ answerType: "number", expected: "5" }, "5.")).toBe("o");
    expect(autoGrade({ answerType: "number", expected: "-2" }, "2")).toBe("x");
    expect(autoGrade({ answerType: "number", expected: "1" }, ".")).toBe("x");
    expect(autoGrade({ answerType: "number", expected: "100" }, "1e2")).toBe(
      "x",
    );
  });

  it("どの答えの形でも、未回答は ×", () => {
    for (const answerType of ["choice", "number", "text"] as const) {
      expect(autoGrade({ answerType, expected: "1" }, undefined)).toBe("x");
      expect(autoGrade({ answerType, expected: "1" }, "  ")).toBe("x");
    }
  });

  it("採点の段へ進むと、答えの形を持つ問題に ○ か × が付き、無い問題は付かない", () => {
    render(<EnglishStudy set={e1()} />);
    fireEvent.click(screen.getByRole("button", { name: "問題へ" }));
    fireEvent.click(screen.getByRole("radio", { name: "b" }));
    fireEvent.click(screen.getByRole("button", { name: "次の問題" }));
    fireEvent.change(screen.getByRole("textbox", { name: "問題 2 の答え" }), {
      target: { value: "Walks" },
    });
    fireEvent.click(screen.getByRole("button", { name: "採点へ" }));

    const pressed = (no: number) =>
      within(screen.getByRole("group", { name: `問題 ${no} の採点` }))
        .queryAllByRole("button", { pressed: true })
        .map((button) => button.textContent);
    expect(pressed(1)).toEqual(["○"]);
    expect(pressed(2)).toEqual(["×"]);
    expect(pressed(3)).toEqual([]);

    // ○△× を押すと替わる（SCR-005-A06）。
    fireEvent.click(
      within(screen.getByRole("group", { name: "問題 3 の採点" })).getByRole(
        "button",
        { name: "△" },
      ),
    );
    expect(pressed(3)).toEqual(["△"]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("TC44 段は教材 → 問題 → 採点で、戻っても答えが残り、先へは飛ばせない", () => {
  const currentStage = () =>
    within(screen.getByRole("list", { name: "今の段" }))
      .getAllByRole("listitem")
      .find((item) => item.getAttribute("aria-current") === "step")
      ?.textContent;

  it("問題へ進み、答えを入れ、教材へ戻り、もう一度問題へ進むと答えが残っている", () => {
    render(<EnglishStudy set={e1()} />);
    expect(currentStage()).toBe("① 教材");

    fireEvent.click(screen.getByRole("button", { name: "問題へ" }));
    expect(currentStage()).toBe("② 問題");
    fireEvent.click(screen.getByRole("radio", { name: "c" }));
    fireEvent.click(screen.getByRole("button", { name: "次の問題" }));
    fireEvent.change(screen.getByRole("textbox", { name: "問題 2 の答え" }), {
      target: { value: "walk" },
    });

    fireEvent.click(screen.getByRole("button", { name: "教材へ戻る" }));
    expect(currentStage()).toBe("① 教材");
    expect(screen.queryByRole("textbox")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "問題へ" }));
    expect(currentStage()).toBe("② 問題");
    // 戻る前に見ていた問題 2 から続く。
    expect(
      (
        screen.getByRole("textbox", {
          name: "問題 2 の答え",
        }) as HTMLInputElement
      ).value,
    ).toBe("walk");
    fireEvent.click(screen.getByRole("button", { name: "前の問題" }));
    expect(
      (screen.getByRole("radio", { name: "c" }) as HTMLInputElement).checked,
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "次の問題" }));

    // 採点の段から問題の段へ戻っても答えは残る（SCR-005-A10）。
    fireEvent.click(screen.getByRole("button", { name: "採点へ" }));
    expect(currentStage()).toBe("③ 採点");
    expect(screen.getByText("また明日。")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "問題へ戻る" }));
    expect(currentStage()).toBe("② 問題");
    expect(
      (
        screen.getByRole("textbox", {
          name: "問題 2 の答え",
        }) as HTMLInputElement
      ).value,
    ).toBe("walk");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("教材の段から採点の段へ直接は進めない", () => {
    render(<EnglishStudy set={e1()} />);
    // 押せるものは「問題へ」と、読む教材の文と語句だけで、採点の段へ進む操作は無い。
    expect(screen.queryByRole("button", { name: "採点へ" })).toBeNull();
    const stageMarks = within(screen.getByRole("list", { name: "今の段" }));
    expect(stageMarks.queryAllByRole("button")).toHaveLength(0);
    expect(stageMarks.queryAllByRole("link")).toHaveLength(0);
    fireEvent.click(stageMarks.getByText("③ 採点"));
    expect(currentStage()).toBe("① 教材");

    const buttons = screen
      .getAllByRole("button")
      .filter((button) => button.tagName === "BUTTON");
    expect(buttons.map((button) => button.textContent)).toEqual(["問題へ"]);
    for (const button of screen.getAllByRole("button")) {
      fireEvent.click(button);
      if (currentStage() !== "① 教材") break;
    }
    expect(currentStage()).not.toBe("③ 採点");
  });
});

describe("答えの欄（SCR-005-I01）", () => {
  it("答えの形の無い問題と、手元で解く問題は欄を出さない。答えは 500 文字まで", () => {
    const set = e1();
    set.problems.push({
      no: 4,
      kind: "code",
      questionMd: "手元で解く",
      answerMd: "解説",
      answerType: "text",
      expected: "x",
    });
    render(<EnglishStudy set={set} />);
    fireEvent.click(screen.getByRole("button", { name: "問題へ" }));
    fireEvent.click(screen.getByRole("button", { name: "次の問題" }));
    const field = screen.getByRole("textbox", {
      name: "問題 2 の答え",
    }) as HTMLInputElement;
    fireEvent.change(field, { target: { value: "あ".repeat(500) } });
    expect([...field.value]).toHaveLength(500);
    fireEvent.change(field, { target: { value: "あ".repeat(501) } });
    expect([...field.value]).toHaveLength(500);

    fireEvent.click(screen.getByRole("button", { name: "次の問題" }));
    expect(screen.getByText("訳す")).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "次の問題" }));
    expect(screen.getByText("手元で解く")).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("前に完了していれば、その答えを初めの値にする", () => {
    const set = e1();
    set.lastAnswer = {
      contentId: 7,
      grades: [
        { no: 1, grade: "o", answer: "b" },
        { no: 2, grade: "d", answer: "walks" },
        { no: 3, grade: "x" },
      ],
      completedAt: "2026-11-30T21:15:00.000+09:00",
    };
    render(<EnglishStudy set={set} />);
    fireEvent.click(screen.getByRole("button", { name: "問題へ" }));
    expect(
      (screen.getByRole("radio", { name: "b" }) as HTMLInputElement).checked,
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "次の問題" }));
    expect(
      (
        screen.getByRole("textbox", {
          name: "問題 2 の答え",
        }) as HTMLInputElement
      ).value,
    ).toBe("walks");
  });
});

describe("完了したことのある教材（BD-02 FN-009 代替の流れ、SCR-005-A01・A11）", () => {
  function completed(): EnglishSetDetail {
    const set = e1();
    set.lastAnswer = {
      contentId: 7,
      grades: [
        { no: 1, grade: "o", answer: "b" },
        { no: 2, grade: "x", answer: "walks" },
        { no: 3, grade: "d" },
      ],
      completedAt: "2026-11-30T21:15:00.000+09:00",
    };
    return set;
  }

  it("教材の段に前の答えと採点と「やり直す」を出す", () => {
    render(<EnglishStudy set={completed()} />);
    const last = screen.getByRole("region", { name: "前の答えと採点" });
    const items = within(last).getAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "問題 1: ○（あなたの答え: b）",
      "問題 2: ×（あなたの答え: walks）",
      "問題 3: △",
    ]);
    expect(screen.getByRole("button", { name: "やり直す" })).toBeTruthy();
  });

  it("完了したことが無ければ、前の答えと採点も「やり直す」も出さない", () => {
    render(<EnglishStudy set={e1()} />);
    expect(screen.queryByRole("region", { name: "前の答えと採点" })).toBeNull();
    expect(screen.queryByRole("button", { name: "やり直す" })).toBeNull();
  });

  it("「やり直す」で、前の答えを初めの値にして問題の段の1問目から始め直す", () => {
    render(<EnglishStudy set={completed()} />);
    // 一度問題の段で答えを変えて教材へ戻ってから、やり直す。
    fireEvent.click(screen.getByRole("button", { name: "問題へ" }));
    fireEvent.click(screen.getByRole("button", { name: "次の問題" }));
    fireEvent.change(screen.getByRole("textbox", { name: "問題 2 の答え" }), {
      target: { value: "walk" },
    });
    fireEvent.click(screen.getByRole("button", { name: "教材へ戻る" }));
    fireEvent.click(screen.getByRole("button", { name: "やり直す" }));

    expect(screen.getByRole("region", { name: "問題の段" })).toBeTruthy();
    expect(screen.getByText("問題 1 / 3")).toBeTruthy();
    expect(
      (screen.getByRole("radio", { name: "b" }) as HTMLInputElement).checked,
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "次の問題" }));
    expect(
      (
        screen.getByRole("textbox", {
          name: "問題 2 の答え",
        }) as HTMLInputElement
      ).value,
    ).toBe("walks");
  });

  it("採点の段では、答えの形の無い問題に前の採点を残し、答えの形のある問題は自動で付け直す", () => {
    render(<EnglishStudy set={completed()} />);
    fireEvent.click(screen.getByRole("button", { name: "やり直す" }));
    fireEvent.click(screen.getByRole("button", { name: "採点へ" }));
    const pressed = (no: number) =>
      within(screen.getByRole("group", { name: `問題 ${no} の採点` }))
        .getAllByRole("button")
        .filter((button) => button.getAttribute("aria-pressed") === "true")
        .map((button) => button.textContent);
    expect(pressed(1)).toEqual(["○"]);
    expect(pressed(2)).toEqual(["×"]);
    expect(pressed(3)).toEqual(["△"]);
  });
});

describe("SCR-005-A01 画面を開いたとき", () => {
  it("教材を読んで教材の段を出し、出した後に markOpened を1回呼ぶ", async () => {
    fetchMock.mockImplementation(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input);
        if (path === "/api/app/english/sets/7" && !init?.method) {
          return Response.json(e1());
        }
        if (path === "/api/app/contents/7/opened" && init?.method === "POST") {
          return Response.json({
            contentId: 7,
            isNew: false,
            isRead: false,
            isSaved: false,
          });
        }
        throw new Error(`知らない呼び出し: ${path}`);
      },
    );
    render(<EnglishStudyScreen contentId={7} />);
    expect(await screen.findByText("現在形の使い方")).toBeTruthy();
    expect(screen.getByRole("region", { name: "教材の段" })).toBeTruthy();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(String(fetchMock.mock.calls[1][0])).toBe(
      "/api/app/contents/7/opened",
    );
  });

  it("教材が無ければ MSG-019 を出し、markOpened を呼ばない", async () => {
    fetchMock.mockImplementation(async () =>
      Response.json({ error: "not_found" }, { status: 404 }),
    );
    render(<EnglishStudyScreen contentId={99} />);
    expect(await screen.findByText(ENGLISH_MESSAGES["MSG-019"])).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("M04 の MSG の文言", () => {
  it("サーバの側の MSG の一覧（M23）と同じ", () => {
    for (const [id, text] of Object.entries(ENGLISH_MESSAGES)) {
      expect(text).toBe(MESSAGES[id as keyof typeof MESSAGES].text);
    }
  });
});
