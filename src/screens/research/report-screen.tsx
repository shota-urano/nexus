"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { markOpened, setRead, setSaved } from "../../client/news";
import { fetchResearchReport } from "../../client/research";
import type { QuestionTarget } from "../../contracts/chat";
import type { ContentState } from "../../contracts/news";
import type { ResearchReportDetailView } from "../../contracts/research";
import { type BottomNotice, BottomNotices } from "../../ui/bottom-notices";
import { EmptyState } from "../../ui/empty-state";
import {
  BookIcon,
  BookmarkIcon,
  ChatIcon,
} from "../../ui/kinds/news/article-icons";
import { formatListDate } from "../../ui/list-date";
import { ApproachItem } from "../../ui/kinds/research/approach";
import { ReceivedText } from "../../ui/received-text";
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
// - 方法の行と印と広げた中身は、種類ごとの表示部品 M08（src/ui/kinds/research/approach.tsx）で描く。
// - 週を選ぶと、その週の内容ID で `getResearchReport` を読み、その週に替わる（SCR-011-A03）。
//   読み込み中は選択欄を押せなくする。
// - 「読んだ」「未読に戻す」「保存」「保存を外す」（A04〜A06）は SCR-003 と同じアイコンのボタンにし、
//   結果が出るまで押せなくする。失敗したら MSG-003 を下の知らせに出し、状態は変えない。
// - 「AI に質問」（A07）は、その週の週報の全体（対象 `page` と内容ID）で AI チャットの面 M06 を開く。
// - 道（M01）が `topBar` を渡したときは、課題名（O01）と「AI に質問」（A07）を、その上の帯に置く
//   （BD-03 SCR-011 3.2「[ロゴ] O01 課題名 [AI] A07」、4章）。上の帯は読み込み中も失敗のときも出す（3.5）。
//   週報を読むまでは課題名が無いので、`title` は null にする。

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

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

// 今の日本時間の年。日付の書式（今年かどうか）を決める。
function thisYearInJapan(now: Date): number {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).getUTCFullYear();
}

// 上の帯を描く関数。課題名（読む前は null）と、帯の右に置く「AI に質問」（読む前は null）を受け取る。
export type ResearchReportTopBar = (bar: {
  title: string | null;
  action: ReactNode;
}) => ReactNode;

export function ResearchReportScreen({
  contentId,
  topBar,
}: {
  contentId: number;
  topBar?: ResearchReportTopBar;
}) {
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

  const buttonClass =
    "inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border border-hud-line disabled:opacity-50";
  const loading = phase === "loading";
  const askButton =
    report === null ? null : (
      <button
        type="button"
        onClick={() => askAi(report.contentId)}
        aria-label="AI に質問"
        disabled={loading}
        className={`${buttonClass} shrink-0 text-hud-text`}
      >
        <ChatIcon />
      </button>
    );
  // 道が上の帯を渡したときは、帯を中身の上に置く。
  const withBar = (content: ReactNode) =>
    topBar === undefined ? (
      content
    ) : (
      <>
        {topBar({
          title:
            report === null || phase === "notFound" || phase === "failed"
              ? null
              : report.topicTitle,
          action: phase === "ready" || phase === "loading" ? askButton : null,
        })}
        {content}
      </>
    );

  if (phase === "unauthorized") return withBar(null);
  if (phase === "notFound") {
    return withBar(
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
      />,
    );
  }
  if (phase === "failed") {
    return withBar(<EmptyState message={RESEARCH_MESSAGES["MSG-019"]} />);
  }
  if (report === null) return withBar(<WaitMark />);

  const thisYear = thisYearInJapan(new Date());
  const { state } = report;
  const readLabel = state.isRead ? "未読に戻す" : "読んだ";
  const saveLabel = state.isSaved ? "保存を外す" : "保存";

  return withBar(
    <>
      <div className="flex flex-col gap-4 px-4 py-4">
        <header className="flex flex-col gap-3">
          {topBar === undefined && (
            <div className="flex items-start gap-3">
              <h1 className="min-w-0 flex-1 text-lg font-bold leading-snug">
                {report.topicTitle}
              </h1>
              {askButton}
            </div>
          )}
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
    </>,
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
