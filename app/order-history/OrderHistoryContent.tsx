"use client";

import { useEffect, useState } from "react";
import styles from "./order-history.module.css";

type OrderRow = {
  id: number;
  source: string;
  external_order_id: string | null;
  user_id: string;
  product: string;
  quantity: number;
  unit_price: number;
  tier: string;
  status: "waiting" | "opening" | "done" | "cancelled";
  cancel_reason: string | null;
  completed_at: string | null;
  youtube_nickname: string | null;
  created_at: string;
};

type HitCardRow = {
  id: number;
  user_id: string;
  card: string;
  youtube_nickname: string | null;
  created_at: string;
};

const formatPrice = (value: number) => value.toLocaleString("ko-KR") + "원";

function statusInfo(order: OrderRow): { label: string; className: string } {
  if (order.status === "cancelled") {
    return {
      label: order.cancel_reason === "refunded" ? "환불됨" : "취소됨",
      className: styles.statusCancelled,
    };
  }
  if (order.status === "opening") return { label: "오픈중", className: styles.statusOpening };
  if (order.status === "done") return { label: "완료", className: styles.statusDone };
  return { label: "대기중", className: styles.statusWaiting };
}

function formatDate(value: string) {
  // SQLite CURRENT_TIMESTAMP는 UTC 기준이라 'Z'를 붙여 브라우저 로컬시간으로 정확히 변환합니다.
  const date = new Date(`${value.replace(" ", "T")}Z`);
  return date.toLocaleString("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * 주문 이력 + 히트카드 등록 이력을 보여주는 재사용 가능한 컴포넌트.
 * /order-history 단독 페이지와, 관리자 화면의 팝업 양쪽에서 씁니다.
 */
export default function OrderHistoryContent() {
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [hitCards, setHitCards] = useState<HitCardRow[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    try {
      const res = await fetch("/api/order-history");
      const data = await res.json();
      setOrders(data.orders ?? []);
      setHitCards(data.hitCards ?? []);
    } finally {
      setLoading(false);
    }
  }

  async function resetAll() {
    if (!window.confirm("주문 이력과 히트카드 등록 이력을 전부 초기화하시겠습니까? 되돌릴 수 없습니다.")) {
      return;
    }
    await fetch("/api/order-history", { method: "DELETE" });
    await load();
  }

  useEffect(() => {
    load();
    const interval = setInterval(load, 10000); // 10초마다 자동 새로고침
    return () => clearInterval(interval);
  }, []);

  return (
    <>
      <div className={styles.headerRow}>
        <div>
          <h1>망고TCG 주문 이력</h1>
          <p className={styles.hint}>최근 30건까지만 보관됩니다. (10초마다 자동 새로고침)</p>
        </div>
        <div className={styles.headerButtons}>
          <button className={styles.refreshButton} onClick={load}>
            새로고침
          </button>
          <button className={styles.resetButton} onClick={resetAll}>
            전체 초기화
          </button>
        </div>
      </div>

      <h2 className={styles.sectionTitle}>주문 이력 ({orders.length})</h2>
      <div className={styles.tableWrap}>
        {loading ? (
          <div className={styles.empty}>불러오는 중...</div>
        ) : orders.length === 0 ? (
          <div className={styles.empty}>주문 이력이 없습니다.</div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>주문일시</th>
                <th>구매자</th>
                <th>유튜브 닉네임</th>
                <th>상품명</th>
                <th>수량</th>
                <th>금액</th>
                <th>상태</th>
                <th>완료일시</th>
                <th>출처</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => {
                const { label, className } = statusInfo(order);
                return (
                  <tr key={order.id}>
                    <td>{formatDate(order.created_at)}</td>
                    <td>{order.user_id}</td>
                    <td>{order.youtube_nickname ?? "-"}</td>
                    <td className={styles.product}>{order.product}</td>
                    <td>{order.quantity}</td>
                    <td>{formatPrice(order.unit_price * order.quantity)}</td>
                    <td>
                      <span className={`${styles.statusBadge} ${className}`}>{label}</span>
                    </td>
                    <td>{order.completed_at ? formatDate(order.completed_at) : "-"}</td>
                    <td className={styles.sourceTag}>
                      {order.source === "cafe24" ? "카페24" : "수동"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <h2 className={styles.sectionTitle}>히트카드 등록 이력 ({hitCards.length})</h2>
      <div className={styles.tableWrap}>
        {loading ? (
          <div className={styles.empty}>불러오는 중...</div>
        ) : hitCards.length === 0 ? (
          <div className={styles.empty}>등록된 히트카드가 없습니다.</div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>등록일시</th>
                <th>구매자</th>
                <th>유튜브 닉네임</th>
                <th>카드명</th>
              </tr>
            </thead>
            <tbody>
              {hitCards.map((hit) => (
                <tr key={hit.id}>
                  <td>{formatDate(hit.created_at)}</td>
                  <td>{hit.user_id}</td>
                  <td>{hit.youtube_nickname ?? "-"}</td>
                  <td className={styles.product}>{hit.card}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
