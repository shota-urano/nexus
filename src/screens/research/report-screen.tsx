"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { markOpened, setRead, setSaved } from "../../client/news";
import { fetchResearchReport } from "../../client/research";
import type { QuestionTarget } from "../../contracts/chat";
import type { ContentState } from "../../contracts/news";
import type {
  ApproachMark,
  ApproachView,
  ResearchReportDetailView,
} from "../../contracts/research";
import { type BottomNotice, BottomNotices } from "../../ui/bottom-notices";
import { EmptyState } from "../../ui/empty-state";
import {
  BookIcon,
  BookmarkIcon,
  ChatIcon,
} from "../../ui/kinds/news/article-icons";
import { formatListDate } from "../../ui/list-date";
import { isSafeLink, ReceivedText } from "../../ui/received-text";
import { ChatSheet } from "../chat/chat-sheet";
import {
  RESEARCH_MESSAGES,
  type StateOperation,
  stateFailedMessage,
} from "./messages";

// SCR-011 課題の週報（DD-01 M32。BD-03 SCR-011、BD-02 FN-027、FN-005、FN-006。CR-020、Q-095）。
// - 開いたら `getResearchReport` で週報を読み（SCR-011-A01）、出した後に `markOpened` を呼ぶ。
//   失敗しても週報を出したままにし、知らせを出さない（DD-02 FN-004 と同じ扱い）。
//   週報が無ければ MSG-048 と課題の一覧へ戻る操作、読めなければ MSG-019 を出す。401 のときは何も出さない
//   （全面の知らせは M01 の枠が出す）。
// - 今週の変化を一番上に置き、続けて現時点の答え、方法の一覧、まだ分かっていないことを置く（3.2）。
// - 方法の行を押すと、その行のすぐ下に、そのためには、出典、反対の意見を広げる。もう一度押すと閉じる。
//   複数を同時に開ける。画面の幅によらず、左右に並べる形は作らない（SCR-011-A02。Q-095 の答え）。
// - 印はタグ（記号と文字）を印ごとの色の枠と文字の色で出し、塗らない。印のある方法の行の左に帯を1本出し、
//   帯の色は 反対の意見あり → 今週足した → 出典が増えた の優先順で先の印の色にする（3.2）。
// - 出典は http と https の URL だけをリンクにし、ホスト名を出す（SCR-011-O09、A08）。
// - 週を選ぶと、その週の内容ID で `getResearchReport` を読み、その週に替わる（SCR-011-A03）。
//   読み込み中は選択欄を押せなくする。
// - 「読んだ」「未読に戻す」「保存」「保存を外す」（A04〜A06）は SCR-003 と同じアイコンのボタンにし、
//   結果が出るまで押せなくする。失敗したら MSG-003 を下の知らせに出し、状態は変えない。
// - 「AI に質問」（A07）は、その週の週報の全体（対象 `page` と内容ID）で AI チャットの面 M06 を開く。

type Phase = "loading" | "ready" | "notFound" | "failed" | "unauthorized";
type StateAction = "read" | "saved";
type StateSource = "opened" | StateAction;

// 操作ごとに、応答から取り込む項目（DD-02 3章 P04 で、その操作が変える列）。
const FIELDS_OF: Record<StateSource, readonly (keyof ContentState)[]> = {
  opened: ["isNew"],
  read: ["isRead"],
  saved: ["isSaved", "savedAt"],
};

const STATUS_LABELS = {
  active: "進行中",
  ended: "終了（最後の報告）",
} as const;

// 印のタグ（記号と文字）と色の class（src/app/globals.css の @theme）。
const MARKS: Record<
  ApproachMark,
  { symbol: string; label: string; tag: string; band: string }
> = {
  added: {
    symbol: "+",
    label: "今週足した",
    tag: "border-mark-added text-mark-added",
    band: "bg-mark-added",
  },
  more_sources: {
    symbol: "↑",
    label: "出典が増えた",
    tag: "border-mark-more text-mark-more",
    band: "bg-mark-more",
  },
  disputed: {
    symbol: "!",
    label: "反対の意見あり",
    tag: "border-mark-disputed text-mark-disputed",
    band: "bg-mark-disputed",
  },
};

// 帯の色の優先順（BD-03 SCR-011 3.2。Q-095 の答え）。
const BAND_ORDER: ApproachMark[] = ["disputed", "added", "more_sources"];

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

// 今の日本時間の年。日付の書式（今年かどうか）を決める。
function thisYearInJapan(now: Date): number {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).getUTCFullYear();
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function ResearchReportScreen({ contentId }: { contentId: number }) {
  const router = useRouter();
  // 選んだ週（選んだときに開いていた内容ID と、選んだ週の内容ID）。開く内容ID が替わったら使わない。
  const [selected, setSelected] = useState<{ base: number; id: number } | null>(
    null,
  );
  // 出している週の内容ID。
  const currentId =
    selected !== null && selected.base === contentId ? selected.id : contentId;
  const [phase, setPhase] = useState<Phase>("loading");
  const [report, setReport] = useState<ResearchReportDetailView | null>(null);
  const [pending, setPending] = useState<Record<StateAction, boolean>>({
    read: false,
    saved: false,
  });
  const [notices, setNotices] = useState<BottomNotice[]>([]);
  const [chatOpen, setChatOpen] = useState(false);
  // 閉じる動きの間も同じ対象を出すため、閉じても対象は残す。
  const [chatTarget, setChatTarget] = useState<QuestionTarget | null>(null);

  const applyState = useCallback((source: StateSource, state: ContentState) => {
    const change: Partial<ContentState> = {};
    for (const field of FIELDS_OF[source]) {
      if (field in state) Object.assign(change, { [field]: state[field] });
    }
    setReport((previous) =>
      previous !== null && previous.contentId === state.contentId
        ? { ...previous, state: { ...previous.state, ...change } }
        : previous,
    );
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetchResearchReport(currentId, { signal: controller.signal }).then(
      (result) => {
        if (controller.signal.aborted) return;
        if (result.status !== "ok") {
          setPhase(result.status);
          return;
        }
        setReport(result.value);
        setPhase("ready");
        markOpened(currentId).then(
          (state) => {
            if (state.status === "ok" && !controller.signal.aborted) {
              applyState("opened", state.value);
            }
          },
          // 開いた日時を残せなくても、週報を出したままにする（次に開いたときにもう一度呼ぶ）。
          () => undefined,
        );
      },
      (error: unknown) => {
        if (controller.signal.aborted || isAbortError(error)) return;
        setPhase("failed");
      },
    );
    return () => controller.abort();
  }, [currentId, applyState]);

  async function change(
    action: StateAction,
    operation: StateOperation,
    call: () => ReturnType<typeof setRead>,
  ) {
    setPending((previous) => ({ ...previous, [action]: true }));
    let result: Awaited<ReturnType<typeof setRead>>;
    try {
      result = await call();
    } catch {
      result = { status: "failed" };
    }
    setPending((previous) => ({ ...previous, [action]: false }));
    if (result.status === "ok") {
      applyState(action, result.value);
      setNotices((previous) => previous.filter((n) => n.id !== action));
    } else if (result.status !== "unauthorized") {
      setNotices((previous) => [
        ...previous.filter((n) => n.id !== action),
        { id: action, kind: "error", text: stateFailedMessage(operation) },
      ]);
    }
  }

  function askAi(id: number) {
    setChatTarget({ kind: "page", contentId: id });
    setChatOpen(true);
  }

  if (phase === "unauthorized") return null;
  if (phase === "notFound") {
    return (
      <EmptyState
        message={RESEARCH_MESSAGES["MSG-048"]}
        action={
          <button
            type="button"
            onClick={() => router.push("/research")}
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border border-hud-line px-4"
          >
            戻る
          </button>
        }
      />
    );
  }
  if (phase === "failed") {
    return <EmptyState message={RESEARCH_MESSAGES["MSG-019"]} />;
  }
  if (report === null) return <WaitMark />;

  const loading = phase === "loading";
  const thisYear = thisYearInJapan(new Date());
  const { state } = report;
  const buttonClass =
    "inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border border-hud-line disabled:opacity-50";
  const readLabel = state.isRead ? "未読に戻す" : "読んだ";
  const saveLabel = state.isSaved ? "保存を外す" : "保存";

  return (
    <>
      <div className="flex flex-col gap-4 px-4 py-4">
        <header className="flex flex-col gap-3">
          <div className="flex items-start gap-3">
            <h1 className="min-w-0 flex-1 text-lg font-bold leading-snug">
              {report.topicTitle}
            </h1>
            <button
              type="button"
              onClick={() => askAi(report.contentId)}
              aria-label="AI に質問"
              disabled={loading}
              className={`${buttonClass} shrink-0 text-hud-text`}
            >
              <ChatIcon />
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
            <span>{`${report.week}週目`}</span>
            <span>{formatListDate(report.sentOn, thisYear)}</span>
            <span
              className={
                report.status === "ended" ? "text-hud-muted" : "text-hud-amber"
              }
            >
              {STATUS_LABELS[report.status]}
            </span>
            <select
              aria-label="週"
              value={currentId}
              disabled={loading || report.weeks.length < 2}
              onChange={(event) => {
                setPhase("loading");
                setSelected({
                  base: contentId,
                  id: Number(event.target.value),
                });
              }}
              className="min-h-11 rounded-hud border border-hud-line bg-hud-field px-3 text-hud-text disabled:opacity-50"
            >
              {[...report.weeks]
                .sort((a, b) => b.week - a.week)
                .map((week) => (
                  <option key={week.contentId} value={week.contentId}>
                    {`${week.week}週目（${formatListDate(week.sentOn, thisYear)}）`}
                  </option>
                ))}
            </select>
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              aria-label={readLabel}
              disabled={loading || pending.read}
              onClick={() =>
                change("read", state.isRead ? "未読に戻す" : "既読に", () =>
                  setRead(report.contentId, !state.isRead),
                )
              }
              className={`${buttonClass} ${state.isRead ? "text-hud-amber" : "text-hud-text"}`}
            >
              <BookIcon filled={state.isRead} />
            </button>
            <button
              type="button"
              aria-label={saveLabel}
              disabled={loading || pending.saved}
              onClick={() =>
                change("saved", state.isSaved ? "保存を外す" : "保存", () =>
                  setSaved(report.contentId, !state.isSaved),
                )
              }
              className={`${buttonClass} ${state.isSaved ? "text-hud-amber" : "text-hud-text"}`}
            >
              <BookmarkIcon filled={state.isSaved} />
            </button>
          </div>
        </header>
        {loading ? (
          <WaitMark />
        ) : (
          <ReportBody key={report.contentId} report={report} />
        )}
      </div>
      <BottomNotices
        notices={notices}
        onClose={(id) =>
          setNotices((previous) => previous.filter((n) => n.id !== id))
        }
      />
      <ChatSheet
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        target={chatTarget}
      />
    </>
  );
}

function Section({
  title,
  className = "",
  children,
}: {
  title: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={`rounded-hud border border-hud-line bg-hud-panel px-4 py-3 ${className}`}
    >
      <h2 className="text-sm font-bold text-hud-amber">{title}</h2>
      {children}
    </section>
  );
}

// 週報の本文。週が替わったら作り直し（key を内容ID にする）、方法を全て閉じた状態に戻す。
function ReportBody({ report }: { report: ResearchReportDetailView }) {
  return (
    <>
      <Section title="今週の変化">
        <ReceivedText markdown={report.changesMd} />
      </Section>
      <Section title="現時点の答え">
        <ReceivedText markdown={report.answerMd} />
      </Section>
      <Section title={`方法の一覧（${report.approaches.length}）`}>
        <ul className="mt-2 flex flex-col gap-2">
          {report.approaches.map((approach, index) => (
            <ApproachItem
              // 見出しは重なりうるため、送られた順番で見分ける。
              key={index}
              approach={approach}
            />
          ))}
        </ul>
      </Section>
      {report.unknownsMd !== "" && (
        <Section title="まだ分かっていないこと">
          <ReceivedText markdown={report.unknownsMd} />
        </Section>
      )}
    </>
  );
}

// 方法1件。行を押すたびに、その行のすぐ下で広げるか閉じる（方法ごとに持つので、同時に開ける）。
function ApproachItem({ approach }: { approach: ApproachView }) {
  const [open, setOpen] = useState(false);
  const bandMark = BAND_ORDER.find((mark) => approach.marks.includes(mark));
  return (
    <li className="block">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((previous) => !previous)}
        className="relative flex min-h-11 w-full items-start gap-2 overflow-hidden rounded-hud border border-hud-veil py-2 pr-3 pl-4 text-left"
      >
        {bandMark !== undefined && (
          <span
            data-testid="approach-band"
            aria-hidden="true"
            className={`absolute inset-y-0 left-0 w-1 ${MARKS[bandMark].band}`}
          />
        )}
        <span
          aria-hidden="true"
          className={`pt-0.5 text-hud-amber transition-transform ${open ? "rotate-90" : ""}`}
        >
          ›
        </span>
        <span className="min-w-0 flex-1">
          {approach.marks.map((mark) => (
            <span
              key={mark}
              className={`mr-1 mb-1 inline-block rounded-full border px-2 text-xs ${MARKS[mark].tag}`}
            >
              {`${MARKS[mark].symbol} ${MARKS[mark].label}`}
            </span>
          ))}
          <span className="block font-bold leading-snug">{approach.title}</span>
        </span>
        <span className="shrink-0 text-xs text-hud-muted">
          {`出典 ${approach.sourceCount}`}
        </span>
      </button>
      {open && <ApproachDetail approach={approach} />}
    </li>
  );
}

function ApproachDetail({ approach }: { approach: ApproachView }) {
  return (
    <div className="flex flex-col gap-2 px-4 pt-2 pb-3">
      <h3 className="text-sm font-bold text-hud-amber">そのためには</h3>
      <ReceivedText markdown={approach.howToMd} />
      <h3 className="text-sm font-bold text-hud-amber">
        {`出典（${approach.sourceUrls.length}）`}
      </h3>
      <ul className="flex flex-col">
        {approach.sourceUrls.map((url, index) => (
          // 出典の URL は重ならない（DD-02 FN-025）が、順番で見分けて描く。
          <li key={index}>
            {isSafeLink(url) ? (
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-11 items-center underline underline-offset-2"
              >
                {`↗ ${hostOf(url)}`}
              </a>
            ) : (
              <span className="inline-flex min-h-11 items-center break-all text-hud-muted">
                {url}
              </span>
            )}
          </li>
        ))}
      </ul>
      {approach.counterMd !== null && approach.counterMd !== "" && (
        <div className="rounded-hud border-l-4 border-mark-disputed bg-hud-veil px-3 py-2">
          <h3 className="text-sm font-bold text-mark-disputed">反対の意見</h3>
          <ReceivedText markdown={approach.counterMd} />
        </div>
      )}
    </div>
  );
}

// 読み込み中の待つ印。
function WaitMark() {
  return (
    <div role="status" className="flex justify-center px-4 py-6">
      <span className="sr-only">読み込み中</span>
      <span
        aria-hidden="true"
        className="size-6 rounded-full border-2 border-current border-t-transparent motion-safe:animate-spin"
      />
    </div>
  );
}
