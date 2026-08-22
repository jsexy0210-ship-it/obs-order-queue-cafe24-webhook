import styles from "./overlay.module.css";

type Order = {
  id: number;
  nickname: string;
  product: string;
  quantity: number;
};

const openingOrder: Order = {
  id: 1,
  nickname: "jae***",
  product: "포켓몬 151 BOX",
  quantity: 1,
};

const waitingOrders: Order[] = [
  { id: 2, nickname: "kim***", product: "로켓단 BOX", quantity: 1 },
  { id: 3, nickname: "park***", product: "랜덤팩", quantity: 5 },
  { id: 4, nickname: "pik***", product: "테라스탈 페스 ex BOX", quantity: 1 },
];

export default function OverlayPage() {
  return (
    <main className={styles.overlay}>
      <section className={styles.panel}>
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>LIVE CARD BREAK</p>
            <h1>OPEN QUEUE</h1>
          </div>
          <span className={styles.liveBadge}>
            <span className={styles.liveDot} />
            LIVE
          </span>
        </header>

        <section className={styles.nowSection}>
          <p className={styles.sectionLabel}>NOW OPENING</p>
          <div className={styles.nowCard}>
            <div className={styles.avatar}>{openingOrder.nickname[0].toUpperCase()}</div>
            <div className={styles.orderText}>
              <strong>{openingOrder.nickname}</strong>
              <span>{openingOrder.product}</span>
            </div>
            <span className={styles.quantity}>× {openingOrder.quantity}</span>
          </div>
        </section>

        <section className={styles.queueSection}>
          <div className={styles.queueHeading}>
            <p className={styles.sectionLabel}>NEXT QUEUE</p>
            <span>{waitingOrders.length} waiting</span>
          </div>

          <ol className={styles.queueList}>
            {waitingOrders.map((order, index) => (
              <li key={order.id} className={styles.queueItem}>
                <span className={styles.rank}>{String(index + 1).padStart(2, "0")}</span>
                <div className={styles.orderText}>
                  <strong>{order.nickname}</strong>
                  <span>{order.product}</span>
                </div>
                <span className={styles.quantity}>× {order.quantity}</span>
              </li>
            ))}
          </ol>
        </section>

        <footer className={styles.footer}>
          <span>대기 {waitingOrders.length}명</span>
          <span className={styles.divider}>•</span>
          <span>OBS Overlay v1</span>
        </footer>
      </section>
    </main>
  );
}
