// HUD の回転の角度の計算（BD-03 SCR-001-A02）。角度は度で、SVG の向き（時計回りが正）。
// セグメント i の真ん中は、回す前に右の真ん中（0度）から i × STEP の位置にある。
// HUD を `turn` だけ回すと、右の真ん中に来るのは `-turn / STEP` に一番近いセグメントである。

// 1つのセグメントの角度。HUD は7つのセグメント（FEATURES の数。CR-020。7分割は Q-095 の答えで試作のまま）。
export const STEP_DEGREES = 360 / 7;

// -180 以上 180 未満にそろえる。
export function normalizeDegrees(degrees: number): number {
  return ((((degrees + 180) % 360) + 360) % 360) - 180;
}

// 回した角度で、右の真ん中に一番近いセグメントの番号。
export function selectedAt(turn: number, count: number): number {
  const index = Math.round(-turn / STEP_DEGREES) % count;
  return (index + count) % count;
}

// セグメント `index` を右の真ん中に置く角度のうち、今の角度から近い向きに回る値。
export function turnToSelect(turn: number, index: number): number {
  return turn + normalizeDegrees(-index * STEP_DEGREES - turn);
}

// 指を離したときに、いちばん近いセグメントに合わせた角度。
export function snapTurn(turn: number): number {
  return Math.round(turn / STEP_DEGREES) * STEP_DEGREES;
}

// カードの並びの位置。選んだ機能を 0、時計回りの次を 1、前を -1 とし、
// -count/2 より大きく count/2 以下にそろえる。
export function cardOffset(index: number, selected: number, count: number) {
  let offset = (index - selected) % count;
  if (offset > count / 2) offset -= count;
  if (offset <= -count / 2) offset += count;
  return offset;
}
