import type { GalaxyLink, GalaxyNode } from "../../contracts/news";

// ニュースの図のノードの置き場所（DD-01 M03。BD-03 SCR-002 の 3.2、RD-03 R04）。
// - 中心を決めていないとき（初めて開いたとき）は、作り物の中心を置かず、選んだ日の記事を輪に並べ、
//   関係の先の記事を外の輪に並べる。
// - 中心を決めたときは、中心の記事を真ん中に置き、線でつながる記事を近い輪に、ほかを外の輪に並べる。
// 並べる順は渡したノードの順にする（同じ図はいつも同じ形になる）。

export type Positions = Map<number, { x: number; y: number }>;

const INNER_RADIUS = 190;
const OUTER_GAP = 170;
// 輪に並べたときの、隣のノードとの間の長さの目安（ノードの幅より広くする）。
const NODE_SPACING = 150;

function ring(ids: number[], radius: number, positions: Positions): void {
  const r = Math.max(radius, (ids.length * NODE_SPACING) / (2 * Math.PI));
  ids.forEach((id, index) => {
    const angle = (index / ids.length) * Math.PI * 2 - Math.PI / 2;
    positions.set(id, {
      x: Math.round(r * Math.cos(angle)),
      y: Math.round(r * Math.sin(angle)),
    });
  });
}

export function layoutGalaxy(
  nodes: readonly GalaxyNode[],
  links: readonly GalaxyLink[],
  date: string,
  center: number | null,
): Positions {
  const positions: Positions = new Map();
  const ids = nodes.map((node) => node.contentId);
  if (center === null || !ids.includes(center)) {
    const ofDate = nodes
      .filter((node) => node.targetDate === date)
      .map((node) => node.contentId);
    const others = ids.filter((id) => !ofDate.includes(id));
    ring(ofDate, INNER_RADIUS, positions);
    const inner = Math.max(
      INNER_RADIUS,
      (ofDate.length * NODE_SPACING) / (2 * Math.PI),
    );
    ring(others, inner + OUTER_GAP, positions);
    return positions;
  }
  positions.set(center, { x: 0, y: 0 });
  const near = new Set<number>();
  for (const link of links) {
    if (link.fromContentId === center) near.add(link.toContentId);
    if (link.toContentId === center) near.add(link.fromContentId);
  }
  const nearIds = ids.filter((id) => id !== center && near.has(id));
  const rest = ids.filter((id) => id !== center && !near.has(id));
  ring(nearIds, INNER_RADIUS, positions);
  const inner = Math.max(
    INNER_RADIUS,
    (nearIds.length * NODE_SPACING) / (2 * Math.PI),
  );
  ring(rest, inner + OUTER_GAP, positions);
  return positions;
}
