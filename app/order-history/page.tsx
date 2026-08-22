import OrderHistoryContent from "./OrderHistoryContent";
import styles from "./order-history.module.css";

export default function OrderHistoryPage() {
  return (
    <main className={styles.page}>
      <OrderHistoryContent />
    </main>
  );
}
