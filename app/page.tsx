export default function Home() {
  return (
    <main className="home">
      <h1>망고TCG 카드브레이크</h1>
      <p>OBS용 오버레이 관리 페이지입니다.</p>
      <div style={{ display: "grid", gap: 12, maxWidth: 420 }}>
        <a href="/overlay-cardbreak">카드브레이크 OBS 오버레이</a>
        <a href="/preview-cardbreak">카드브레이크 미리보기</a>
        <a href="/admin">🎛️ 망고TCG 관리자 (실시간 주문/히트카드 조작)</a>
        <a href="/order-history">🗂️ 망고TCG 주문 이력 (최근 30건)</a>
      </div>
    </main>
  );
}
