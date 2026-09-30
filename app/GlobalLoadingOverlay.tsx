export default function GlobalLoadingOverlay() {
  return (
    <div className="globalLoadingOverlay" role="status" aria-live="polite">
      <i className="globalLoadingSpinner" aria-hidden="true" />
      <p>데이터를 불러오는 중입니다</p>
    </div>
  );
}
