"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { FullNotice } from "./full-notice";
import type { FullNoticeId } from "./full-notice-messages";

// 画面の共通の枠（DD-01 M01）。全面の知らせ（MSG-020、MSG-021。BD-09 1.1）と、
// service worker の登録（DD-09 2.1）を受け持つ。
// - 登録の URL が使えないときの `/?notice=MSG-021`（DD-04 `openRegistration`）は、
//   道 `/` の page（../page.tsx）が出す。
// - 端末の API が 401 を返したら（DD-04 3.4。MSG-020）、`useDeviceApi()` が知らせを出す。
// 知らせを出している間は、画面の中身を出さない。

const ShowFullNoticeContext = createContext<(id: FullNoticeId) => void>(
  () => {},
);

// 画面から全面の知らせを出す関数を受け取る。
export function useFullNotice(): (id: FullNoticeId) => void {
  return useContext(ShowFullNoticeContext);
}

// 画面が端末の API（`/api/app/`）を呼ぶときに使う fetch。`/api/app/` の 401 は
// 端末の鍵が通らないときだけで、いつも MSG-020 になる（DD-04 3.1、3.4。DD-06 E03）ので、
// 401 を受けたら全面の知らせ MSG-020 を出す。応答はそのまま画面に返す。
export function useDeviceApi(): typeof fetch {
  const showFullNotice = useFullNotice();
  return useCallback<typeof fetch>(
    async (input, init) => {
      const response = await fetch(input, init);
      if (response.status === 401) showFullNotice("MSG-020");
      return response;
    },
    [showFullNotice],
  );
}

export const SERVICE_WORKER_URL = "/sw.js";

export function AppFrame({ children }: { children: ReactNode }) {
  const [notice, setNotice] = useState<FullNoticeId | null>(null);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    // 登録できなくても画面は使える（保存しないだけ）ので、失敗は画面に出さない。
    navigator.serviceWorker.register(SERVICE_WORKER_URL).catch(() => undefined);
  }, []);

  return (
    <ShowFullNoticeContext.Provider value={setNotice}>
      {notice === null ? children : <FullNotice messageId={notice} />}
    </ShowFullNoticeContext.Provider>
  );
}
