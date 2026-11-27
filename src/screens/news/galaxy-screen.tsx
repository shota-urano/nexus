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
// - 0件は MSG-001、読めなければ MSG-019。読み込み中は図の場所に待つ印を出し、日付とテーマは選べる。
//   401 のときは図を出さない（全面の知らせは M01 の枠が出す）。
// - 案内の面を開いている間は、図を指でずらす操作と拡大縮小を切る。案内で関係のある記事を
//   足しただけのときは、図を画面に合わせ直さない（BD-03 SCR-002・SCR-003、BD-09 5章）。
// - 中心の記事が替わると `onCenterChange` で知らせる。上の帯の「AI に質問」（A05）は、中心の記事を
//   選んでいるときだけ道（M01）が出す（CR-003）。案内の「AI に質問」は `onAskAi` に内容ID を渡す。

type Phase = "loading" | "ready" | "failed" | "unauthorized";

const ALL_THEMES = "";

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function linkKey(link: GalaxyLink): string {
  return `${link.fromContentId}-${link.toContentId}-${link.relationType}`;
}

export function NewsGalaxyScreen({
  onCenterChange,
  onAskAi,
}: {
  /** 中心の記事が替わったとき。中心が無ければ null */
  onCenterChange?: (contentId: number | null) => void;
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
  const [center, setCenter] = useState<number | null>(null);
  const [opened, setOpened] = useState<number | null>(null);

  useEffect(() => {
    onCenterChange?.(center);
  }, [center, onCenterChange]);

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

  // 図に出すノードと線。応答の記事に、案内で足した記事を加え、テーマで絞る。
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
      .map((node) => {
        const state = readStates.get(node.contentId);
        return state === undefined ? node : { ...node, ...state };
      });
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
  }, [galaxy, extraNodes, extraLinks, theme, readStates]);

  // 図を画面に合わせ直すきっかけ。日付かテーマが替わって、案内で足した記事も含めた出すノードの組が
  // 前と替わったら数を進める。案内で関係のある記事を足しただけのときは組を覚え直すだけで数を
  // 進めない（中心を保ったまま図を動かさない）。
  const shownKey = nodes.map((node) => node.contentId).join(",");
  const [fitBasis, setFitBasis] = useState({
    galaxy,
    theme,
    shown: shownKey,
    version: 0,
  });
  if (
    fitBasis.galaxy !== galaxy ||
    fitBasis.theme !== theme ||
    fitBasis.shown !== shownKey
  ) {
    const switched = fitBasis.galaxy !== galaxy || fitBasis.theme !== theme;
    setFitBasis({
      galaxy,
      theme,
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
      <div className="flex flex-wrap items-center gap-3 px-4 py-2 text-sm">
        <label className="inline-flex items-center gap-2">
          日付
          <select
            aria-label="日付"
            value={date ?? ""}
            disabled={dateOptions.length === 0}
            onChange={(event) => chooseDate(event.target.value)}
            className="min-h-11 rounded-md border px-2"
          >
            {dateOptions.map((option) => (
              <option key={option} value={option}>
                {formatListDate(option, thisYear)}
              </option>
            ))}
          </select>
        </label>
        <label className="inline-flex items-center gap-2">
          テーマ
          <select
            aria-label="テーマ"
            value={theme}
            disabled={!hasArticles}
            onChange={(event) => setTheme(event.target.value)}
            className="min-h-11 rounded-md border px-2"
          >
            <option value={ALL_THEMES}>すべて</option>
            {(galaxy?.themes ?? []).map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="relative min-h-[60dvh] flex-1 overflow-hidden">
        {body}
      </div>
      <BottomSheet
        open={opened !== null}
        title="記事の案内"
        onClose={closeSheet}
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
