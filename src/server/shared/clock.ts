// 時計（DD-01 M23）。日時は全てこの時計から読む。テストでは偽の時計で今を決める（DD-10 1章）。

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

export interface FakeClock extends Clock {
  set(at: Date | string): void;
  advance(ms: number): void;
}

// テストが今の日時を決め、進める時計（DD-10 3章 外部の相手の代わり）。
export function createFakeClock(start: Date | string): FakeClock {
  let current = toTime(start);
  return {
    now: () => new Date(current),
    set: (at) => {
      current = toTime(at);
    },
    advance: (ms) => {
      current += ms;
    },
  };
}

function toTime(at: Date | string): number {
  const time = (typeof at === "string" ? new Date(at) : at).getTime();
  if (Number.isNaN(time)) throw new RangeError(`日時として読めない: ${at}`);
  return time;
}
