import CardBreakFrame from "./CardBreakFrame";
import styles from "./page.module.css";

export default function OverlayCardBreak() {
  return (
    <main className={styles.overlayViewport}>
      <CardBreakFrame />
    </main>
  );
}
