"use client";

import { useEffect, useState, type CSSProperties } from "react";
import styles from "./cardbreak.module.css";
import { useLiveCardBreak } from "@/app/useLiveCardBreak";

function useCountdown(startedAt: string | null, timerSeconds: number | null) {
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    if (!startedAt || !timerSeconds) {
      setRemaining(null);
      return;
    }

    // SQLite의 datetime('now')는 UTC 기준이라 'Z'를 붙여 명시적으로 파싱합니다.
    const startMs = new Date(`${startedAt.replace(" ", "T")}Z`).getTime();

    const tick = () => {
      const elapsed = Math.floor((Date.now() - startMs) / 1000);
      setRemaining(Math.max(timerSeconds - elapsed, 0));
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [startedAt, timerSeconds]);

  return remaining;
}

function formatTimer(seconds: number | null) {
  if (seconds === null) return "--:--";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function cancelLabel(reason: string | null) {
  return reason === "refunded" ? "환불됨" : "취소됨";
}

/**
 * 유튜브 닉네임이 있으면 "닉네임(구매자명)" 형식으로, 없으면 구매자명만 보여줍니다.
 */
function formatBuyer(userId: string, youtubeNickname: string | null | undefined) {
  return youtubeNickname ? `${youtubeNickname}(${userId})` : userId;
}

const cancelledBadgeStyle: CSSProperties = {
  display: "inline-block",
  marginBottom: 6,
  padding: "3px 8px",
  borderRadius: 6,
  background: "#ff4d5f",
  color: "#fff",
  fontSize: 8,
  fontWeight: 900,
  letterSpacing: "0.04em",
};

export default function CardBreakFrame() {
  const { opening, waiting, hitCards } = useLiveCardBreak();
  const remaining = useCountdown(opening?.started_at ?? null, opening?.timer_seconds ?? null);

  return (
    <div className={styles.stage}>
      <section className={styles.leftPanel}>
        <div className={styles.orderLink}>
          <span className={styles.linkIcon}>◎</span>
          <span>주문 접수 · mangotcg.com</span>
        </div>

        <div className={styles.panelBox}>
          <div className={styles.panelHeader}>
            <strong>오늘의 히트 카드</strong>
          </div>

          <div className={styles.hitList}>
            {hitCards.length === 0 ? (
              <div className={styles.hitRow}>
                <span className={styles.rowIcon}>◆</span>
                <span style={{ opacity: 0.6 }}>등록된 히트카드 없음</span>
              </div>
            ) : (
              hitCards.map((item) => (
                <div className={styles.hitRow} key={item.id}>
                  <span className={styles.rowIcon}>◆</span>
                  <strong>{formatBuyer(item.user_id, item.youtube_nickname)}</strong>
                  <span>{item.card}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      <section className={styles.rightPanel}>
        <div className={styles.nowBox}>
          <div className={styles.nowHeader}>
            <div>
              <strong>오픈 대기 중</strong>
            </div>
            <span className={styles.timer}>{formatTimer(remaining)}</span>
          </div>

          {opening ? (
            <div className={styles.heroCard}>
              {opening.status === "cancelled" && (
                <span style={cancelledBadgeStyle}>{cancelLabel(opening.cancel_reason)}</span>
              )}
              <div className={styles.heroMeta}>
                <span className={styles.gradeTag}>{opening.tier || "ORDER"}</span>
                <div className={styles.currentUser}>{formatBuyer(opening.user_id, opening.youtube_nickname)}</div>
              </div>

              <div className={styles.nowProduct}>
                <span className={styles.nowProductText}>{opening.product}</span>
                <b>x{opening.quantity}</b>
              </div>
            </div>
          ) : (
            <div className={styles.heroCard}>
              <div className={styles.currentUser} style={{ opacity: 0.6, fontSize: 10 }}>
                대기 중인 주문 없음
              </div>
            </div>
          )}

          <div className={styles.queueList}>
            {waiting.map((order) => {
              const cancelled = order.status === "cancelled";

              return (
                <div
                  className={styles.queueRow}
                  key={order.id}
                  style={cancelled ? { opacity: 0.45 } : undefined}
                >
                  <span className={styles.gradeMini}>
                    {cancelled ? cancelLabel(order.cancel_reason) : order.tier || "-"}
                  </span>
                  <strong>{formatBuyer(order.user_id, order.youtube_nickname)}</strong>
                  <span className={styles.product}>{order.product}</span>
                  <b>x{order.quantity}</b>
                </div>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
}
