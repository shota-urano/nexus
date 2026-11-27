"use client";

import {
  type Edge,
  Handle,
  type Node,
  type NodeProps,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useEffect, useMemo } from "react";
import type { GalaxyLink, GalaxyNode } from "../../contracts/news";
import { useReduceMotion } from "../../ui/motion";
import { NewsNodeCard } from "../../ui/kinds/news/news-node-card";
import { RELATION_TYPE_LABELS } from "../../ui/kinds/news/relation-type";
import { layoutGalaxy } from "./galaxy-layout";

// ニュースの図（DD-01 M03。BD-03 SCR-002 の 3.2、X-02 ADR-015）。React Flow で描き、ノードの中身は
// M08 の記事のカードで描く。React Flow を読み込むのは M03 のこの部品だけにする（DD-01 3章）。
// - 線は細く光る線にし、関係の種類の名前は中心の記事の線にだけ出す（文字が重ならないため）。
// - 中心が移ったら、ノードを新しい置き場所へ動かし、図を画面に合わせる。動きを減らす設定の
//   ときは動かさずに切り替える（BD-09 5章 アクセシビリティ）。
// - ノードを押すと `onSelect` を呼ぶ（SCR-002-A04）。ノードは指で動かさない。
// - `locked` の間（記事の案内の面を開いている間）は、図を指でずらす操作と拡大縮小を切る
//   （面の中のスクロールで後ろの図が動かないため。BD-03 SCR-002・SCR-003）。

type ArticleNodeData = {
  node: GalaxyNode;
  isCenter: boolean;
  date: string;
  thisYear: number;
};
type ArticleFlowNode = Node<ArticleNodeData, "article">;

function ArticleNode({ data }: NodeProps<ArticleFlowNode>) {
  return (
    <>
      <Handle
        type="target"
        position={Position.Top}
        isConnectable={false}
        className="!border-0 !bg-transparent"
      />
      <NewsNodeCard
        node={data.node}
        isCenter={data.isCenter}
        date={data.date}
        thisYear={data.thisYear}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        isConnectable={false}
        className="!border-0 !bg-transparent"
      />
    </>
  );
}

const NODE_TYPES = { article: ArticleNode };
const PRO_OPTIONS = { hideAttribution: true };

export function GalaxyGraph(props: GraphProps) {
  return (
    <ReactFlowProvider>
      <Graph {...props} />
    </ReactFlowProvider>
  );
}

interface GraphProps {
  nodes: readonly GalaxyNode[];
  links: readonly GalaxyLink[];
  /** 図で選んでいる日 */
  date: string;
  center: number | null;
  thisYear: number;
  onSelect: (contentId: number) => void;
  /** true の間は、図を指でずらす操作と拡大縮小を受け付けない（記事の案内の面を開いている間） */
  locked?: boolean;
  /**
   * 図を画面に合わせ直すきっかけになる、出すノードの組。替わったとき（と中心が移ったとき）だけ
   * 合わせ直す。案内で関係のある記事を足しただけでは替えない（中心を保ったまま動かさない）
   */
  fitKey: string;
}

function Graph({
  nodes,
  links,
  date,
  center,
  thisYear,
  onSelect,
  locked = false,
  fitKey,
}: GraphProps) {
  const reduceMotion = useReduceMotion();
  const { fitView } = useReactFlow();

  const flowNodes = useMemo<ArticleFlowNode[]>(() => {
    const positions = layoutGalaxy(nodes, links, date, center);
    return nodes.map((node) => ({
      id: String(node.contentId),
      type: "article",
      position: positions.get(node.contentId) ?? { x: 0, y: 0 },
      data: { node, isCenter: node.contentId === center, date, thisYear },
      draggable: false,
      connectable: false,
      className: reduceMotion
        ? undefined
        : "transition-transform duration-500 ease-out",
    }));
  }, [nodes, links, date, center, thisYear, reduceMotion]);

  const flowEdges = useMemo<Edge[]>(() => {
    const ids = new Set(nodes.map((node) => node.contentId));
    return links
      .filter(
        (link) => ids.has(link.fromContentId) && ids.has(link.toContentId),
      )
      .map((link) => {
        const onCenter =
          center !== null &&
          (link.fromContentId === center || link.toContentId === center);
        return {
          id: `${link.fromContentId}-${link.toContentId}-${link.relationType}`,
          source: String(link.fromContentId),
          target: String(link.toContentId),
          type: "straight",
          label: onCenter ? RELATION_TYPE_LABELS[link.relationType] : undefined,
          style: {
            stroke: onCenter ? "#ffb040" : "rgba(255,176,64,0.35)",
            strokeWidth: onCenter ? 1.5 : 0.8,
            filter: "drop-shadow(0 0 3px rgba(255,176,64,0.6))",
          },
          labelStyle: { fill: "#ffb040", fontSize: 10 },
          labelBgStyle: { fill: "#07080d" },
        };
      });
  }, [nodes, links, center]);

  // 中心が移るか、出すノードの組（fitKey）が替わったら、図を画面に合わせる。
  useEffect(() => {
    const timer = setTimeout(() => {
      void fitView({ padding: 0.2, duration: reduceMotion ? 0 : 500 });
    }, 0);
    return () => clearTimeout(timer);
  }, [fitView, fitKey, center, reduceMotion]);

  return (
    <ReactFlow
      nodes={flowNodes}
      edges={flowEdges}
      nodeTypes={NODE_TYPES}
      onNodeClick={(_, node) => onSelect(Number(node.id))}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={false}
      panOnDrag={!locked}
      zoomOnPinch={!locked}
      zoomOnScroll={!locked}
      zoomOnDoubleClick={!locked}
      fitView
      minZoom={0.2}
      proOptions={PRO_OPTIONS}
      colorMode="dark"
      style={{ background: "#06080e" }}
    />
  );
}
