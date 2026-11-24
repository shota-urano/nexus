"use client";
// 試作の切り替え（P01・P03・P04・P05）。端末の localStorage に置く。
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type Settings = {
  homeMode: "separate" | "single"; // P01
  graph: "svg" | "flow"; // P03
  ipadChat: "sheet" | "right"; // P04
  bottomTabs: boolean; // P05
};
// 2026-11-24 本人の答え: P03 は React Flow、P04 は下から出る面、P05 は下の帯なし。切り替えは外した。
const DEFAULT: Settings = { homeMode: "separate", graph: "flow", ipadChat: "sheet", bottomTabs: false };
const Ctx = createContext<{ s: Settings; set: (p: Partial<Settings>) => void }>({ s: DEFAULT, set: () => {} });

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [s, setS] = useState<Settings>(DEFAULT);
  useEffect(() => { try { localStorage.removeItem("nexus-proto"); } catch {} }, []);
  const set = (p: Partial<Settings>) =>
    setS((cur) => {
      const n = { ...cur, ...p };
      try { localStorage.setItem("nexus-proto", JSON.stringify(n)); } catch {}
      return n;
    });
  return <Ctx.Provider value={{ s, set }}>{children}</Ctx.Provider>;
}
export const useSettings = () => useContext(Ctx);

function Switcher() {
  const { s, set } = useSettings();
  const [open, setOpen] = useState(false);
  return (
    <div className="switcher">
      {open && (
        <div className="panel">
          <b>試作の切り替え</b>
          <label>P01 ホーム:{" "}
            <select value={s.homeMode} onChange={(e) => set({ homeMode: e.target.value as Settings["homeMode"] })}>
              <option value="separate">選ぶと移るを分ける</option>
              <option value="single">1回で移る</option>
            </select>
          </label>
          <label>P03 図:{" "}
            <select value={s.graph} onChange={(e) => set({ graph: e.target.value as Settings["graph"] })}>
              <option value="svg">SVG と Motion</option>
              <option value="flow">React Flow</option>
            </select>
          </label>
          <label>P04 iPad のチャット:{" "}
            <select value={s.ipadChat} onChange={(e) => set({ ipadChat: e.target.value as Settings["ipadChat"] })}>
              <option value="sheet">下から出る面</option>
              <option value="right">右の区画</option>
            </select>
          </label>
          <label><input type="checkbox" checked={s.bottomTabs} onChange={(e) => set({ bottomTabs: e.target.checked })} /> P05 下の帯を置く</label>
        </div>
      )}
      <button onClick={() => setOpen(!open)} aria-label="試作の切り替え">⚙</button>
    </div>
  );
}
