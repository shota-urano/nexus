"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchGalaxy } from "../../client/news";
import type {
  ArticleDetail,
  Galaxy,
  GalaxyLink,
  GalaxyNode,
} from "../../contracts/news";
import { BottomSheet } from "../../ui/bottom-sheet";
import { EmptyState } from "../../ui/empty-state";
import { formatListDate } from "../../ui/list-date";
import {
  ArticlePanel,
  type ContentStateChange,
  thisYearInJapan,
} from "./article-panel";
import { GalaxyGraph } from "./galaxy-graph";
import { NEWS_MESSAGES, noArticleMessage } from "./messages";
import { WaitMark } from "./wait-mark";

// SCR-002 News Galaxy（DD-01 M03。BD-03 SCR-002、DD-02 FN-003）。
// - 開いたら `getGalaxy` で今日の記事と関係を読む（A01）。日付を選ぶと、前の読み込みを止めて
//   選んだ日を読み、最後に選んだ日だけを出す（A02）。日付の選択肢は応答の `availableDates`。
// - テーマで絞るのは画面の中で行い、サーバを呼ばない（A03。DD-02 FN-003 手順 4）。
// - 初めは中心を決めずに記事を並べる（作り物の中心を置かない。RD-03 R04）。ノードを押すと、
//   その記事を中心に移し、記事の案内（SCR-003）を下から出す（A04）。案内の `getArticle` の
//   `related` のうち、図に無い記事と線を図に足す（DD-02 FN-003 手順 5）。動いている間に押し直すと、
//   前の読み込みを止め、最後の1回だけを受ける。
// - 案内で関係のある記事を押すと、図の中心もその記事に移す（BD-03 遷移表 SCR-003-A06）。
// - 「未読」の切り替え（I03、A06。CR-018）を押すと、図を未読の記事だけにし、もう一度押すと全てに戻す。
//   テーマの絞り込みと重ね、サーバは呼ばない。切り替えには選んだ日の記事のうち未読の数を添え、
//   案内で既読を変えるとその数も変える。テーマの選択ボタンには選んだ日の記事の件数を添える。
// - 0件は MSG-001、読めなければ MSG-019。読み込み中は図の場所に待つ印を出し、日付とテーマは選べる。
//   401 のときは図を出さない（全面の知らせは M01 の枠が出す）。
// - 案内の面を開いている間は、図を指でずらす操作と拡大縮小を切る。案内で関係のある記事を
//   足しただけのときは、図を画面に合わせ直さない（BD-03 SCR-002・SCR-003、BD-09 5章）。
// - 上の帯に「AI に質問」は置かない（A05 は CR-018 でやめた）。案内の「AI に質問」は `onAskAi` に
//   内容ID を渡す。

type Phase = "loading" | "ready" | "failed" | "unauthorized";

const ALL_THEMES = "";

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function linkKey(link: GalaxyLink): string {
  return `${link.fromContentId}-${link.toContentId}-${link.relationType}`;
}

export function NewsGalaxyScreen({
  onAskAi,
}: {
  /** 案内で「AI に質問」を押したとき（SCR-003-A05）。その記事の内容ID を渡す */
  onAskAi?: (contentId: number) => void;
} = {}) {
  // 選んだ日。省くとサーバが今日にする。
  const [requestedDate, setRequestedDate] = useState<string | undefined>();
  const [phase, setPhase] = useState<Phase>("loading");
  const [galaxy, setGalaxy] = useState<Galaxy | null>(null);
  const [extraNodes, setExtraNodes] = useState<GalaxyNode[]>([]);
  const [extraLinks, setExtraLinks] = useState<GalaxyLink[]>([]);
  const [readStates, setReadStates] = useState<
    Map<number, Partial<Pick<GalaxyNode, "isNew" | "isRead">>>
  >(new Map());
  const [theme, setTheme] = useState(ALL_THEMES);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [center, setCenter] = useState<number | null>(null);
  const [opened, setOpened] = useState<number | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchGalaxy({ date: requestedDate, signal: controller.signal }).then(
      (result) => {
        if (controller.signal.aborted) return;
        if (result.status !== "ok") {
          setPhase(result.status === "notFound" ? "failed" : result.status);
          return;
        }
        setGalaxy(result.value);
        setExtraNodes([]);
        setExtraLinks([]);
        setReadStates(new Map());
        setTheme(ALL_THEMES);
        setUnreadOnly(false);
        setCenter(null);
        setOpened(null);
        setPhase("ready");
      },
      (error: unknown) => {
        if (controller.signal.aborted || isAbortError(error)) return;
        setPhase("failed");
      },
    );
    return () => controller.abort();
  }, [requestedDate]);

  const thisYear = thisYearInJapan(new Date());

  // 図に出すノードと線。応答の記事に、案内で足した記事を加え、テーマと未読で絞る。
  const { nodes, links } = useMemo(() => {
    if (galaxy === null) return { nodes: [], links: [] };
    const all = [...galaxy.nodes];
    const ids = new Set(all.map((node) => node.contentId));
    for (const node of extraNodes) {
      if (!ids.has(node.contentId)) {
        ids.add(node.contentId);
        all.push(node);
      }
    }
    const shown = all
      .filter((node) => theme === ALL_THEMES || node.theme === theme)
      .map((node) => withState(node, readStates))
      .filter((node) => !unreadOnly || !node.isRead);
    const keys = new Set<string>();
    const allLinks: GalaxyLink[] = [];
    for (const link of [...galaxy.links, ...extraLinks]) {
      const key = linkKey(link);
      if (!keys.has(key)) {
        keys.add(key);
        allLinks.push(link);
      }
    }
    return { nodes: shown, links: allLinks };
  }, [galaxy, extraNodes, extraLinks, theme, unreadOnly, readStates]);

  // 選んだ日の記事（関係の先の過去の記事は除く）の、テーマごとの件数と未読の数。
  const counts = useMemo(() => {
    const byTheme = new Map<string, number>();
    let total = 0;
    let unread = 0;
    if (galaxy !== null) {
      for (const node of galaxy.nodes) {
        if (node.targetDate !== galaxy.date) continue;
        total += 1;
        byTheme.set(node.theme, (byTheme.get(node.theme) ?? 0) + 1);
        if (!withState(node, readStates).isRead) unread += 1;
      }
    }
    return { byTheme, total, unread };
  }, [galaxy, readStates]);

  // 図を画面に合わせ直すきっかけ。日付かテーマが替わって、案内で足した記事も含めた出すノードの組が
  // 前と替わったら数を進める。案内で関係のある記事を足しただけのときは組を覚え直すだけで数を
  // 進めない（中心を保ったまま図を動かさない）。
  const shownKey = nodes.map((node) => node.contentId).join(",");
  const [fitBasis, setFitBasis] = useState({
    galaxy,
    theme,
    unreadOnly,
    shown: shownKey,
    version: 0,
  });
  if (
    fitBasis.galaxy !== galaxy ||
    fitBasis.theme !== theme ||
    fitBasis.unreadOnly !== unreadOnly ||
    fitBasis.shown !== shownKey
  ) {
    const switched =
      fitBasis.galaxy !== galaxy ||
      fitBasis.theme !== theme ||
      fitBasis.unreadOnly !== unreadOnly;
    setFitBasis({
      galaxy,
      theme,
      unreadOnly,
      shown: shownKey,
      version:
        switched && fitBasis.shown !== shownKey
          ? fitBasis.version + 1
          : fitBasis.version,
    });
  }
  const fitKey = String(fitBasis.version);

  const select = useCallback((contentId: number) => {
    setCenter(contentId);
    setOpened(contentId);
  }, []);

  // 案内を読めたら、関係のある記事のうち図に無いものと、その線を足す。
  const handleLoaded = useCallback((article: ArticleDetail) => {
    setExtraNodes((previous) => [
      ...previous,
      ...article.related.map((related) => related.node),
    ]);
    setExtraLinks((previous) => [
      ...previous,
      ...article.related.map((related) =>
        related.direction === "from"
          ? {
              fromContentId: article.contentId,
              toContentId: related.node.contentId,
              relationType: related.relationType,
            }
          : {
              fromContentId: related.node.contentId,
              toContentId: article.contentId,
              relationType: related.relationType,
            },
      ),
    ]);
  }, []);

  // 変わった項目のうち、ノードに出す新着と既読だけを合わせる。
  const handleStateChange = useCallback((change: ContentStateChange) => {
    const shown: Partial<Pick<GalaxyNode, "isNew" | "isRead">> = {};
    if (change.isNew !== undefined) shown.isNew = change.isNew;
    if (change.isRead !== undefined) shown.isRead = change.isRead;
    if (Object.keys(shown).length === 0) return;
    setReadStates((previous) =>
      new Map(previous).set(change.contentId, {
        ...previous.get(change.contentId),
        ...shown,
      }),
    );
  }, []);

  const closeSheet = useCallback(() => setOpened(null), []);

  function chooseDate(value: string) {
    setPhase("loading");
    setRequestedDate(value);
  }

  const date = galaxy?.date;
  const dateOptions = useMemo(() => {
    if (galaxy === null) return [];
    return [...new Set([galaxy.date, ...galaxy.availableDates])].sort((a, b) =>
      a < b ? 1 : a > b ? -1 : 0,
    );
  }, [galaxy]);
  const hasArticles = galaxy !== null && galaxy.nodes.length > 0;

  let body;
  if (phase === "unauthorized") {
    body = null;
  } else if (phase === "loading") {
    body = <WaitMark />;
  } else if (phase === "failed" || galaxy === null) {
    body = <EmptyState message={NEWS_MESSAGES["MSG-019"]} />;
  } else if (!hasArticles) {
    body = (
      <EmptyState
        message={noArticleMessage(formatListDate(galaxy.date, thisYear))}
      />
    );
  } else {
    body = (
      <GalaxyGraph
        nodes={nodes}
        links={links}
        date={galaxy.date}
        center={center}
        thisYear={thisYear}
        onSelect={select}
        locked={opened !== null}
        fitKey={fitKey}
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 日付は題名の下に置き、その下に「未読」とテーマの選択ボタンを横に並べる（BD-03 SCR-002 の 3.2）。 */}
      <div className="flex flex-col gap-2 px-4 pb-2 text-sm">
        <select
          aria-label="日付"
          value={date ?? ""}
          disabled={dateOptions.length === 0}
          onChange={(event) => chooseDate(event.target.value)}
          className="min-h-11 min-w-11 self-start rounded-hud border border-hud-line bg-hud-field px-3 text-hud-amber disabled:opacity-60"
        >
          {dateOptions.map((option) => (
            <option key={option} value={option}>
              {formatListDate(option, thisYear)}
            </option>
          ))}
        </select>
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
          <FilterChip
            label="未読"
            count={counts.unread}
            pressed={unreadOnly}
            disabled={!hasArticles}
            onClick={() => setUnreadOnly((previous) => !previous)}
          />
          <FilterChip
            label="すべて"
            count={counts.total}
            pressed={theme === ALL_THEMES}
            disabled={!hasArticles}
            onClick={() => setTheme(ALL_THEMES)}
          />
          {(galaxy?.themes ?? []).map((name) => (
            <FilterChip
              key={name}
              label={name}
              count={counts.byTheme.get(name) ?? 0}
              pressed={theme === name}
              disabled={!hasArticles}
              onClick={() => setTheme(name)}
            />
          ))}
        </div>
      </div>
      <div className="relative min-h-[60dvh] flex-1 overflow-hidden">
        {body}
      </div>
      <BottomSheet
        open={opened !== null}
        title="記事の案内"
        onClose={closeSheet}
        tone="hud"
      >
        {opened !== null && (
          <ArticlePanel
            key={opened}
            contentId={opened}
            onLoaded={handleLoaded}
            onStateChange={handleStateChange}
            onSelectRelated={select}
            onBack={closeSheet}
            onAskAi={onAskAi}
          />
        )}
      </BottomSheet>
    </div>
  );
}

// 案内で変えた新着と既読を、ノードに重ねる。
function withState(
  node: GalaxyNode,
  states: ReadonlyMap<number, Partial<Pick<GalaxyNode, "isNew" | "isRead">>>,
): GalaxyNode {
  const state = states.get(node.contentId);
  return state === undefined ? node : { ...node, ...state };
}

// 件数付きの丸い選択ボタン（SCR-002-I02、I03。CR-018）。ボタンの名前は「{label} {件数}件」。
// 押す場所は 44 ピクセル四方以上にする（RD-11 NFR-008）。
function FilterChip({
  label,
  count,
  pressed,
  disabled,
  onClick,
}: {
  label: string;
  count: number;
  pressed: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={`${label} ${count}件`}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-2 rounded-full border px-4 whitespace-nowrap disabled:opacity-60 ${
        pressed
          ? "border-hud-amber bg-hud-amber/15 text-hud-amber"
          : "border-hud-veil bg-hud-field text-hud-text"
      }`}
    >
      <span>{label}</span>
      <span className={pressed ? "text-hud-amber" : "text-hud-muted"}>
        {count}
      </span>
    </button>
  );
}
