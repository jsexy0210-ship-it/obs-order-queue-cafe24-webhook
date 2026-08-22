import styles from "./vertical.module.css";

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

export default function VerticalOverlay() {
  return (
    <main className={styles.stage}>
      <section className={styles.topOverlay}>
        <div className={styles.liveRow}>
          <div>
            <span className={styles.kicker}>NOW OPENING</span>
            <div className={styles.openingLine}>
              <strong>{openingOrder.nickname}</strong>
              <span>{openingOrder.product}</span>
              <b>× {openingOrder.quantity}</b>
            </div>
          </div>

          <div className={styles.liveBadge}>
            <span className={styles.liveDot} />
            LIVE
          </div>
        </div>
      </section>

      <section className={styles.videoWindow}>
        <div className={styles.videoSafeGuide}>
          <span>LIVE VIDEO AREA</span>
        </div>
      </section>

      <section className={styles.bottomOverlay}>
        <div className={styles.queueHeader}>
          <div>
            <span className={styles.kicker}>NEXT QUEUE</span>
            <strong>{waitingOrders.length} WAITING</strong>
          </div>
          <span className={styles.brand}>CARD BREAK LIVE</span>
        </div>

        <ol className={styles.queue}>
          {waitingOrders.map((order, index) => (
            <li key={order.id}>
              <span className={styles.number}>{String(index + 1).padStart(2, "0")}</span>
              <div className={styles.info}>
                <strong>{order.nickname}</strong>
                <span>{order.product}</span>
              </div>
              <b>× {order.quantity}</b>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
