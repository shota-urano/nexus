"use client";

import { motion } from "motion/react";
import {
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useRef,
  useState,
} from "react";
import { type Feature, FeatureIcon } from "./features";
import { STEP_DEGREES, normalizeDegrees } from "./hud-angle";

// 円形 HUD（BD-03 SCR-001-O01、O02、A02、A05）。
// - 6つのセグメントを円形に並べ、右の真ん中（0度）に来たセグメントを選んだ機能として光らせる。
// - 指で回すと回り（`onDrag`）、離すと `onRelease` で一番近い機能に合わせる。
//   セグメントを押すと `onPick` で、その機能が右の真ん中に来るまで回す。
// - 中心の AI の印を押すと `onCenter`（対象の無い AI チャット。A05）。
// - 動きを減らす設定（NFR-008、BD-09 5章）のときは、回転の動きを使わず、回した後の角度で描く。
// 回転の角度と選んだ機能は、カードと合わせるため画面（home-screen）が持つ。

// 回す動きの長さ（秒）。
const TURN_SECONDS = 0.45;
// 指が動いたと見なす角度（度）。これより小さい動きは押したことにする。
const DRAG_START_DEGREES = 4;

// 輪の内側と外側の半径と、名前を置く半径（viewBox の単位）。
const INNER_RADIUS = 58;
const OUTER_RADIUS = 122;
const LABEL_RADIUS = 90;

function point(radius: number, radians: number): string {
  return `${radius * Math.cos(radians)} ${radius * Math.sin(radians)}`;
}

function sectorPath(index: number): string {
  const center = (index * STEP_DEGREES * Math.PI) / 180;
  const half = (STEP_DEGREES / 2) * (Math.PI / 180) - 0.03;
  const a0 = center - half;
  const a1 = center + half;
  return [
    `M ${point(OUTER_RADIUS, a0)}`,
    `A ${OUTER_RADIUS} ${OUTER_RADIUS} 0 0 1 ${point(OUTER_RADIUS, a1)}`,
    `L ${point(INNER_RADIUS, a1)}`,
    `A ${INNER_RADIUS} ${INNER_RADIUS} 0 0 0 ${point(INNER_RADIUS, a0)}`,
    "Z",
  ].join(" ");
}

// `angle` だけ (cx, cy) のまわりに回した群。動きを減らす設定のときは、動かさずにその角度で描く。
function Turned({
  angle,
  cx,
  cy,
  reduceMotion,
  instant,
  testId,
  children,
}: {
  angle: number;
  cx: number;
  cy: number;
  reduceMotion: boolean;
  /** 指で回している間など、動きを付けずに今の角度へ合わせるとき */
  instant: boolean;
  testId?: string;
  children: ReactNode;
}) {
  if (reduceMotion) {
    return (
      <g data-testid={testId} transform={`rotate(${angle} ${cx} ${cy})`}>
        {children}
      </g>
    );
  }
  return (
    <motion.g
      data-testid={testId}
      initial={false}
      animate={{ rotate: angle }}
      transition={{ duration: instant ? 0 : TURN_SECONDS, ease: "easeInOut" }}
      style={{ transformBox: "fill-box", originX: 0.5, originY: 0.5 }}
    >
      {children}
    </motion.g>
  );
}

export function Hud({
  features,
  selected,
  turn,
  reduceMotion,
  onPick,
  onDrag,
  onRelease,
  onCenter,
}: {
  features: readonly Feature[];
  selected: number;
  turn: number;
  reduceMotion: boolean;
  onPick: (index: number) => void;
  onDrag: (turn: number) => void;
  onRelease: () => void;
  onCenter: () => void;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<{
    startAngle: number;
    startTurn: number;
    moved: boolean;
  } | null>(null);
  // 指で回した直後の押しを、セグメントの押しとして受けない。
  const suppressClickRef = useRef(false);
  // 指で回している間は、動きを付けずに指に合わせる。
  const [dragging, setDragging] = useState(false);

  function angleOf(event: PointerEvent<SVGSVGElement>): number {
    const svg = svgRef.current;
    if (svg === null) return 0;
    const box = svg.getBoundingClientRect();
    const dx = event.clientX - (box.left + box.width / 2);
    const dy = event.clientY - (box.top + box.height / 2);
    return (Math.atan2(dy, dx) * 180) / Math.PI;
  }

  function handlePointerDown(event: PointerEvent<SVGSVGElement>) {
    suppressClickRef.current = false;
    dragRef.current = {
      startAngle: angleOf(event),
      startTurn: turn,
      moved: false,
    };
  }

  function handlePointerMove(event: PointerEvent<SVGSVGElement>) {
    const drag = dragRef.current;
    if (drag === null) return;
    const delta = normalizeDegrees(angleOf(event) - drag.startAngle);
    if (!drag.moved && Math.abs(delta) > DRAG_START_DEGREES) {
      drag.moved = true;
      setDragging(true);
      event.currentTarget.setPointerCapture?.(event.pointerId);
    }
    if (drag.moved) onDrag(drag.startTurn + delta);
  }

  function handlePointerUp() {
    const drag = dragRef.current;
    dragRef.current = null;
    setDragging(false);
    if (drag === null || !drag.moved) return;
    suppressClickRef.current = true;
    onRelease();
  }

  function press(action: () => void) {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    action();
  }

  function handleKey(event: KeyboardEvent, action: () => void) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    action();
  }

  const instant = dragging;

  return (
    <svg
      ref={svgRef}
      viewBox="-135 -135 270 270"
      className="size-full touch-none overflow-visible select-none"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      <defs>
        <radialGradient
          id="hud-segment"
          cx="0"
          cy="0"
          r="130"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="40%" stopColor="#2b303b" />
          <stop offset="100%" stopColor="#1a1f29" />
        </radialGradient>
        <radialGradient
          id="hud-segment-on"
          cx="0"
          cy="0"
          r="130"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="40%" stopColor="#6b4520" />
          <stop offset="100%" stopColor="#c27a35" />
        </radialGradient>
      </defs>
      <circle
        r="131"
        fill="none"
        stroke="rgba(255,176,64,0.28)"
        strokeDasharray="1 5"
      />
      <Turned
        angle={turn}
        cx={0}
        cy={0}
        reduceMotion={reduceMotion}
        instant={instant}
        testId="hud-ring"
      >
        {features.map((feature, index) => {
          const on = index === selected;
          const radians = (index * STEP_DEGREES * Math.PI) / 180;
          const lx = LABEL_RADIUS * Math.cos(radians);
          const ly = LABEL_RADIUS * Math.sin(radians);
          return (
            <g
              key={feature.key}
              role="button"
              tabIndex={0}
              aria-label={feature.name}
              aria-pressed={on}
              className="cursor-pointer outline-none"
              onClick={() => press(() => onPick(index))}
              onKeyDown={(event) => handleKey(event, () => onPick(index))}
            >
              <path
                d={sectorPath(index)}
                fill={on ? "url(#hud-segment-on)" : "url(#hud-segment)"}
                stroke={on ? "#ffd08a" : "rgba(183,193,211,0.22)"}
                strokeWidth={1.2}
                style={
                  on ? { filter: "drop-shadow(0 0 6px #ffb04099)" } : undefined
                }
              />
              {/* 名前は HUD の回転と逆に回し、いつも正立させる */}
              <Turned
                angle={-turn}
                cx={lx}
                cy={ly}
                reduceMotion={reduceMotion}
                instant={instant}
              >
                <g transform={`translate(${lx - 11} ${ly - 24}) scale(0.7)`}>
                  <FeatureIcon feature={feature} />
                </g>
                <text
                  x={lx}
                  y={ly + 10}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize="11"
                  fontWeight="600"
                  fill={on ? "#ffffff" : "#d4d8e2"}
                  aria-hidden="true"
                >
                  {feature.name}
                </text>
              </Turned>
            </g>
          );
        })}
      </Turned>
      <g
        role="button"
        tabIndex={0}
        aria-label="AI チャットを開く"
        className="cursor-pointer outline-none"
        onClick={() => press(onCenter)}
        onKeyDown={(event) => handleKey(event, onCenter)}
      >
        <circle r="54" fill="#07090e" stroke="rgba(255,190,110,0.35)" />
        <circle
          r="22"
          fill="none"
          stroke="#ffc077"
          strokeWidth="1.5"
          style={{ filter: "drop-shadow(0 0 8px #ffb040)" }}
        />
        <path
          d="M0 -14 L4 -4 L14 0 L4 4 L0 14 L-4 4 L-14 0 L-4 -4 Z"
          fill="#ffd08a"
          style={{ filter: "drop-shadow(0 0 6px #ffb040)" }}
        />
      </g>
    </svg>
  );
}
