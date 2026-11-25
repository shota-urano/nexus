// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BottomNotices } from "../src/ui/bottom-notices";
import { BottomSheet } from "../src/ui/bottom-sheet";
import { ConfirmPanel } from "../src/ui/confirm-panel";
import { ContentListRow } from "../src/ui/content-list-row";
import { EmptyState } from "../src/ui/empty-state";
import { formatListDate } from "../src/ui/list-date";
import { QuestionTargetBadge } from "../src/ui/question-target-badge";
import { ReceivedText } from "../src/ui/received-text";

// 共通部品 M07（DD-01、BD-09 6章）。

afterEach(() => {
  cleanup();
});

describe("TC105 届いた文の表示はスクリプトを動かさない（NFR-018、ADR-018）", () => {
  const ATTACK = [
    "# 見出し",
    "",
    "<script>alert(1)</script>",
    "",
    '文の中の <img src="x" onerror="alert(1)"> 画像',
    "",
    '<img src="x" onerror="alert(1)">',
    "",
    "[x](javascript:alert(1))",
    "",
    "[大文字](JavaScript:alert(1))",
  ].join("\n");

  it("`script` と `img` の要素ができず、`javascript:` のリンクは `a` にならない", () => {
    const { container } = render(<ReceivedText markdown={ATTACK} />);
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("a")).toBeNull();
    // 属性にも onerror と javascript: が残らない。
    expect(container.innerHTML).not.toMatch(/onerror=/i);
    expect(container.innerHTML).not.toMatch(/href="javascript:/i);
    // 文字は出るか消える。リンクの文字は残る。
    expect(container.textContent).toContain("x");
    expect(container.textContent).toContain("大文字");
  });

  it("Markdown の画像の書式も `img` にならない", () => {
    const { container } = render(
      <ReceivedText markdown={'![画像](https://example.com/a.png "t")'} />,
    );
    expect(container.querySelector("img")).toBeNull();
  });

  it("決めた書式（見出し、段落、箇条書き、強調、表、リンク）は描き、リンクは端末のブラウザで開く", () => {
    const markdown = [
      "## 見出し",
      "",
      "段落の **強い** と *弱い* 強調。",
      "",
      "- 一つ目",
      "- 二つ目",
      "",
      "| 語 | 意味 |",
      "|---|---|",
      "| run | 走る |",
      "",
      "[元の記事](https://example.com/a)",
    ].join("\n");
    const { container } = render(<ReceivedText markdown={markdown} />);
    expect(container.querySelector("h2")?.textContent).toBe("見出し");
    expect(container.querySelector("strong")?.textContent).toBe("強い");
    expect(container.querySelector("em")?.textContent).toBe("弱い");
    expect(container.querySelectorAll("li")).toHaveLength(2);
    expect(container.querySelector("table td")?.textContent).toBe("run");
    const link = container.querySelector("a");
    expect(link?.getAttribute("href")).toBe("https://example.com/a");
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("決めた書式の外の要素（コード、引用）は作らず、中の文字を残す", () => {
    const { container } = render(
      <ReceivedText markdown={"> 引用\n\n```\ncode\n```\n\n`inline`"} />,
    );
    expect(container.querySelector("blockquote")).toBeNull();
    expect(container.querySelector("pre")).toBeNull();
    expect(container.querySelector("code")).toBeNull();
    expect(container.textContent).toContain("引用");
    expect(container.textContent).toContain("inline");
  });
});

describe("下から出る面（BD-09 6章）", () => {
  it("開くと出て、取っ手で全画面に広がり、もう一度押すと戻り、閉じると onClose を呼ぶ", () => {
    const onClose = vi.fn();
    render(
      <BottomSheet open title="記事の案内" onClose={onClose}>
        <p>中身</p>
      </BottomSheet>,
    );
    const sheet = screen.getByRole("dialog", { name: "記事の案内" });
    expect(sheet.dataset.expanded).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "面を広げる" }));
    expect(sheet.dataset.expanded).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "面を戻す" }));
    expect(sheet.dataset.expanded).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "閉じる" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("閉じているときは出ない", () => {
    render(
      <BottomSheet open={false} title="AI チャット" onClose={() => {}}>
        <p>中身</p>
      </BottomSheet>,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("内容の一覧の行（BD-09 6章、5章 表示書式）", () => {
  it("種類の印、新着のタグ、見出し、日付を出し、押すと内容を開く", () => {
    render(
      <ul>
        <ContentListRow
          href="/news/c1"
          kindLabel="ニュース"
          isNew
          title="記事の見出し"
          date="2026-11-23"
          thisYear={2026}
        />
      </ul>,
    );
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe("/news/c1");
    expect(link.textContent).toContain("ニュース");
    expect(link.textContent).toContain("新着");
    expect(link.textContent).toContain("記事の見出し");
    expect(link.textContent).toContain("11月23日（月）");
  });

  it("新着でなければタグを出さない", () => {
    render(
      <ul>
        <ContentListRow
          href="/english/c2"
          kindLabel="英語"
          isNew={false}
          title="教材"
          date="2025-11-23"
          thisYear={2026}
        />
      </ul>,
    );
    expect(screen.getByRole("link").textContent).not.toContain("新着");
  });

  it("日付は今年なら曜日付き、今年でなければ年付きにし、時刻は出さない", () => {
    expect(formatListDate("2026-11-23", 2026)).toBe("11月23日（月）");
    expect(formatListDate("2026-01-04", 2026)).toBe("1月4日（日）");
    expect(formatListDate("2025-11-23", 2026)).toBe("2025年11月23日");
  });
});

describe("空の状態（BD-09 2章）", () => {
  it("置き場所に文言を出し、次にする操作を並べる", () => {
    render(
      <EmptyState
        message="保存した内容はありません。"
        action={<button type="button">戻る</button>}
      />,
    );
    expect(screen.getByRole("status").textContent).toContain(
      "保存した内容はありません。",
    );
    expect(screen.getByRole("button", { name: "戻る" })).toBeTruthy();
  });
});

describe("下の知らせ（BD-09 2章）", () => {
  it("新しい方を上に重ね、エラーは閉じるまで残り、閉じると onClose を呼ぶ", () => {
    const onClose = vi.fn();
    render(
      <BottomNotices
        notices={[
          { id: "a", kind: "error", text: "古い知らせ" },
          { id: "b", kind: "error", text: "新しい知らせ" },
        ]}
        onClose={onClose}
      />,
    );
    const alerts = screen.getAllByRole("alert");
    expect(alerts.map((alert) => alert.textContent)).toEqual([
      "古い知らせ閉じる",
      "新しい知らせ閉じる",
    ]);
    // 古い順に並べた箱を下から積む（flex-col-reverse）ので、新しい方が上に来る。
    expect(alerts[0].parentElement?.className).toContain("flex-col-reverse");
    fireEvent.click(screen.getAllByRole("button", { name: "閉じる" })[1]);
    expect(onClose).toHaveBeenCalledWith("b");
  });
});

describe("確認の面（BD-09 2章）", () => {
  it("中央に重ねて出し、選んだ方を呼ぶ。開いた時はやめる方に操作を置く", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmPanel
        open
        message="前の答えを、今回の答えで置き換えます。置き換えますか。"
        confirmLabel="置き換える"
        cancelLabel="やめる"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    const dialog = screen.getByRole("alertdialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.textContent).toContain("置き換えますか。");
    expect(document.activeElement?.textContent).toBe("やめる");
    fireEvent.click(screen.getByRole("button", { name: "置き換える" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "やめる" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("閉じているときは出ない", () => {
    render(
      <ConfirmPanel
        open={false}
        message="m"
        confirmLabel="置き換える"
        cancelLabel="やめる"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});

describe("質問の対象の印（BD-09 6章）", () => {
  it.each([
    ["page", "ページ"],
    ["article", "記事"],
    ["phrase", "語句と文"],
    ["node", "図のノード"],
  ] as const)("%s は「%s」と見出しを出す", (kind, label) => {
    const { container } = render(
      <QuestionTargetBadge kind={kind} label="見出しか語句" />,
    );
    expect(container.textContent).toBe(`${label}見出しか語句`);
  });
});
