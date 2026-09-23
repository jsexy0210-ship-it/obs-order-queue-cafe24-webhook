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
  payment_method: string | null;
  payment_gateway_name: string | null;
  easypay_name: string | null;
  paid_at: string | null;
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

const PAGE_SIZE = 10;

// 카페24 결제방식 원본 코드 -> 화면에 보여줄 한글 라벨.
// 목록에 없는 코드가 들어오면(카페24가 새 결제수단을 추가하는 등) 원본 코드를 그대로 보여줍니다.
const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: "무통장입금",
  card: "신용카드",
  escrow: "에스크로",
  escrow_cash: "에스크로(무통장)",
  vbank: "가상계좌",
  mobile: "휴대폰결제",
  cellphone: "휴대폰결제",
  point: "적립금",
  bank: "계좌이체",
  tcash: "계좌이체",
  icash: "가상계좌",
  cell: "휴대폰결제",
  prepaid: "선불금",
  credit: "예치금",
  pointfy: "통합포인트",
  cvs: "편의점결제",
  cod: "착불/후불",
  deferpay: "후불결제",
  coupon: "쿠폰",
  market_discount: "마켓할인",
  giftcard: "제휴상품권",
  pointcard: "제휴포인트",
  etc: "기타결제",
};

const formatPrice = (value: number) => value.toLocaleString("ko-KR") + "원";

function formatPaymentMethod(method: string | null) {
  if (!method) return "-";
  return PAYMENT_METHOD_LABELS[method] ?? method;
}

function formatPaymentProvider(order: OrderRow) {
  return [order.easypay_name, order.payment_gateway_name].filter(Boolean).join(" · ") || "-";
}

// 출처(거래방식): 카페24 웹훅으로 들어온 주문은 "사이트", 관리자가 직접 입력한 주문은 "직접등록"으로 표시합니다.
function formatSource(source: string) {
  return source === "cafe24" ? "사이트" : "직접등록";
}

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
 * 페이지네이션 버튼 UI. 목록 컴포넌트 하나로 주문 이력 / 히트카드 이력 양쪽에서 재사용합니다.
 */
function Pager({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
}) {
  if (totalPages <= 1) return null;
  return (
    <div className={styles.pager}>
      <button
        className={styles.pagerButton}
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
      >
        이전
      </button>
      <span className={styles.pagerInfo}>
        {page} / {totalPages}
      </span>
      <button
        className={styles.pagerButton}
        disabled={page >= totalPages}
        onClick={() => onChange(page + 1)}
      >
        다음
      </button>
    </div>
  );
}

/**
 * 주문 이력 + 히트카드 등록 이력을 보여주는 재사용 가능한 컴포넌트.
 * /order-history 단독 페이지와, 관리자 화면의 팝업 양쪽에서 씁니다.
 */
export default function OrderHistoryContent() {
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [hitCards, setHitCards] = useState<HitCardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [orderPage, setOrderPage] = useState(1);
  const [hitPage, setHitPage] = useState(1);

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

  async function deleteOrderRow(id: number) {
    if (!window.confirm("이 주문 이력을 삭제하시겠습니까? 되돌릴 수 없습니다.")) return;
    await fetch(`/api/orders/${id}`, { method: "DELETE" });
    await load();
  }

  useEffect(() => {
    load();
    const interval = setInterval(load, 10000); // 10초마다 자동 새로고침
    return () => clearInterval(interval);
  }, []);

  // 새로고침 등으로 목록 길이가 줄어들어 현재 페이지가 범위를 벗어나면 마지막 페이지로 보정합니다.
  const orderTotalPages = Math.max(1, Math.ceil(orders.length / PAGE_SIZE));
  useEffect(() => {
    if (orderPage > orderTotalPages) setOrderPage(orderTotalPages);
  }, [orderTotalPages, orderPage]);

  const hitTotalPages = Math.max(1, Math.ceil(hitCards.length / PAGE_SIZE));
  useEffect(() => {
    if (hitPage > hitTotalPages) setHitPage(hitTotalPages);
  }, [hitTotalPages, hitPage]);

  const pagedOrders = orders.slice((orderPage - 1) * PAGE_SIZE, orderPage * PAGE_SIZE);
  const pagedHitCards = hitCards.slice((hitPage - 1) * PAGE_SIZE, hitPage * PAGE_SIZE);

  return (
    <>
      <div className={styles.headerRow}>
        <div>
          <h1>망고TCG 주문 이력</h1>
          <p className={styles.hint}>최근 3개월 주문 이력을 보관합니다. (10초마다 자동 새로고침)</p>
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
          <div className={styles.scrollArea}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>주문일시</th>
                  <th>구매자</th>
                  <th>유튜브 닉네임</th>
                  <th>상품명</th>
                  <th>수량</th>
                  <th>금액</th>
                  <th>결제방식</th>
                  <th>PG·간편결제</th>
                  <th>입금여부</th>
                  <th>상태</th>
                  <th>완료일시</th>
                  <th>거래방식</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {pagedOrders.map((order) => {
                  const { label, className } = statusInfo(order);
                  return (
                    <tr key={order.id}>
                      <td data-label="주문일시">{formatDate(order.created_at)}</td>
                      <td data-label="구매자">{order.user_id}</td>
                      <td data-label="유튜브 닉네임">{order.youtube_nickname ?? "-"}</td>
                      <td data-label="상품명" className={styles.product}>{order.product}</td>
                      <td data-label="수량">{order.quantity}</td>
                      <td data-label="금액">{formatPrice(order.unit_price * order.quantity)}</td>
                      <td data-label="결제방식">{formatPaymentMethod(order.payment_method)}</td>
                      <td data-label="PG·간편결제">{formatPaymentProvider(order)}</td>
                      <td data-label="입금여부">
                        {order.paid_at ? (
                          <span className={styles.paidBadge}>입금완료</span>
                        ) : (
                          <span className={styles.notPaid}>-</span>
                        )}
                      </td>
                      <td data-label="상태">
                        <span className={`${styles.statusBadge} ${className}`}>{label}</span>
                      </td>
                      <td data-label="완료일시">{order.completed_at ? formatDate(order.completed_at) : "-"}</td>
                      <td data-label="거래방식" className={styles.sourceTag}>{formatSource(order.source)}</td>
                      <td data-label="관리">
                        <button
                          className={styles.rowDeleteButton}
                          onClick={() => deleteOrderRow(order.id)}
                        >
                          삭제
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <Pager page={orderPage} totalPages={orderTotalPages} onChange={setOrderPage} />

      <h2 className={styles.sectionTitle}>히트카드 등록 이력 ({hitCards.length})</h2>
      <div className={styles.tableWrap}>
        {loading ? (
          <div className={styles.empty}>불러오는 중...</div>
        ) : hitCards.length === 0 ? (
          <div className={styles.empty}>등록된 히트카드가 없습니다.</div>
        ) : (
          <div className={styles.scrollArea}>
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
                {pagedHitCards.map((hit) => (
                  <tr key={hit.id}>
                    <td data-label="등록일시">{formatDate(hit.created_at)}</td>
                    <td data-label="구매자">{hit.user_id}</td>
                    <td data-label="유튜브 닉네임">{hit.youtube_nickname ?? "-"}</td>
                    <td data-label="카드명" className={styles.product}>{hit.card}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <Pager page={hitPage} totalPages={hitTotalPages} onChange={setHitPage} />
    </>
  );
}
