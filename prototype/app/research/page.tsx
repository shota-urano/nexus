"use client";
// SCR-010 課題の一覧の試作（Q-095、CR-020）。データは作り物。
import "../home.css";
import "./research.css";
import Link from "next/link";
import { formatDate } from "@/lib/data";
import { topics } from "@/lib/research";

export default function ResearchList() {
  return (
    <>
      <div className="bg-stars" />
      <main className="r-page">
        <div className="r-top">
          <Link href="/" aria-label="ホーム"><img src="/img/logo.png" alt="" /></Link>
          <h1><b>Research</b></h1>
        </div>
        {topics.map((t) => (
          <div className="r-card" key={t.topicId}>
            <Link className="r-topic" href={`/research/report?id=${t.latestContentId}`}>
              <span className={`r-dot${t.hasUnread ? "" : " off"}`} aria-label={t.hasUnread ? "未読の週報あり" : undefined} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <h2>{t.title}</h2>
                <div className="r-meta">
                  <span className={`r-status${t.status === "ended" ? " ended" : ""}`}>{t.status === "ended" ? "終了" : "進行中"}</span>
                  <span>{t.lastWeek}週目</span>
                  <span>{formatDate(t.lastReceivedOn)}</span>
                </div>
              </div>
              <span style={{ color: "#ffb85e", fontSize: 20 }}>›</span>
            </Link>
          </div>
        ))}
      </main>
    </>
  );
}
