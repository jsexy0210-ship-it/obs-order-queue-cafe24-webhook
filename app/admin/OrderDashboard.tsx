"use client";

import { useEffect, useState } from "react";
import styles from "./admin.module.css";
import { DEVELOPMENT_HOME_SAMPLES_ENABLED, getDevelopmentDashboardSamples } from "./developmentHomeSamples";

type Order = {
  created_at: string;
  actual_amount: number;
  points_spent_amount?: number | null;
  payment_method: string | null;
  paid_at: string | null;
  status: string;
};

type RewardEntry = {
  amount: number;
  grade_id: string;
  payment_kind: "card" | "bank" | "unknown";
  order_created_at: string;
};
type Grade = { id: string; name: string };
export type DashboardRange = "day" | "week" | "month" | "year";

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

export function DashboardRangePicker({ value, onChange }: {
  value: DashboardRange;
  onChange: (value: DashboardRange) => void;
}) {
  return <div className={styles.dashboardRangePicker} role="group" aria-label="대시보드 기간">
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

export default function OrderDashboard({ range }: { range: DashboardRange }) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [rewardEntries, setRewardEntries] = useState<RewardEntry[]>([]);
  const [grades, setGrades] = useState<Grade[]>([]);
  const [now, setNow] = useState(0);
  const [syncError, setSyncError] = useState(false);

  useEffect(() => {
    let active = true;
    const load = async () => {
      if (DEVELOPMENT_HOME_SAMPLES_ENABLED) {
        const samples = getDevelopmentDashboardSamples();
        if (!active) return;
        setOrders(samples.orders);
        setRewardEntries(samples.rewardEntries);
        setGrades([
          { id: "starter", name: "Starter" },
          { id: "trainer", name: "Trainer" },
          { id: "collector", name: "Collector" },
          { id: "elite_collector", name: "Elite Collector" },
          { id: "master_collector", name: "Master Collector" },
          { id: "champion", name: "Champion" },
          { id: "legend", name: "Legend" },
          { id: "legend_vip", name: "Legend VIP" },
        ]);
        setSyncError(false);
        setNow(Date.now());
        return;
      }
      try {
        const [historyResponse, settingsResponse] = await Promise.all([
          fetch("/api/order-history?range=dashboard", { cache: "no-store" }),
          fetch("/api/reward-settings", { cache: "no-store" }),
        ]);
        const history = await historyResponse.json() as {
          orders?: Order[];
          rewardEntries?: RewardEntry[];
          syncError?: boolean;
        };
        const settings = await settingsResponse.json() as { settings?: { grades?: Grade[] } };
        if (!active || !historyResponse.ok || !settingsResponse.ok) return;
        setOrders(history.orders ?? []);
        setRewardEntries(history.rewardEntries ?? []);
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
      && time >= rangeStart(range, now) && time <= now;
  });
  const paymentOrders = orders.filter((order) => {
    const time = parseUtc(order.created_at);
    return order.status !== "cancelled" && Boolean(order.paid_at)
      && time >= rangeStart(range, now) && time <= now;
  });
  const currentRewards = rewardEntries.filter((entry) => {
    const time = parseUtc(entry.order_created_at);
    return time >= rangeStart(range, now) && time <= now;
  });
  const totalPointsSpent = amountOrders.reduce((total, order) => total + (order.points_spent_amount ?? 0), 0);
  const unknownPointsSpentCount = amountOrders.filter((order) => order.points_spent_amount == null).length;
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
        .reduce((total, entry) => total + entry.amount, 0),
      otherAmount: entries
        .filter((entry) => entry.payment_kind === "unknown")
        .reduce((total, entry) => total + entry.amount, 0),
    };
  });
  const amountSeries = makeSeries(amountOrders, range, now);
  const paymentSeries = makeSeries(paymentOrders, range, now);
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
        </div>
        <strong>{totalAmount.toLocaleString("ko-KR")}원</strong>
        <small>적립금 사용액 {totalPointsSpent.toLocaleString("ko-KR")}원{unknownPointsSpentCount > 0 && ` · ${unknownPointsSpentCount}건 조회 불가`}</small>
        <small>{RANGE_OPTIONS.find((option) => option.value === range)?.description} · 주문금액 추이</small>
        <div className={styles.lineChart} role="img" aria-label={`${range} 기간별 총 주문금액 선 그래프`}>
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
          <span>총 결제건수</span>
        </div>
        <strong>{paymentCount}건</strong>
        <small>카드결제 {cardCount}건 · 무통장 {bankCount}건</small>
        <div className={styles.barChart} role="img" aria-label={`${range} 기간별 카드결제와 무통장 주문 건수 막대 그래프`}>
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
          <span>적립금 지급 현황</span>
        </div>
        <strong>{rewardTotal.toLocaleString("ko-KR")}원</strong>
        <small>누적 적립금 · 지급 완료 원장 기준 · {RANGE_OPTIONS.find((option) => option.value === range)?.description} 순지급</small>
        <div className={styles.rewardBreakdown} aria-label="등급별 카드결제와 무통장 적립금 순지급">
          {rewardByGrade.map((grade) => (
            <div className={styles.rewardGradeTotal} key={grade.id}>
              <span>{grade.name}</span>
              <div className={styles.rewardPaymentTotals}>
                <strong>카드 {grade.cardAmount.toLocaleString("ko-KR")}원</strong>
                <strong>무통 {grade.bankAmount.toLocaleString("ko-KR")}원</strong>
                {grade.otherAmount > 0 && <strong>기타 {grade.otherAmount.toLocaleString("ko-KR")}원</strong>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
