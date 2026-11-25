// 通信層 M09（DD-01 1.1）。画面が端末の API（`/api/app/`）を呼ぶ1か所。
// `/api/app/` の 401 は端末の鍵が通らないときだけで、いつも MSG-020 になる
// （DD-04 3.1、3.4。DD-06 E03）。401 を受けたら、届け先として登録した画面（M01 の枠）に
// そのまま渡す。応答は呼んだ画面にもそのまま返す。

type UnauthorizedListener = () => void;

const unauthorizedListeners = new Set<UnauthorizedListener>();

// 端末の API が 401（MSG-020）を返したときの届け先を登録する。返り値で登録を外す。
export function onDeviceUnauthorized(
  listener: UnauthorizedListener,
): () => void {
  unauthorizedListeners.add(listener);
  return () => {
    unauthorizedListeners.delete(listener);
  };
}

// 端末の API を呼ぶ。
export const deviceFetch: typeof fetch = async (input, init) => {
  const response = await fetch(input, init);
  if (response.status === 401) {
    for (const listener of [...unauthorizedListeners]) listener();
  }
  return response;
};
