"use client";

import { useEffect, useState } from "react";
import styles from "./admin.module.css";

type BriefingType = "daily" | "weekly" | "monthly";
type Briefing = {
  id: number;
  period_type: BriefingType;
  period_key: string;
  period_label: string;
  scheduled_at: string;
  total_purchase_amount: number;
  margin_rate: number;
  net_margin_amount: number;
  source_order_count: number;
  generated_at: string;
};

const META: Record<BriefingType, { label: string; schedule: string; icon: string }> = {
  daily: { label: "일일", schedule: "매일 09:00", icon: "☀️" },
  weekly: { label: "주간", schedule: "월요일 09:10", icon: "📅" },
  monthly: { label: "월간", schedule: "마지막 날 09:00", icon: "📊" },
};

function won(amount: number) {
  return `${amount.toLocaleString("ko-KR")}원`;
}

function kst(value: string) {
  const date = new Date(`${value.replace(" ", "T")}Z`);
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export default function ProfitBriefingPanel() {
  const [briefings, setBriefings] = useState<Briefing[]>([]);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await fetch("/api/profit-briefings", { cache: "no-store" });
        if (!response.ok) throw new Error("load failed");
        const data = await response.json() as { briefings?: Briefing[] };
        if (!active) return;
        setBriefings(data.briefings ?? []);
        setLoadError(false);
      } catch {
        if (active) setLoadError(true);
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 30_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  const latest = (type: BriefingType) => briefings.find((item) => item.period_type === type);

  return (
    <section className={styles.profitBriefingPanel} aria-labelledby="profit-briefing-title">
      <div className={styles.profitBriefingHeader}>
        <div>
          <span>PROFIT BRIEFING</span>
          <h2 id="profit-briefing-title">수익 브리핑</h2>
          <p>결제 완료·미취소 구매금액 × 마진율 25% · 한국시간 기준</p>
        </div>
        <span className={styles.profitTimezone}>KST · 자동 저장</span>
      </div>
      {loadError && <p className={styles.syncWarning}>수익 브리핑을 불러오지 못했습니다. 자동으로 다시 시도합니다.</p>}
      <div className={styles.profitBriefingGrid}>
        {(Object.keys(META) as BriefingType[]).map((type) => {
          const item = latest(type);
          return (
            <article className={styles.profitBriefingCard} key={type}>
              <div className={styles.profitBriefingCardTitle}>
                <span aria-hidden="true">{META[type].icon}</span>
                <strong>{META[type].label} 브리핑</strong>
                <small>{META[type].schedule}</small>
              </div>
              {item ? (
                <>
                  <p className={styles.profitPeriod}>{item.period_label}</p>
                  <dl>
                    <div><dt>총 구매금액</dt><dd>{won(item.total_purchase_amount)}</dd></div>
                    <div><dt>실마진</dt><dd>{won(item.net_margin_amount)}</dd></div>
                  </dl>
                  <small>{item.source_order_count}건 · {kst(item.scheduled_at)} 확정</small>
                </>
              ) : (
                <p className={styles.profitEmpty}>첫 예약 실행 후 표시됩니다.</p>
              )}
            </article>
          );
        })}
      </div>
      {briefings.length > 0 && (
        <div className={styles.profitBriefingHistory}>
          <h3>최근 생성 이력</h3>
          <div className={styles.profitBriefingTableWrap}>
            <table>
              <thead><tr><th>구분</th><th>대상</th><th>구매금액</th><th>실마진</th><th>확정시각</th></tr></thead>
              <tbody>
                {briefings.slice(0, 12).map((item) => (
                  <tr key={item.id}>
                    <td>{META[item.period_type].label}</td>
                    <td>{item.period_label}</td>
                    <td>{won(item.total_purchase_amount)}</td>
                    <td>{won(item.net_margin_amount)}</td>
                    <td>{kst(item.scheduled_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
