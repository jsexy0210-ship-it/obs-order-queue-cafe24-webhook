"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./admin.module.css";

type Order = {
  external_order_id: string | null;
  created_at: string;
  quantity: number;
  unit_price: number;
  payment_method: string | null;
};

type RewardSummary = {
  issue?: { amount: number; grade_id: string; status: "pending" | "succeeded" | "failed" };
};
type Grade = { id: string; name: string };

const BANK_DEPOSIT_METHODS = new Set(["cash", "deposit", "escrow_cash"]);
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const SERIES_LENGTH = 12;

type SeriesPoint = { label: string; amount: number; cardCount: number; bankCount: number };

function parseOrderDate(value: string) {
  const date = new Date(`${value.replace(" ", "T")}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function makeWeeklySeries(orders: Order[]): SeriesPoint[] {
  const now = new Date();
  const start = new Date(now.getTime() - (SERIES_LENGTH - 1) * WEEK_MS);
  start.setHours(0, 0, 0, 0);
  const series = Array.from({ length: SERIES_LENGTH }, (_, index) => {
    const date = new Date(start.getTime() + index * WEEK_MS);
    return {
      label: `${date.getMonth() + 1}/${date.getDate()}`,
      amount: 0,
      cardCount: 0,
      bankCount: 0,
    };
  });

  orders.forEach((order) => {
    const date = parseOrderDate(order.created_at);
    if (!date) return;
    const index = Math.floor((date.getTime() - start.getTime()) / WEEK_MS);
    if (index < 0 || index >= SERIES_LENGTH) return;
    series[index].amount += order.unit_price * order.quantity;
    const method = order.payment_method?.toLowerCase() ?? "";
    if (method === "card") series[index].cardCount += 1;
    if (BANK_DEPOSIT_METHODS.has(method)) series[index].bankCount += 1;
  });
  return series;
}

export default function OrderDashboard() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [rewards, setRewards] = useState<Record<string, RewardSummary>>({});
  const [grades, setGrades] = useState<Grade[]>([]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const [historyResponse, settingsResponse] = await Promise.all([
          fetch("/api/order-history?range=recent3months", { cache: "no-store" }),
          fetch("/api/reward-settings", { cache: "no-store" }),
        ]);
        const history = await historyResponse.json() as {
          orders?: Order[];
          rewardSummaries?: Record<string, RewardSummary>;
        };
        const settings = await settingsResponse.json() as { settings?: { grades?: Grade[] } };
        if (!active || !historyResponse.ok || !settingsResponse.ok) return;
        setOrders(history.orders ?? []);
        setRewards(history.rewardSummaries ?? {});
        setGrades(settings.settings?.grades ?? []);
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

  const metrics = useMemo(() => {
    const totalAmount = orders.reduce((total, order) => total + order.unit_price * order.quantity, 0);
    const cardCount = orders.filter(
      (order) => order.payment_method?.toLowerCase() === "card"
    ).length;
    const bankCount = orders.filter((order) =>
      BANK_DEPOSIT_METHODS.has(order.payment_method?.toLowerCase() ?? "")
    ).length;
    const paymentCount = cardCount + bankCount;
    const rewardTotal = Object.values(rewards).reduce(
      (total, reward) => total + (reward.issue?.status === "succeeded" ? reward.issue.amount : 0),
      0
    );
    const rewardByGrade = grades.map((grade) => ({
      ...grade,
      amount: Object.values(rewards).reduce(
        (total, reward) => total + (
          reward.issue?.status === "succeeded" && reward.issue.grade_id === grade.id
            ? reward.issue.amount
            : 0
        ),
        0
      ),
    }));
    return {
      totalAmount,
      paymentCount,
      cardCount,
      bankCount,
      rewardTotal,
      rewardByGrade,
      weeklySeries: makeWeeklySeries(orders),
    };
  }, [grades, orders, rewards]);

  const amountPeak = Math.max(1, ...metrics.weeklySeries.map((point) => point.amount));
  const amountLinePoints = metrics.weeklySeries
    .map((point, index) => {
      const x = (index / (SERIES_LENGTH - 1)) * 100;
      const y = 91 - (point.amount / amountPeak) * 78;
      return `${x},${y}`;
    })
    .join(" ");
  const paymentPeak = Math.max(
    1,
    ...metrics.weeklySeries.flatMap((point) => [point.cardCount, point.bankCount])
  );

  return (
    <section className={styles.orderDashboard} aria-label="주문 요약 대시보드">
      <div className={`${styles.dashboardCard} ${styles.chartDashboardCard}`}>
        <span>총 주문금액</span>
        <strong>{metrics.totalAmount.toLocaleString("ko-KR")}원</strong>
        <small>최근 3개월 · 주별 주문금액 추이</small>
        <div className={styles.lineChart} role="img" aria-label="최근 3개월 주별 총 주문금액 선 그래프">
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <line x1="0" y1="26" x2="100" y2="26" />
            <line x1="0" y1="58" x2="100" y2="58" />
            <line x1="0" y1="91" x2="100" y2="91" />
            <polyline points={amountLinePoints} />
          </svg>
          <div className={styles.chartAxis}>
            <span>{metrics.weeklySeries[0]?.label}</span>
            <span>{metrics.weeklySeries.at(-1)?.label}</span>
          </div>
        </div>
      </div>
      <div className={`${styles.dashboardCard} ${styles.chartDashboardCard}`}>
        <span>카드결제 + 무통장 총계</span>
        <strong>{metrics.paymentCount}건</strong>
        <small>카드결제 {metrics.cardCount}건 · 무통장 {metrics.bankCount}건</small>
        <div className={styles.barChart} role="img" aria-label="최근 3개월 주별 카드결제와 무통장 주문 건수 막대 그래프">
          {metrics.weeklySeries.map((point) => (
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
          <span>{metrics.weeklySeries[0]?.label}</span>
          <span>{metrics.weeklySeries.at(-1)?.label}</span>
        </div>
      </div>
      <div className={`${styles.dashboardCard} ${styles.rewardDashboardCard}`}>
        <span>적립금 지급 총액</span>
        <strong>{metrics.rewardTotal.toLocaleString("ko-KR")}원</strong>
        <small>등급별 지급 완료 원장 기준</small>
        <div className={styles.rewardBreakdown} aria-label="등급별 적립금 지급 총액">
          {metrics.rewardByGrade.map((grade) => (
            <div className={styles.rewardGradeTotal} key={grade.id}>
              <span>{grade.name}</span>
              <strong>{grade.amount.toLocaleString("ko-KR")}원</strong>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
