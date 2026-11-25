// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EnglishSetDetail } from "../src/contracts/english";
import { EnglishStudy } from "../src/screens/english/english-study";
import { ENGLISH_MESSAGES } from "../src/screens/english/messages";

// 09-english の実装単位3: 完了の確認（MSG-006）、失敗の知らせ（MSG-007）、二重送信の防止
// （SCR-005-A07、BD-09 5章、DD-05 4章）。受け入れ基準は DD-10 TC47、TC48、TC49。

const ANSWER_PATH = "/api/app/english/sets/7/answer";
const COMPLETED_AT = "2026-12-01T21:00:00.000+09:00";
const DONE_TEXT = "答えは翌朝の教材に反映されます。";

// D1 の E1（DD-10 3章）: 問題 3 問（choice、text、answerType なし）、答えなし。
function e1(): EnglishSetDetail {
  return {
    contentId: 7,
    learningTheme: "現在形の使い方",
    targetDate: "2026-12-01",
    lessonMd: "# 現在形\n\n習慣を表す。",
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
    closingMd: null,
    reading: null,
    state: { contentId: 7, isNew: false, isRead: true, isSaved: false },
    lastAnswer: null,
  };
}

// E2 に当たる、完了したことのある教材。
function completed(): EnglishSetDetail {
  const set = e1();
  set.lastAnswer = {
    contentId: 7,
    grades: [
      { no: 1, grade: "x", answer: "a" },
      { no: 2, grade: "x", answer: "walks" },
      { no: 3, grade: "d" },
    ],
    completedAt: "2026-11-30T21:15:00.000+09:00",
  };
  return set;
}

// 応答の本文。サーバと同じく、送った grades をそのまま返す。
async function echoAnswer(init: RequestInit | undefined): Promise<Response> {
  const body = JSON.parse(String(init?.body)) as { grades: unknown };
  return Response.json({
    contentId: 7,
    grades: body.grades,
    completedAt: COMPLETED_AT,
  });
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
  vi.unstubAllGlobals();
});

const completeButton = () => screen.getByRole("button", { name: "完了" });

function gradeOf(no: number, label: "○" | "△" | "×") {
  fireEvent.click(
    within(screen.getByRole("group", { name: `問題 ${no} の採点` })).getByRole(
      "button",
      { name: label },
    ),
  );
}

// 問題の段で答えを入れて採点の段へ進み、答えの形の無い問題 3 に ○ を付ける。
function answerAndGrade() {
  fireEvent.click(screen.getByRole("radio", { name: "b" }));
  fireEvent.click(screen.getByRole("button", { name: "次の問題" }));
  fireEvent.change(screen.getByRole("textbox", { name: "問題 2 の答え" }), {
    target: { value: "walk" },
  });
  fireEvent.click(screen.getByRole("button", { name: "採点へ" }));
  gradeOf(3, "○");
}

const NEW_GRADES = [
  { no: 1, grade: "o", answer: "b" },
  { no: 2, grade: "o", answer: "walk" },
  { no: 3, grade: "o" },
];

describe("TC47 完了した教材をやり直して「完了」を押すと MSG-006 で確かめる（FN-012 代替の流れ）", () => {
  it("「やめる」では API を呼ばず、「置き換える」で putEnglishAnswer が1回呼ばれ、前の答えが置き換わる", async () => {
    fetchMock.mockImplementation(
      (_input: RequestInfo | URL, init?: RequestInit) => echoAnswer(init),
    );
    render(<EnglishStudy set={completed()} />);
    fireEvent.click(screen.getByRole("button", { name: "やり直す" }));
    answerAndGrade();

    fireEvent.click(completeButton());
    const dialog = screen.getByRole("alertdialog");
    expect(dialog.textContent).toContain(ENGLISH_MESSAGES["MSG-006"]);
    fireEvent.click(within(dialog).getByRole("button", { name: "やめる" }));
    await vi.waitFor(() =>
      expect(screen.queryByRole("alertdialog")).toBeNull(),
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByText(DONE_TEXT)).toBeNull();

    fireEvent.click(completeButton());
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "置き換える",
      }),
    );
    expect(await screen.findByText(DONE_TEXT)).toBeTruthy();
    expect(screen.getByRole("img", { name: "完了した印" })).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [input, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(input)).toBe(ANSWER_PATH);
    expect(init.method).toBe("PUT");
    expect(JSON.parse(String(init.body))).toEqual({ grades: NEW_GRADES });

    // 教材の段の前の答えと採点は、残した答えに替わる。
    fireEvent.click(screen.getByRole("button", { name: "問題へ戻る" }));
    fireEvent.click(screen.getByRole("button", { name: "教材へ戻る" }));
    const last = screen.getByRole("region", { name: "前の答えと採点" });
    expect(
      within(last)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual([
      "問題 1: ○（あなたの答え: b）",
      "問題 2: ○（あなたの答え: walk）",
      "問題 3: ○",
    ]);
  });

  it("完了したことの無い教材では確かめずに putEnglishAnswer を呼び、完了の印と一文を出す", async () => {
    fetchMock.mockImplementation(
      (_input: RequestInfo | URL, init?: RequestInit) => echoAnswer(init),
    );
    render(<EnglishStudy set={e1()} />);
    fireEvent.click(screen.getByRole("button", { name: "問題へ" }));
    answerAndGrade();

    fireEvent.click(completeButton());
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(await screen.findByText(DONE_TEXT)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).toBeNull();

    // 残せた後の「完了」は、前の答えを置き換えるので MSG-006 で確かめる。
    fireEvent.click(completeButton());
    expect(screen.getByRole("alertdialog").textContent).toContain(
      ENGLISH_MESSAGES["MSG-006"],
    );
  });

  it("○△× の付いていない問題があると、API を呼ばずに MSG-005 を出す", () => {
    render(<EnglishStudy set={e1()} />);
    fireEvent.click(screen.getByRole("button", { name: "問題へ" }));
    fireEvent.click(screen.getByRole("button", { name: "採点へ" }));
    fireEvent.click(completeButton());
    expect(screen.getByRole("alert").textContent).toContain(
      ENGLISH_MESSAGES["MSG-005"],
    );
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("TC48 API が 500 を返すと MSG-007 が出て、採点の段に答えと ○△× が残る（DD-06 E08）", () => {
  const pressed = (no: number) =>
    within(screen.getByRole("group", { name: `問題 ${no} の採点` }))
      .queryAllByRole("button", { pressed: true })
      .map((button) => button.textContent);

  it("「完了」を押すと MSG-007 を下の知らせに出し、採点の段の答えと ○△× はそのまま", async () => {
    fetchMock.mockImplementation(async () =>
      Response.json(
        {
          error: {
            code: "internal",
            message: ENGLISH_MESSAGES["MSG-007"],
            messageId: "MSG-007",
          },
        },
        { status: 500 },
      ),
    );
    render(<EnglishStudy set={e1()} />);
    fireEvent.click(screen.getByRole("button", { name: "問題へ" }));
    answerAndGrade();
    fireEvent.click(completeButton());

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(ENGLISH_MESSAGES["MSG-007"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(DONE_TEXT)).toBeNull();

    const grading = screen.getByRole("region", { name: "採点の段" });
    expect(within(grading).getByText("あなたの答え: b")).toBeTruthy();
    expect(within(grading).getByText("あなたの答え: walk")).toBeTruthy();
    expect(pressed(1)).toEqual(["○"]);
    expect(pressed(2)).toEqual(["○"]);
    expect(pressed(3)).toEqual(["○"]);

    // もう一度「完了」を押せる。残せたら知らせを消し、完了の印を出す。
    await vi.waitFor(() =>
      expect((completeButton() as HTMLButtonElement).disabled).toBe(false),
    );
    fetchMock.mockImplementation(
      (_input: RequestInfo | URL, init?: RequestInit) => echoAnswer(init),
    );
    fireEvent.click(completeButton());
    expect(await screen.findByText(DONE_TEXT)).toBeTruthy();
    await vi.waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("つながらないときも MSG-007 を出す", async () => {
    fetchMock.mockImplementation(async () => {
      throw new TypeError("Failed to fetch");
    });
    render(<EnglishStudy set={e1()} />);
    fireEvent.click(screen.getByRole("button", { name: "問題へ" }));
    answerAndGrade();
    fireEvent.click(completeButton());
    expect((await screen.findByRole("alert")).textContent).toContain(
      ENGLISH_MESSAGES["MSG-007"],
    );
    expect(screen.getByRole("region", { name: "採点の段" })).toBeTruthy();
  });

  it("400 で MSG-005 が返れば MSG-005 を出す", async () => {
    fetchMock.mockImplementation(async () =>
      Response.json(
        {
          error: {
            code: "bad_request",
            message: ENGLISH_MESSAGES["MSG-005"],
            messageId: "MSG-005",
          },
        },
        { status: 400 },
      ),
    );
    render(<EnglishStudy set={e1()} />);
    fireEvent.click(screen.getByRole("button", { name: "問題へ" }));
    answerAndGrade();
    fireEvent.click(completeButton());
    expect((await screen.findByRole("alert")).textContent).toContain(
      ENGLISH_MESSAGES["MSG-005"],
    );
  });

  // DD-04 3.4: 403 と、MSG-005 でない 400 は MSG-019。送り直しを案内する MSG-007 は出さない。
  it.each([
    { status: 403, code: "forbidden_origin" },
    { status: 400, code: "bad_request" },
  ])(
    "$status（$code）では MSG-019 を出し、MSG-007 は出さず、採点の段は残る",
    async ({ status, code }) => {
      fetchMock.mockImplementation(async () =>
        Response.json(
          {
            error: {
              code,
              message: ENGLISH_MESSAGES["MSG-019"],
              messageId: "MSG-019",
            },
          },
          { status },
        ),
      );
      render(<EnglishStudy set={e1()} />);
      fireEvent.click(screen.getByRole("button", { name: "問題へ" }));
      answerAndGrade();
      fireEvent.click(completeButton());
      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toContain(ENGLISH_MESSAGES["MSG-019"]);
      expect(alert.textContent).not.toContain(ENGLISH_MESSAGES["MSG-007"]);
      expect(screen.queryByText(DONE_TEXT)).toBeNull();
      expect(screen.getByRole("region", { name: "採点の段" })).toBeTruthy();
    },
  );
});

describe("TC49 「完了」を続けて2回押しても API の呼び出しは1回（BD-09 5章、DD-05 4章）", () => {
  it("1回目の後に「完了」が押せなくなり、結果が出たら押せるように戻る", async () => {
    let respond: (response: Response) => void = () => {};
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          respond = resolve;
        }),
    );
    render(<EnglishStudy set={e1()} />);
    fireEvent.click(screen.getByRole("button", { name: "問題へ" }));
    answerAndGrade();

    const button = completeButton() as HTMLButtonElement;
    fireEvent.click(button);
    fireEvent.click(button);
    expect(button.disabled).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      respond(
        Response.json({
          contentId: 7,
          grades: NEW_GRADES,
          completedAt: COMPLETED_AT,
        }),
      );
    });
    expect(await screen.findByText(DONE_TEXT)).toBeTruthy();
    expect(button.disabled).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("確認の面で「置き換える」を選んだ後も、結果が出るまで「完了」は押せない", async () => {
    fetchMock.mockImplementation(() => new Promise<Response>(() => {}));
    render(<EnglishStudy set={completed()} />);
    fireEvent.click(screen.getByRole("button", { name: "やり直す" }));
    answerAndGrade();
    fireEvent.click(completeButton());
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "置き換える",
      }),
    );
    await vi.waitFor(() =>
      expect(screen.queryByRole("alertdialog")).toBeNull(),
    );
    expect((completeButton() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(completeButton());
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
