// 機能のカードの置き方（BD-03 SCR-001-A02、3.2「画面幅による違い」。BD-13 P02）。
// - 選んだ機能のカードを前（並びの位置 0）に出し、ほかを上下に奥へ薄く置く。
// - 幅 480 ピクセル以下では、前のカードの高さを測り、次のカードを前のカードのすぐ下に、
//   前の（上の）カードを前のカードのすぐ上に詰める。カードの中身（知らせ、写真など）で高さが変わるため、
//   固定の位置にしない（BD-13 P02 の本人の指摘「スマホ時に右のカードの上下の間隔があきすぎ」）。

export interface Slot {
  /** 上下の位置（ピクセル。並びの真ん中から。カードの上の端） */
  y: number;
  /** 傾き（度） */
  tilt: number;
  scale: number;
  opacity: number;
}

// 並びの位置（cardOffset）ごとの置き方。
export const SLOTS: Record<number, Slot> = {
  [-2]: { y: -210, tilt: -10, scale: 0.7, opacity: 0 },
  [-1]: { y: -150, tilt: -7, scale: 0.84, opacity: 0.62 },
  0: { y: -70, tilt: -4, scale: 1, opacity: 1 },
  1: { y: 76, tilt: 5, scale: 0.87, opacity: 0.72 },
  2: { y: 140, tilt: 8, scale: 0.74, opacity: 0.25 },
  3: { y: 190, tilt: 10, scale: 0.6, opacity: 0 },
};

// 幅 480 ピクセル以下の置き方。y は高さを測れないとき（描く前）の値で、測れたら narrowSlots が詰める。
export const SLOTS_NARROW: Record<number, Slot> = {
  [-2]: { y: -160, tilt: -8, scale: 0.74, opacity: 0 },
  [-1]: { y: -128, tilt: -6, scale: 0.86, opacity: 0.6 },
  0: { y: -80, tilt: -3, scale: 1, opacity: 1 },
  1: { y: 92, tilt: 4, scale: 0.88, opacity: 0.7 },
  2: { y: 136, tilt: 6, scale: 0.76, opacity: 0.3 },
  3: { y: 170, tilt: 8, scale: 0.6, opacity: 0 },
};

/** 幅 480 ピクセル以下で、隣のカードと前のカードのあいだに空ける長さ（ピクセル） */
export const NARROW_GAP = 6;
// 次のカードより奥のカードを、1つ奥ごとにずらす長さ（ピクセル。BD-13 の試作と同じ）。
const NARROW_PEEK = 44;

/**
 * 幅 480 ピクセル以下の置き方を、測ったカードの高さから決める。
 * カードは上の端を軸に縮める（transform-origin: top right）ので、縮めた高さは「高さ × scale」。
 * @param frontHeight 前のカードの高さ（ピクセル）。測れていなければ 0
 * @param aboveHeight 前の（上の）カードの高さ（ピクセル）。測れていなければ 0
 */
export function narrowSlots(
  frontHeight: number,
  aboveHeight: number,
): Record<number, Slot> {
  const base = SLOTS_NARROW;
  const frontTop = base[0].y;
  const slots = { ...base };
  if (frontHeight > 0) {
    const nextTop = frontTop + frontHeight + NARROW_GAP;
    slots[1] = { ...base[1], y: nextTop };
    slots[2] = { ...base[2], y: nextTop + NARROW_PEEK };
    slots[3] = { ...base[3], y: nextTop + NARROW_PEEK * 2 };
  }
  if (aboveHeight > 0) {
    const aboveTop = frontTop - NARROW_GAP - aboveHeight * base[-1].scale;
    slots[-1] = { ...base[-1], y: aboveTop };
    slots[-2] = { ...base[-2], y: aboveTop - (base[-1].y - base[-2].y) };
  }
  return slots;
}
