"use client";

import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import { FullNotice } from "./full-notice";
import { type FullNoticeId, isFullNoticeId } from "./full-notice-messages";

// 画面の共通の枠（DD-01 M01）。全面の知らせ（MSG-020、MSG-021。BD-09 1.1）と、
// service worker の登録（DD-09 2.1）を受け持つ。
// - 登録の URL が使えないとき、Web サーバは `/?notice=MSG-021` へ移す（DD-04 `openRegistration`）。
//   道の `notice` が全面の知らせの MSG なら、それを出す。
// - 端末の API が 401 を返したら（DD-04 3.4。MSG-020）、画面が `useFullNotice()` で知らせを出す。
// 知らせを出している間は、画面の中身を出さない。

const ShowFullNoticeContext = createContext<(id: FullNoticeId) => void>(
  () => {},
);

// 画面から全面の知らせを出す関数を受け取る。
export function useFullNotice(): (id: FullNoticeId) => void {
  return useContext(ShowFullNoticeContext);
}

function subscribeNothing(): () => void {
  return () => {};
}

function noticeFromLocation(): FullNoticeId | null {
  const notice = new URLSearchParams(window.location.search).get("notice");
  return isFullNoticeId(notice) ? notice : null;
}

function noticeOnServer(): null {
  return null;
}

export const SERVICE_WORKER_URL = "/sw.js";

export function AppFrame({ children }: { children: ReactNode }) {
  const [shown, setShown] = useState<FullNoticeId | null>(null);
  const fromLocation = useSyncExternalStore(
    subscribeNothing,
    noticeFromLocation,
    noticeOnServer,
  );
  const notice = shown ?? fromLocation;

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    // 登録できなくても画面は使える（保存しないだけ）ので、失敗は画面に出さない。
    navigator.serviceWorker.register(SERVICE_WORKER_URL).catch(() => undefined);
  }, []);

  return (
    <ShowFullNoticeContext.Provider value={setShown}>
      {notice === null ? children : <FullNotice messageId={notice} />}
    </ShowFullNoticeContext.Provider>
  );
}
