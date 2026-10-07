"use client";

import { useEffect, useState } from "react";
import { type LiveOrder, useLiveCardBreak } from "@/app/useLiveCardBreak";
import styles from "./new-overlay.module.css";

type Props = {
  /** 관리자 화면에서는 9:16 비율로만 새 템플릿을 확인합니다. */
  preview?: boolean;
};

type RankingRow = {
  rank: number;
  youtubeNickname: string | null;
  orderCount: number;
};

function nickname(value: string | null | undefined) {
  return (value ?? "-").replace(/\([^)]*\)/g, "").trim() || "-";
}

export default function NewOverlayFrame({ preview = false }: Props) {
  const { opening, waiting, hitCards } = useLiveCardBreak();
  const [ranking, setRanking] = useState<RankingRow[]>([]);
  const activeOrder = opening ?? waiting[0] ?? null;
  const nextOrder = waiting[0] ?? null;
  const champion = ranking[0] ?? null;
  const challengers = ranking.slice(1);

  useEffect(() => {
    let cancelled = false;
    const loadRanking = () => {
      fetch("/api/overlay-ranking", { cache: "no-store" })
        .then((response) => response.ok ? response.json() : Promise.reject(new Error("ranking failed")))
        .then((data: { ranking?: RankingRow[] }) => {
          if (!cancelled) setRanking((data.ranking ?? []).slice(0, 3));
        })
        .catch(() => {
          if (!cancelled) setRanking([]);
        });
    };
    loadRanking();
    const timer = window.setInterval(loadRanking, 30_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);

  return (
    <main className={`${styles.shell} ${preview ? styles.previewShell : styles.liveShell}`} aria-label="망고TCG 신규 라이브 오버레이">
      <div className={styles.sparkField} aria-hidden="true">
        {Array.from({ length: 12 }, (_, index) => <i key={index} />)}
      </div>

      <section className={`${styles.panel} ${styles.queuePanel}`}>
        <header className={styles.panelHeader}>
          <span className={styles.crown}>♛</span>
          <div><small>HALL OF FAME</small><strong>명예의 전당</strong></div>
          <b>TOP 3</b>
        </header>
        <div className={styles.rankingList}>
          {champion ? (
            <div className={`${styles.rankingRow} ${styles.queueLead}`}>
              <em>1</em>
              <span>{nickname(champion.youtubeNickname)}</span>
              <b>{champion.orderCount}건</b>
            </div>
          ) : <div className={styles.emptyRow}>명예의 전당 집계 중</div>}
          {challengers.length > 0 && (
            <div className={styles.rankingFlowViewport} aria-label="명예의 전당 2위 이하 순위">
              <div className={`${styles.rankingFlowTrack} ${challengers.length > 1 ? styles.rankingFlowActive : ""}`}>
                {(challengers.length > 1 ? [false, true] : [false]).map((copy) => (
                  <div className={styles.rankingFlowGroup} key={copy ? "next-cycle" : "current-cycle"} aria-hidden={copy || undefined}>
                    {challengers.map((row) => (
                      <div className={styles.rankingRow} key={`${row.rank}-${copy ? "next" : "current"}`}>
                        <em>{row.rank}</em>
                        <span>{nickname(row.youtubeNickname)}</span>
                        <b>{row.orderCount}건</b>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      <section className={`${styles.panel} ${styles.livePanel}`}>
        <header className={styles.liveHeader}>
          <span className={styles.liveDot} />
          <small>MANGO TCG LIVE</small>
          <strong>실시간 카드브레이크</strong>
        </header>
        <div className={styles.liveShine} aria-hidden="true" />
        <p>빛나는 순간을 실시간으로 함께합니다</p>
      </section>

      <section className={`${styles.panel} ${styles.currentPanel}`}>
        <header className={styles.currentHeader}>
          <span>NOW OPENING</span>
          <b>{opening ? "진행 중" : "대기 중"}</b>
        </header>
        {activeOrder ? (
          <div className={styles.currentBody}>
            <strong>{nickname(activeOrder.youtube_nickname) === "-" ? activeOrder.user_id : nickname(activeOrder.youtube_nickname)}</strong>
            <b>{activeOrder.product}</b>
            <span>× {activeOrder.quantity}</span>
          </div>
        ) : <p className={styles.currentEmpty}>현재 오픈 주문을 기다리고 있습니다</p>}
        <div className={styles.hitLine}>
          <span>HIT</span>
          <b>{hitCards[0] ? `◆ ${nickname(hitCards[0].youtube_nickname)} · ${hitCards[0].card}` : "오늘의 히트카드를 기다리는 중"}</b>
        </div>
        <div className={styles.waitingLine}>
          <span>주문 대기</span>
          <b>{nextOrder ? `${nickname(nextOrder.youtube_nickname) === "-" ? nextOrder.user_id : nickname(nextOrder.youtube_nickname)} · ${nextOrder.product}` : "대기 주문 없음"}</b>
          <em>{waiting.length}건</em>
        </div>
      </section>
    </main>
  );
}
