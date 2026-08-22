import overlayStyles from "../overlay-vertical/vertical.module.css";
import styles from "./preview.module.css";

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

export default function PreviewVertical() {
  return (
    <main className={styles.previewStage}>
      <div className={styles.fakeVideo}>
        <div className={styles.tableGlow} />
        <div className={styles.cameraHud}>
          <span>● REC</span>
          <span>1080 × 1920</span>
        </div>
        <div className={styles.cardDeck}>
          <div className={styles.card}>POKÉMON<br/>CARD</div>
          <div className={styles.cardBack}>LIVE<br/>BREAK</div>
        </div>
        <div className={styles.handHint}>카드 촬영 영상 영역</div>
      </div>

      <section className={overlayStyles.topOverlay}>
        <div className={overlayStyles.liveRow}>
          <div>
            <span className={overlayStyles.kicker}>NOW OPENING</span>
            <div className={overlayStyles.openingLine}>
              <strong>{openingOrder.nickname}</strong>
              <span>{openingOrder.product}</span>
              <b>× {openingOrder.quantity}</b>
            </div>
          </div>
          <div className={overlayStyles.liveBadge}>
            <span className={overlayStyles.liveDot} />
            LIVE
          </div>
        </div>
      </section>

      <section className={overlayStyles.bottomOverlay}>
        <div className={overlayStyles.queueHeader}>
          <div>
            <span className={overlayStyles.kicker}>NEXT QUEUE</span>
            <strong>{waitingOrders.length} WAITING</strong>
          </div>
          <span className={overlayStyles.brand}>CARD BREAK LIVE</span>
        </div>

        <ol className={overlayStyles.queue}>
          {waitingOrders.map((order, index) => (
            <li key={order.id}>
              <span className={overlayStyles.number}>{String(index + 1).padStart(2, "0")}</span>
              <div className={overlayStyles.info}>
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
