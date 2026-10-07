"use client";

import { type LiveOrder, useLiveCardBreak } from "@/app/useLiveCardBreak";
import styles from "./new-overlay.module.css";

type Props = {
  /** 관리자 화면에서는 9:16 비율로만 새 템플릿을 확인합니다. */
  preview?: boolean;
};

function nickname(value: string | null | undefined) {
  return (value ?? "-").replace(/\([^)]*\)/g, "").trim() || "-";
}

function orderLabel(order: Pick<LiveOrder, "youtube_nickname" | "user_id" | "product" | "quantity">) {
  return `${nickname(order.youtube_nickname) === "-" ? order.user_id : nickname(order.youtube_nickname)} · ${order.product} ×${order.quantity}`;
}

export default function NewOverlayFrame({ preview = false }: Props) {
  const { opening, waiting, hitCards } = useLiveCardBreak();
  const queue = [...(opening ? [opening] : []), ...waiting].slice(0, 4);
  const activeOrder = opening ?? waiting[0] ?? null;
  const flowOrders = queue.length > 0 ? queue : activeOrder ? [activeOrder] : [];

  return (
    <main className={`${styles.shell} ${preview ? styles.previewShell : styles.liveShell}`} aria-label="망고TCG 신규 라이브 오버레이">
      <div className={styles.sparkField} aria-hidden="true">
        {Array.from({ length: 12 }, (_, index) => <i key={index} />)}
      </div>

      <section className={`${styles.panel} ${styles.queuePanel}`}>
        <header className={styles.panelHeader}>
          <span className={styles.crown}>♛</span>
          <div><small>LIVE QUEUE</small><strong>오늘의 오픈 순서</strong></div>
          <b>{queue.length}건</b>
        </header>
        <ol className={styles.queueList}>
          {queue.map((order, index) => (
            <li key={order.id} className={index === 0 ? styles.queueLead : undefined}>
              <em>{index + 1}</em>
              <span>{nickname(order.youtube_nickname) === "-" ? order.user_id : nickname(order.youtube_nickname)}</span>
              <b>{order.product}</b>
            </li>
          ))}
          {queue.length === 0 && <li className={styles.emptyRow}>오픈 대기 주문 없음</li>}
        </ol>
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
      </section>

      <section className={styles.flowPanel} aria-label="대기 주문 흐름">
        <span className={styles.flowLabel}>NEXT</span>
        <div className={styles.flowViewport}>
          <div className={styles.flowTrack}>
            {[...flowOrders, ...flowOrders].map((order, index) => <b key={`${order.id}-${index}`}>{orderLabel(order)} <i>✦</i></b>)}
            {flowOrders.length === 0 && <b>새 주문을 기다리고 있습니다 <i>✦</i></b>}
          </div>
        </div>
      </section>
    </main>
  );
}
