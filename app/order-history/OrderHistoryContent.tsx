"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import GlobalLoadingOverlay from "@/app/GlobalLoadingOverlay";
import styles from "./order-history.module.css";

type OrderRow = {
  id: number;
  source: string;
  external_order_id: string | null;
  user_id: string;
  product: string;
  quantity: number;
  unit_price: number;
  actual_amount: number;
  points_spent_amount?: number | null;
  remote_only?: boolean;
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

type RewardStatus = "pending" | "succeeded" | "failed";
type RewardSummary = {
  issue?: { amount: number; grade_id: string; status: RewardStatus };
  recover?: { amount: number; grade_id: string; status: RewardStatus };
};

type OrderHistoryResponse = {
  orders?: OrderRow[];
  rewardSummaries?: Record<string, RewardSummary>;
  availableYears?: number[];
  syncError?: boolean;
};

const ORDER_PAGE_SIZE = 10;
const HIT_CARD_PAGE_SIZE = 50;

function currentKstDate() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000);
}

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
  return method.split(",").map((part) => PAYMENT_METHOD_LABELS[part] ?? part).join(" + ");
}

function statusInfo(order: OrderRow): { label: string; className: string } {
  if (order.status === "cancelled") {
    return {
      label: "취소",
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
 * 주문 이력과 히트카드 이력에서 재사용하는 페이지네이션 버튼 UI입니다.
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
 * 주문 이력 전체 페이지입니다.
 */
export default function OrderHistoryContent({ onBack }: { onBack?: () => void }) {
  const router = useRouter();
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [rewardSummaries, setRewardSummaries] = useState<Record<string, RewardSummary>>({});
  const [availableYears, setAvailableYears] = useState<number[]>([]);
  const [syncError, setSyncError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [deletingOrderId, setDeletingOrderId] = useState<number | null>(null);
  const [orderPage, setOrderPage] = useState(1);
  const [selectedYear, setSelectedYear] = useState(() => currentKstDate().getUTCFullYear());
  const [selectedMonth, setSelectedMonth] = useState(() => currentKstDate().getUTCMonth() + 1);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const currentKst = currentKstDate();
  const currentYear = currentKst.getUTCFullYear();
  const currentMonth = currentKst.getUTCMonth() + 1;
  const selectableYears = useMemo(() => Array.from(new Set([currentYear, ...availableYears]))
    .filter((year) => year <= currentYear)
    .sort((a, b) => b - a), [availableYears, currentYear]);
  const selectableMonths = useMemo(() => Array.from(
    { length: selectedYear === currentYear ? currentMonth : 12 },
    (_, index) => index + 1
  ), [currentMonth, currentYear, selectedYear]);
  async function logout() {
    await fetch("/api/admin/logout", { method: "POST" });
    router.replace("/admin/login");
  }

  const load = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true);
    try {
      const params = new URLSearchParams({
        year: String(selectedYear),
        month: String(selectedMonth),
      });
      const res = await fetch(`/api/order-history?${params.toString()}`, { cache: "no-store" });
      const data = await res.json() as OrderHistoryResponse;
      setOrders(data.orders ?? []);
      setRewardSummaries(data.rewardSummaries ?? {});
      setAvailableYears(data.availableYears ?? []);
      setSyncError(Boolean(data.syncError));
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [selectedMonth, selectedYear]);

  async function deleteOrderRow(order: OrderRow) {
    if (!window.confirm("이 주문 이력을 목록에서 삭제하시겠습니까? 카페24 주문과 적립금 지급 내역은 변경되지 않습니다.")) return;
    setDeletingOrderId(order.id);
    try {
      const response = await fetch(`/api/orders/${order.id}`, {
        method: "DELETE",
        headers: order.external_order_id ? { "Content-Type": "application/json" } : undefined,
        body: order.external_order_id ? JSON.stringify({ externalOrderId: order.external_order_id }) : undefined,
      });
      if (!response.ok) throw new Error("delete failed");
      setOrders((current) => current.filter((currentOrder) => currentOrder.id !== order.id));
    } catch {
      window.alert("주문 이력 삭제에 실패했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setDeletingOrderId(null);
    }
  }

  useEffect(() => {
    void load(true);
    const interval = setInterval(() => void load(), 10000); // 10초마다 자동 새로고침
    return () => clearInterval(interval);
  }, [load]);

  // 연도 변경이나 자정 경과로 미래 월이 선택된 상태가 되지 않도록 최신 유효 월로 맞춥니다.
  useEffect(() => {
    if (!selectableYears.includes(selectedYear)) {
      setSelectedYear(currentYear);
      setSelectedMonth(currentMonth);
      return;
    }
    if (!selectableMonths.includes(selectedMonth)) setSelectedMonth(currentMonth);
  }, [currentMonth, currentYear, selectableMonths, selectableYears, selectedMonth, selectedYear]);

  // 새로고침 등으로 목록 길이가 줄어들어 현재 페이지가 범위를 벗어나면 마지막 페이지로 보정합니다.
  const orderTotalPages = Math.max(1, Math.ceil(orders.length / ORDER_PAGE_SIZE));
  useEffect(() => {
    if (orderPage > orderTotalPages) setOrderPage(orderTotalPages);
  }, [orderTotalPages, orderPage]);

  const pagedOrders = orders.slice(
    (orderPage - 1) * ORDER_PAGE_SIZE,
    orderPage * ORDER_PAGE_SIZE
  );

  return (
    <>
      {loading && <GlobalLoadingOverlay />}
      <div className={styles.headerRow}>
        <div className={styles.titleWithTooltip}>
          {onBack
            ? <button className={styles.backButton} onClick={onBack} aria-label="뒤로가기" title="뒤로가기">←</button>
            : <a className={styles.backButton} href="/admin" aria-label="뒤로가기" title="뒤로가기">←</a>}
          <h1>주문이력</h1>
          <span
            className={styles.infoTooltip}
            tabIndex={0}
            role="img"
            aria-label="주문 이력 안내"
            title="카페24가 제공하는 조회 범위까지 주문 이력을 누적 보관합니다. (10초마다 자동 새로고침)"
          >
            ⓘ
          </span>
        </div>
        <div className={styles.mobileMenuArea}>
          <button
            className={styles.mobileMenuButton}
            type="button"
            aria-label="관리자 메뉴"
            aria-expanded={mobileMenuOpen}
            onClick={() => setMobileMenuOpen((open) => !open)}
          >
            ☰
          </button>
          {mobileMenuOpen && <nav className={styles.mobileMenu} aria-label="관리자 메뉴">
            <a href="https://dhdudals5555.cafe24.com/disp/admin/shop1/main/dashboard" target="_blank" rel="noopener noreferrer">🏪 카페24 관리자</a>
            <a href="/admin">관리자 홈</a>
            <button type="button" onClick={logout}>로그아웃</button>
          </nav>}
        </div>
        <div className={styles.historyFilters} aria-label="주문 이력 기간 선택">
          <label>
            <span>연도</span>
            <select
              value={selectedYear}
              onChange={(event) => {
                const nextYear = Number(event.target.value);
                setSelectedYear(nextYear);
                // 당년으로 돌아오면 아직 도래하지 않은 월 대신 당월을 기본으로 표시합니다.
                if (nextYear === currentYear) setSelectedMonth(currentMonth);
                setOrderPage(1);
              }}
            >
              {selectableYears.map((year) => (
                <option key={year} value={year}>{year}년</option>
              ))}
            </select>
          </label>
          <label>
            <span>월</span>
            <select
              value={selectedMonth}
              onChange={(event) => {
                setSelectedMonth(Number(event.target.value));
                setOrderPage(1);
              }}
            >
              {selectableMonths.map((month) => (
                <option key={month} value={month}>{month}월</option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className={styles.sectionHeader}>
        <h2 className={styles.sectionTitle}>{selectedYear}년 {selectedMonth}월 주문 이력 ({orders.length})</h2>
      </div>
      {syncError && <p className={styles.syncWarning}>카페24 최신 주문 조회에 실패했습니다. 현재 저장된 주문 기준으로 표시합니다.</p>}
      <div className={styles.tableWrap}>
        {loading ? null : orders.length === 0 ? (
          <div className={styles.empty}>주문 이력이 없습니다.</div>
        ) : (
          <div className={styles.tableScroller}>
            <div className={styles.scrollArea}>
              <table className={styles.table}>
              <thead>
                <tr>
                  <th>주문일시</th>
                  <th>주문번호</th>
                  <th>상품명</th>
                  <th>실결제액</th>
                  <th>적립금 사용액</th>
                  <th>최종결제액</th>
                  <th>수량</th>
                  <th>유튜브 닉네임</th>
                  <th>구매자</th>
                  <th>회원등급</th>
                  <th>적립금 지급액</th>
                  <th>상태</th>
                  <th>관리</th>
                  <th>결제방식</th>
                  <th>완료일시</th>
                </tr>
              </thead>
              <tbody>
                {pagedOrders.map((order) => {
                  const { label, className } = statusInfo(order);
                  const reward = order.external_order_id ? rewardSummaries[order.external_order_id] : undefined;
                  return (
                    <tr key={order.id}>
                      <td data-label="주문일시">{formatDate(order.created_at)}</td>
                      <td data-label="주문번호" className={styles.orderNumber}>{order.external_order_id ?? "-"}</td>
                      <td data-label="상품명" className={styles.product}>{order.product}</td>
                      <td data-label="실결제액">{formatPrice(order.actual_amount)}</td>
                      <td data-label="적립금 사용액">{order.points_spent_amount == null ? "조회 불가" : formatPrice(order.points_spent_amount)}</td>
                      <td data-label="최종결제액">{order.points_spent_amount == null ? "조회 불가" : <span className={styles.rewardBadge}>{formatPrice(order.actual_amount - order.points_spent_amount)}</span>}</td>
                      <td data-label="수량">{order.quantity}</td>
                      <td data-label="유튜브 닉네임">{order.youtube_nickname ?? "-"}</td>
                      <td data-label="구매자">{order.user_id}</td>
                      <td data-label="회원등급">{order.tier || "-"}</td>
                      <td data-label="적립금 지급액" className={styles.rewardCell}>
                        {!reward?.issue && !reward?.recover ? (
                          <span className={styles.rewardNone}>-</span>
                        ) : reward.recover ? (
                          <span className={`${styles.rewardBadge} ${styles.rewardRecover}`}>
                            회수 {formatPrice(reward.recover.amount)}
                            {reward.issue && (
                              <small className={styles.rewardNetAmount}>
                                순지급 {formatPrice(Math.max(0, reward.issue.amount - reward.recover.amount))}
                              </small>
                            )}
                          </span>
                        ) : (
                          <span className={styles.rewardBadge}>
                            지급 {formatPrice(reward.issue!.amount)}
                          </span>
                        )}
                      </td>
                      <td data-label="상태"><span className={`${styles.statusBadge} ${className}`}>{label}</span></td>
                      <td data-label="관리">
                        <button
                          className={styles.rowDeleteButton}
                          onClick={() => deleteOrderRow(order)}
                          disabled={deletingOrderId === order.id}
                        >
                          {deletingOrderId === order.id ? "삭제 중" : "삭제"}
                        </button>
                      </td>
                      <td data-label="결제방식">{formatPaymentMethod(order.payment_method)}</td>
                      <td data-label="완료일시">{order.completed_at ? formatDate(order.completed_at) : "-"}</td>
                    </tr>
                  );
                })}
              </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
      <Pager page={orderPage} totalPages={orderTotalPages} onChange={setOrderPage} />
    </>
  );
}

/** 주문 이력 화면의 별도 모달에서 쓰는 히트카드 등록 이력입니다. */
export function HitCardHistoryContent() {
  const [hitCards, setHitCards] = useState<HitCardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  async function load() {
    try {
      const response = await fetch("/api/order-history");
      const data = await response.json() as { hitCards?: HitCardRow[] };
      setHitCards(data.hitCards ?? []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    const interval = window.setInterval(() => void load(), 10_000);
    return () => window.clearInterval(interval);
  }, []);

  const totalPages = Math.max(1, Math.ceil(hitCards.length / HIT_CARD_PAGE_SIZE));
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);
  const pagedHitCards = hitCards.slice(
    (page - 1) * HIT_CARD_PAGE_SIZE,
    page * HIT_CARD_PAGE_SIZE
  );

  return (
    <>
      {loading && <GlobalLoadingOverlay />}
      <h2 className={styles.sectionTitle}>히트카드 등록 이력 ({hitCards.length})</h2>
      <div className={styles.tableWrap}>
        {loading ? null : hitCards.length === 0 ? (
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
      <Pager page={page} totalPages={totalPages} onChange={setPage} />
    </>
  );
}
