import CardBreakFrame from "../overlay-cardbreak/CardBreakFrame";
import styles from "./preview.module.css";

export default function PreviewCardBreak() {
  return (
    <main className={styles.previewStage}>
      <div className={styles.overlayFrame}>
        <CardBreakFrame previewMode />
      </div>
    </main>
  );
}
