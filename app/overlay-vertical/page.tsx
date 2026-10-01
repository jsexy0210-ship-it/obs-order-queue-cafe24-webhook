"use client";

import { useLiveCardBreak } from "@/app/useLiveCardBreak";
import styles from "./vertical.module.css";

function nickname(value: string | null | undefined) {
  return (value ?? "-").replace(/\([^)]*\)/g, "").trim() || "-";
}

export default function VerticalOverlay() {
  const { opening, waiting, hitCards } = useLiveCardBreak();
  const activeOrder = opening ?? waiting[0] ?? null;

  return (
    <main className={styles.stage}>
      <section className={styles.hitPanel}>
        <header><span>◆</span><strong>오늘의 히트카드</strong></header>
        <div className={styles.hitRows}>
          {hitCards.slice(0, 5).map((hit) => (
            <p key={hit.id}><b>{nickname(hit.youtube_nickname)}</b><span>{hit.card}</span></p>
          ))}
          {hitCards.length === 0 && <p className={styles.empty}>등록된 히트카드 없음</p>}
        </div>
      </section>

      <section className={styles.currentPanel}>
        <header><strong>지금 오픈 중</strong><span className={styles.liveDot}>LIVE</span></header>
        {activeOrder ? (
          <div className={styles.currentBody}>
            <span className={activeOrder.is_first_order ? styles.firstBadge : styles.openBadge}>{activeOrder.is_first_order ? "첫주문" : "오픈"}</span>
            <b>{nickname(activeOrder.youtube_nickname)}</b>
            <p>{activeOrder.product}</p>
            <strong>× {activeOrder.quantity}</strong>
          </div>
        ) : <div className={styles.empty}>대기 중인 주문 없음</div>}
      </section>

      <section className={styles.queuePanel}>
        <header><strong>대기 주문</strong><span>{waiting.length}건</span></header>
        <div className={styles.queueRows}>
          {waiting.slice(0, 4).map((order, index) => (
            <p key={order.id}><i>{index + 1}</i><b>{nickname(order.youtube_nickname)}</b><span>{order.product}</span><strong>×{order.quantity}</strong></p>
          ))}
          {waiting.length === 0 && <p className={styles.empty}>대기 중인 주문 없음</p>}
        </div>
      </section>
    </main>
  );
}
