"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useLiveCardBreak, type LiveOrder } from "@/app/useLiveCardBreak";
import OrderHistoryContent from "@/app/order-history/OrderHistoryContent";
import styles from "./admin.module.css";

const DEFAULT_TIMER_SECONDS = 60;
const WAITING_PREVIEW_COUNT = 5;
const TOAST_DISPLAY_MS = 5000;

type Toast = { id: number; userId: string; product: string };

export default function AdminPage() {
  const { opening, waiting, hitCards } = useLiveCardBreak();

  const [form, setForm] = useState({
    userId: "",
    product: "",
    quantity: 1,
    unitPrice: 15000,
    tier: "",
    youtubeNickname: "",
  });
  const [hitForm, setHitForm] = useState({ userId: "", card: "", youtubeNickname: "" });
  const [showHistory, setShowHistory] = useState(false);
  const [showAllWaiting, setShowAllWaiting] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const seenOrderIds = useRef<Set<number> | null>(null);

  // 신규 주문 토스트 알림: 처음 로드될 때 있던 주문은 알리지 않고,
  // 그 이후 새로 들어온 주문(대기열에 새 id)만 감지해서 알려줍니다.
  useEffect(() => {
    const currentIds = new Set(waiting.map((o) => o.id));

    if (seenOrderIds.current === null) {
      seenOrderIds.current = currentIds;
      return;
    }

    const newOrders = waiting.filter((o) => !seenOrderIds.current!.has(o.id));
    seenOrderIds.current = currentIds;

    if (newOrders.length === 0) return;

    setToasts((prev) => [
      ...prev,
      ...newOrders.map((o) => ({ id: o.id, userId: o.user_id, product: o.product })),
    ]);

    newOrders.forEach((o) => {
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== o.id));
      }, TOAST_DISPLAY_MS);
    });
  }, [waiting]);

  // 주문 이력/대기 주문 팝업이 열려 있는 동안에는 뒤쪽 관리자 화면이 같이 스크롤되지 않도록 막습니다.
  useEffect(() => {
    const locked = showHistory || showAllWaiting;
    document.body.style.overflow = locked ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [showHistory, showAllWaiting]);

  async function startOpening(id: number) {
    if (!window.confirm("지금 카드를 오픈하시겠습니까?")) return;

    await fetch(`/api/orders/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "opening", timerSeconds: DEFAULT_TIMER_SECONDS }),
    });
  }

  async function completeOrder(id: number) {
    if (!window.confirm("오픈 완료 처리하시겠습니까?")) return;

    await fetch(`/api/orders/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "done" }),
    });
  }

  async function removeOrder(id: number) {
    if (!window.confirm("대기 중인 주문을 삭제하시겠습니까?")) return;
    await fetch(`/api/orders/${id}`, { method: "DELETE" });
  }

  async function addManualOrder(e: FormEvent) {
    e.preventDefault();
    if (!form.userId) {
      window.alert("구매자를 입력하세요.");
      return;
    }
    if (!form.product) {
      window.alert("상품명을 입력하세요.");
      return;
    }
    if (!window.confirm("상품을 추가하시겠습니까?")) return;

    await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });

    setForm({ userId: "", product: "", quantity: 1, unitPrice: 15000, tier: "", youtubeNickname: "" });
  }

  async function addHit(e: FormEvent) {
    e.preventDefault();
    if (!hitForm.userId) {
      window.alert("구매자를 입력하세요.");
      return;
    }
    if (!hitForm.card) {
      window.alert("카드명을 입력하세요.");
      return;
    }

    await fetch("/api/hit-cards", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(hitForm),
    });

    setHitForm({ userId: "", card: "", youtubeNickname: "" });
  }

  async function removeHit(id: number) {
    if (!window.confirm("카드 목록을 삭제하시겠습니까?")) return;
    await fetch(`/api/hit-cards/${id}`, { method: "DELETE" });
  }

  function renderWaitingRow(order: LiveOrder) {
    const cancelled = order.status === "cancelled";
    return (
      <div className={styles.row} key={order.id} style={cancelled ? { opacity: 0.5 } : undefined}>
        <span>{order.user_id}</span>
        {order.youtube_nickname && (
          <span className={styles.ytBadge}>YT: {order.youtube_nickname}</span>
        )}
        <span>
          {order.product} × {order.quantity}
        </span>
        <span className={styles.badge}>
          {cancelled
            ? order.cancel_reason === "refunded"
              ? "환불됨"
              : "취소됨"
            : order.source === "cafe24"
              ? "카페24"
              : "수동"}
        </span>
        {!cancelled && <button onClick={() => startOpening(order.id)}>오픈 시작</button>}
        <button className={styles.danger} onClick={() => removeOrder(order.id)}>
          삭제
        </button>
      </div>
    );
  }

  return (
    <main className={styles.page}>
      <div className={styles.headerRow}>
        <h1>망고TCG 관리자</h1>
        <button className={styles.historyButton} onClick={() => setShowHistory(true)}>
          🗂️ 주문 이력 보기
        </button>
      </div>
      <p className={styles.hint}>
        카페24 웹훅은 &quot;주문 접수&quot;까지만 알려줍니다. 지금 오픈 중인 주문 지정과
        히트카드 등록은 여기서 직접 조작하세요.
      </p>

      <section className={styles.block}>
        <h2>지금 오픈 중</h2>
        {opening ? (
          <div className={styles.row}>
            <span>{opening.user_id}</span>
            {opening.youtube_nickname && (
              <span className={styles.ytBadge}>YT: {opening.youtube_nickname}</span>
            )}
            <span>
              {opening.product} × {opening.quantity}
            </span>
            <button className={styles.completeButton} onClick={() => completeOrder(opening.id)}>
              오픈 완료
            </button>
          </div>
        ) : (
          <p className={styles.empty}>없음</p>
        )}
      </section>

      <section className={styles.block}>
        <h2>히트 카드 등록</h2>
        <form className={styles.form} onSubmit={addHit}>
          <div className={styles.field}>
            <label className={styles.fieldLabel}>구매자</label>
            <input
              placeholder="구매자명 입력"
              value={hitForm.userId}
              onChange={(e) => setHitForm({ ...hitForm, userId: e.target.value })}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.fieldLabel}>유튜브 닉네임</label>
            <input
              placeholder="유튜브 닉네임 입력(선택)"
              value={hitForm.youtubeNickname}
              onChange={(e) => setHitForm({ ...hitForm, youtubeNickname: e.target.value })}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.fieldLabel}>카드명</label>
            <input
              placeholder="카드명 입력"
              value={hitForm.card}
              onChange={(e) => setHitForm({ ...hitForm, card: e.target.value })}
            />
          </div>
          <button type="submit">등록</button>
        </form>
        <ul className={styles.hitList}>
          {hitCards.map((h) => (
            <li key={h.id} className={styles.hitItem}>
              <span>
                {h.user_id}
                {h.youtube_nickname ? ` (YT: ${h.youtube_nickname})` : ""} — {h.card}
              </span>
              <button className={styles.hitDelete} onClick={() => removeHit(h.id)}>
                삭제
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className={styles.block}>
        <h2>대기 주문 ({waiting.length})</h2>
        {waiting.length === 0 && <p className={styles.empty}>대기 중인 주문 없음</p>}
        {waiting.slice(0, WAITING_PREVIEW_COUNT).map(renderWaitingRow)}
        {waiting.length > WAITING_PREVIEW_COUNT && (
          <button className={styles.moreButton} onClick={() => setShowAllWaiting(true)}>
            더보기 ({waiting.length - WAITING_PREVIEW_COUNT}건 더)
          </button>
        )}
      </section>

      <section className={styles.block}>
        <h2>주문 수동 추가</h2>
        <form className={styles.form} onSubmit={addManualOrder}>
          <div className={styles.field}>
            <label className={styles.fieldLabel}>구매자</label>
            <input
              placeholder="구매자명 입력"
              value={form.userId}
              onChange={(e) => setForm({ ...form, userId: e.target.value })}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.fieldLabel}>유튜브 닉네임</label>
            <input
              placeholder="유튜브 닉네임 입력(선택)"
              value={form.youtubeNickname}
              onChange={(e) => setForm({ ...form, youtubeNickname: e.target.value })}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.fieldLabel}>상품명</label>
            <input
              placeholder="상품명 입력"
              value={form.product}
              onChange={(e) => setForm({ ...form, product: e.target.value })}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.fieldLabel}>구매수량</label>
            <input
              type="number"
              min={1}
              placeholder="수량 입력"
              value={form.quantity}
              onChange={(e) => setForm({ ...form, quantity: Number(e.target.value) })}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.fieldLabel}>금액</label>
            <input
              type="number"
              min={0}
              placeholder="금액 입력"
              value={form.unitPrice}
              onChange={(e) => setForm({ ...form, unitPrice: Number(e.target.value) })}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.fieldLabel}>등급</label>
            <input
              placeholder="등급 입력(선택)"
              value={form.tier}
              onChange={(e) => setForm({ ...form, tier: e.target.value })}
            />
          </div>
          <button type="submit">추가</button>
        </form>
      </section>

      {toasts.length > 0 && (
        <div className={styles.toastStack}>
          {toasts.map((t) => (
            <div key={t.id} className={styles.toast}>
              <strong>🔔 새 주문 접수</strong>
              <span>
                {t.userId} · {t.product}
              </span>
            </div>
          ))}
        </div>
      )}

      {showAllWaiting && (
        <div className={styles.modalOverlay} onClick={() => setShowAllWaiting(false)}>
          <div className={styles.modalCard} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalTopBarWithTitle}>
              <h2 className={styles.modalTitle}>대기 주문 전체 ({waiting.length})</h2>
              <button className={styles.modalCloseBtn} onClick={() => setShowAllWaiting(false)}>
                닫기 ✕
              </button>
            </div>
            {waiting.map(renderWaitingRow)}
          </div>
        </div>
      )}

      {showHistory && (
        <div className={styles.modalOverlay} onClick={() => setShowHistory(false)}>
          <div className={styles.modalCard} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalTopBar}>
              <button className={styles.modalCloseBtn} onClick={() => setShowHistory(false)}>
                닫기 ✕
              </button>
            </div>
            <OrderHistoryContent />
          </div>
        </div>
      )}
    </main>
  );
}
