"use client";

import { useEffect, useState } from "react";
import styles from "./admin.module.css";

type Order = {
  created_at: string;
  actual_amount: number;
  payment_method: string | null;
  paid_at: string | null;
  status: string;
};

type RewardEntry = { amount: number; grade_id: string; payment_kind: "card" | "bank" | "unknown"; processed_at: string };
type Grade = { id: string; name: string };
type DashboardRange = "day" | "week" | "month" | "year";

const BANK_DEPOSIT_METHODS = new Set(["cash", "deposit", "escrow_cash"]);
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const KST_OFFSET_MS = 9 * HOUR_MS;
const RANGE_OPTIONS: Array<{ value: DashboardRange; label: string; description: string }> = [
  { value: "day", label: "일", description: "오늘" },
  { value: "week", label: "주", description: "이번 주" },
  { value: "month", label: "월", description: "이번 달" },
  { value: "year", label: "년", description: "올해" },
];

type SeriesPoint = { label: string; amount: number; cardCount: number; bankCount: number };

function parseUtc(value: string) {
  const iso = value.replace(" ", "T");
  return new Date(/[zZ]|[+-]\d{2}:\d{2}$/.test(iso) ? iso : `${iso}Z`).getTime();
}

function rangeStart(range: DashboardRange, now: number) {
  const kst = new Date(now + KST_OFFSET_MS);
  const year = kst.getUTCFullYear();
  const month = kst.getUTCMonth();
  const day = kst.getUTCDate();
  if (range === "year") return Date.UTC(year, 0, 1) - KST_OFFSET_MS;
  if (range === "month") return Date.UTC(year, month, 1) - KST_OFFSET_MS;
  if (range === "week") {
    const daysSinceMonday = (kst.getUTCDay() + 6) % 7;
    return Date.UTC(year, month, day - daysSinceMonday) - KST_OFFSET_MS;
  }
  return Date.UTC(year, month, day) - KST_OFFSET_MS;
}

function makeSeries(orders: Order[], range: DashboardRange, now: number): SeriesPoint[] {
  const start = rangeStart(range, now);
  const kst = new Date(now + KST_OFFSET_MS);
  const length = range === "day" ? 24 : range === "week" ? 7
    : range === "month" ? new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth() + 1, 0)).getUTCDate()
      : 12;
  const series = Array.from({ length }, (_, index) => {
    const date = new Date(start + KST_OFFSET_MS + index * DAY_MS);
    const label = range === "day" ? `${index}시` : range === "year" ? `${index + 1}월`
      : range === "month" ? `${index + 1}일` : `${date.getUTCMonth() + 1}/${date.getUTCDate()}`;
    return { label, amount: 0, cardCount: 0, bankCount: 0 };
  });
  orders.forEach((order) => {
    const time = parseUtc(order.created_at);
    if (!Number.isFinite(time) || time < start || time > now) return;
    const kstOrder = new Date(time + KST_OFFSET_MS);
    const index = range === "day" ? Math.floor((time - start) / HOUR_MS)
      : range === "year" ? kstOrder.getUTCMonth()
        : Math.floor((time - start) / DAY_MS);
    if (index < 0 || index >= length) return;
    series[index].amount += order.actual_amount;
    if (!order.paid_at) return;
    const methods = (order.payment_method ?? "").toLowerCase().split(",");
    if (methods.includes("card")) series[index].cardCount += 1;
    else if (methods.some((method) => BANK_DEPOSIT_METHODS.has(method))) series[index].bankCount += 1;
  });
  return series;
}

function RangePicker({ value, onChange, title }: {
  value: DashboardRange;
  onChange: (value: DashboardRange) => void;
  title: string;
}) {
  return <div className={styles.dashboardRangePicker} role="group" aria-label={`${title} 기간`}>
    {RANGE_OPTIONS.map((option) => <button
      key={option.value}
      type="button"
      className={value === option.value ? styles.dashboardRangeActive : ""}
      aria-pressed={value === option.value}
      title={option.description}
      onClick={() => onChange(option.value)}
    >{option.label}</button>)}
  </div>;
}

export default function OrderDashboard() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [rewardEntries, setRewardEntries] = useState<RewardEntry[]>([]);
  const [cumulativeRewardBalance, setCumulativeRewardBalance] = useState(0);
  const [cumulativeRewardSource, setCumulativeRewardSource] = useState<"cafe24" | "ledger">("ledger");
  const [legacyRewardBalanceByGrade, setLegacyRewardBalanceByGrade] = useState<Record<string, number>>({});
  const [legacyRewardBalanceUnassignedMemberCount, setLegacyRewardBalanceUnassignedMemberCount] = useState(0);
  const [grades, setGrades] = useState<Grade[]>([]);
  const [amountRange, setAmountRange] = useState<DashboardRange>("month");
  const [paymentRange, setPaymentRange] = useState<DashboardRange>("month");
  const [rewardRange, setRewardRange] = useState<DashboardRange>("month");
  const [now, setNow] = useState(0);
  const [syncError, setSyncError] = useState(false);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const [historyResponse, settingsResponse] = await Promise.all([
          fetch("/api/order-history?range=dashboard", { cache: "no-store" }),
          fetch("/api/reward-settings", { cache: "no-store" }),
        ]);
        const history = await historyResponse.json() as {
          orders?: Order[];
          rewardEntries?: RewardEntry[];
          cumulativeRewardBalance?: number;
          cumulativeRewardSource?: "cafe24" | "ledger";
          legacyRewardBalanceByGrade?: Record<string, number>;
          legacyRewardBalanceUnassignedMemberCount?: number;
          syncError?: boolean;
        };
        const settings = await settingsResponse.json() as { settings?: { grades?: Grade[] } };
        if (!active || !historyResponse.ok || !settingsResponse.ok) return;
        setOrders(history.orders ?? []);
        setRewardEntries(history.rewardEntries ?? []);
        setCumulativeRewardBalance(Number(history.cumulativeRewardBalance ?? 0));
        setCumulativeRewardSource(history.cumulativeRewardSource === "cafe24" ? "cafe24" : "ledger");
        setLegacyRewardBalanceByGrade(history.legacyRewardBalanceByGrade ?? {});
        setLegacyRewardBalanceUnassignedMemberCount(Number(history.legacyRewardBalanceUnassignedMemberCount ?? 0));
        setGrades(settings.settings?.grades ?? []);
        setSyncError(Boolean(history.syncError));
        setNow(Date.now());
      } catch {
        // 다음 갱신 때 재시도합니다.
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 10_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  const amountOrders = orders.filter((order) => {
    const time = parseUtc(order.created_at);
    return order.status !== "cancelled" && Boolean(order.paid_at)
      && time >= rangeStart(amountRange, now) && time <= now;
  });
  const paymentOrders = orders.filter((order) => {
    const time = parseUtc(order.created_at);
    return order.status !== "cancelled" && Boolean(order.paid_at)
      && time >= rangeStart(paymentRange, now) && time <= now;
  });
  const currentRewards = rewardEntries.filter((entry) => {
    const time = parseUtc(entry.processed_at);
    return time >= rangeStart(rewardRange, now) && time <= now;
  });
  const totalAmount = amountOrders.reduce((total, order) => total + order.actual_amount, 0);
  const cardCount = paymentOrders.filter(
      (order) => (order.payment_method ?? "").toLowerCase().split(",").includes("card")
    ).length;
  const bankCount = paymentOrders.filter((order) =>
      !(order.payment_method ?? "").toLowerCase().split(",").includes("card")
      && (order.payment_method ?? "").toLowerCase().split(",").some((method) => BANK_DEPOSIT_METHODS.has(method))
    ).length;
  const paymentCount = cardCount + bankCount;
  const rewardTotal = currentRewards.reduce((total, entry) => total + entry.amount, 0);
  const rewardByGrade = grades.map((grade) => {
    const entries = currentRewards.filter((entry) => entry.grade_id === grade.id);
    return {
      ...grade,
      cardAmount: entries
        .filter((entry) => entry.payment_kind === "card")
        .reduce((total, entry) => total + entry.amount, 0),
      bankAmount: entries
        .filter((entry) => entry.payment_kind === "bank")
        .reduce((total, entry) => total + entry.amount, 0) + Number(legacyRewardBalanceByGrade[grade.id] ?? 0),
    };
  });
  const amountSeries = makeSeries(amountOrders, amountRange, now);
  const paymentSeries = makeSeries(paymentOrders, paymentRange, now);
  const amountPeak = Math.max(1, ...amountSeries.map((point) => point.amount));
  const amountLinePoints = amountSeries
    .map((point, index) => {
      const x = (index / (amountSeries.length - 1)) * 100;
      const y = 91 - (point.amount / amountPeak) * 78;
      return `${x},${y}`;
    })
    .join(" ");
  const paymentPeak = Math.max(
    1,
    ...paymentSeries.flatMap((point) => [point.cardCount, point.bankCount])
  );

  return (
    <section className={styles.orderDashboard} aria-label="주문 요약 대시보드">
      {syncError && <p className={styles.syncWarning}>카페24 최신 주문 조회에 실패했습니다. 현재 저장된 주문 기준으로 표시합니다.</p>}
      <div className={`${styles.dashboardCard} ${styles.chartDashboardCard}`}>
        <div className={styles.dashboardCardHeader}>
          <span>총 주문금액</span>
          <RangePicker title="총 주문금액" value={amountRange} onChange={setAmountRange} />
        </div>
        <strong>{totalAmount.toLocaleString("ko-KR")}원</strong>
        <small>{RANGE_OPTIONS.find((option) => option.value === amountRange)?.description} · 주문금액 추이</small>
        <div className={styles.lineChart} role="img" aria-label={`${amountRange} 기간별 총 주문금액 선 그래프`}>
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <line x1="0" y1="26" x2="100" y2="26" />
            <line x1="0" y1="58" x2="100" y2="58" />
            <line x1="0" y1="91" x2="100" y2="91" />
            <polyline points={amountLinePoints} />
          </svg>
          <div className={styles.chartAxis}>
            <span>{amountSeries[0]?.label}</span>
            <span>{amountSeries.at(-1)?.label}</span>
          </div>
        </div>
      </div>
      <div className={`${styles.dashboardCard} ${styles.chartDashboardCard}`}>
        <div className={styles.dashboardCardHeader}>
          <span>카드결제 + 무통장 총계</span>
          <RangePicker title="결제 건수" value={paymentRange} onChange={setPaymentRange} />
        </div>
        <strong>{paymentCount}건</strong>
        <small>카드결제 {cardCount}건 · 무통장 {bankCount}건</small>
        <div className={styles.barChart} role="img" aria-label={`${paymentRange} 기간별 카드결제와 무통장 주문 건수 막대 그래프`}>
          {paymentSeries.map((point) => (
            <div
              className={styles.barColumn}
              key={point.label}
              title={`${point.label} · 카드 ${point.cardCount}건 · 무통장 ${point.bankCount}건`}
            >
              <i
                className={styles.cardPaymentBar}
                style={{ height: `${point.cardCount === 0 ? 3 : (point.cardCount / paymentPeak) * 100}%` }}
              />
              <i
                className={styles.bankPaymentBar}
                style={{ height: `${point.bankCount === 0 ? 3 : (point.bankCount / paymentPeak) * 100}%` }}
              />
            </div>
          ))}
        </div>
        <div className={styles.barLegend} aria-label="막대 차트 범례">
          <span><i className={styles.cardPaymentBar} />카드결제</span>
          <span><i className={styles.bankPaymentBar} />무통장</span>
        </div>
        <div className={styles.chartAxis}>
            <span>{paymentSeries[0]?.label}</span>
            <span>{paymentSeries.at(-1)?.label}</span>
        </div>
      </div>
      <div className={`${styles.dashboardCard} ${styles.rewardDashboardCard}`}>
        <div className={styles.dashboardCardHeader}>
          <span>적립금 정보</span>
          <RangePicker title="기간별 적립금" value={rewardRange} onChange={setRewardRange} />
        </div>
        <strong>{cumulativeRewardBalance.toLocaleString("ko-KR")}원</strong>
        <small>누적 적립금 · {cumulativeRewardSource === "cafe24" ? "카페24 현재 잔액" : "지급 완료 원장"} 기준 · {RANGE_OPTIONS.find((option) => option.value === rewardRange)?.description} 순지급 {rewardTotal.toLocaleString("ko-KR")}원</small>
        <div className={styles.rewardBreakdown} aria-label="등급별 카드결제와 무통장 적립금 순지급">
          {rewardByGrade.map((grade) => (
            <div className={styles.rewardGradeTotal} key={grade.id}>
              <span>{grade.name}</span>
              <div className={styles.rewardPaymentTotals}>
                <strong>카드 {grade.cardAmount.toLocaleString("ko-KR")}원</strong>
                <strong>무통장 {grade.bankAmount.toLocaleString("ko-KR")}원</strong>
              </div>
            </div>
          ))}
        </div>
        {legacyRewardBalanceUnassignedMemberCount > 0 && (
          <small>{legacyRewardBalanceUnassignedMemberCount}명의 기존 잔액은 카페24 등급 매핑이 없어 합계에서 제외됐습니다.</small>
        )}
      </div>
    </section>
  );
}
