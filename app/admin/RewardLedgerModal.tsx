"use client";

import { useEffect, useState } from "react";
import styles from "./admin.module.css";

type LedgerRow = {
  id: number;
  external_order_id: string;
  action: "issue" | "recover";
  amount: number;
  applied_rate: number;
  processing_mode: "automatic" | "manual";
  status: "pending" | "succeeded" | "failed";
  processed_at: string | null;
  error_message: string | null;
  grade_name: string;
  order: {
    created_at: string | null;
    product: string | null;
    quantity: number | null;
    actual_amount: number | null;
    youtube_nickname: string | null;
    buyer_name: string | null;
    payment_method: string | null;
    payment_status: "paid" | "unpaid" | "cancelled" | "unknown";
  };
};

const formatDateTime = (value: string | null) => {
  if (!value) return "-";
  const date = new Date(`${value.replace(" ", "T")}Z`);
  return Number.isNaN(date.getTime()) ? "-" : new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).format(date);
};

const paymentStatusLabel = (status: LedgerRow["order"]["payment_status"]) => ({
  paid: "결제완료", unpaid: "미결제", cancelled: "취소", unknown: "확인불가",
}[status]);

export default function RewardLedgerModal() {
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [recoveringOrderId, setRecoveringOrderId] = useState<string | null>(null);

  async function loadLedger() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/reward-ledger", { cache: "no-store" });
      const data = await response.json() as { rows?: LedgerRow[]; error?: string };
      if (!response.ok) throw new Error(data.error ?? "load failed");
      setLedger(data.rows ?? []);
    } catch {
      setError("적립금 처리 원장을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  async function manuallyRecover(orderId: string) {
    if (!window.confirm(`${orderId} 주문의 적립금을 실제 카페24에서 회수하시겠습니까?`)) return;
    setRecoveringOrderId(orderId);
    setError(null);
    try {
      const response = await fetch("/api/reward-ledger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId }),
      });
      const data = await response.json() as { rows?: LedgerRow[]; error?: string };
      if (!response.ok) throw new Error(data.error ?? "recover failed");
      setLedger(data.rows ?? []);
    } catch {
      setError("적립금 회수에 실패했습니다. 원장 오류 내용을 확인하세요.");
      await loadLedger();
    } finally {
      setRecoveringOrderId(null);
    }
  }

  useEffect(() => { void loadLedger(); }, []);

  return (
    <section className={styles.rewardLedgerModalContent} aria-labelledby="reward-ledger-title">
      <div className={styles.rewardLedgerHeader}>
        <p id="reward-ledger-title">주문 정보와 지급·회수 결과를 함께 확인합니다.</p>
        <button type="button" onClick={() => void loadLedger()} disabled={loading}>
          {loading ? "불러오는 중..." : "원장 새로고침"}
        </button>
      </div>
      {error ? <p className={styles.rewardError}>{error}</p> : loading ? (
        <p className={styles.ledgerEmpty}>적립금 처리 원장을 불러오는 중입니다.</p>
      ) : ledger.length === 0 ? (
        <p className={styles.ledgerEmpty}>표시할 적립금 처리 내역이 없습니다.</p>
      ) : (
        <div className={styles.rewardTableWrap}>
          <table className={`${styles.rewardTable} ${styles.rewardLedgerTable}`}>
            <thead><tr><th>주문번호</th><th>주문일시</th><th>상품명</th><th>실결제액</th><th>수량</th><th>유튜브 닉네임</th><th>구매자</th><th>회원등급</th><th>결제방식</th><th>결제상태</th><th>적용률</th><th>처리</th><th>적립금</th><th>처리시각</th><th>상태</th><th>조치</th></tr></thead>
            <tbody>{ledger.map((row) => (
              <tr key={row.id}>
                <td>{row.external_order_id}</td><td>{formatDateTime(row.order.created_at)}</td><td className={styles.rewardLedgerProduct} title={row.order.product ?? ""}>{row.order.product ?? "-"}</td>
                <td>{row.order.actual_amount === null ? "-" : `${row.order.actual_amount.toLocaleString("ko-KR")}원`}</td><td>{row.order.quantity ?? "-"}</td>
                <td>{row.order.youtube_nickname || "-"}</td><td>{row.order.buyer_name ?? "-"}</td><td>{row.grade_name}</td>
                <td>{row.order.payment_method ?? "-"}</td><td>{paymentStatusLabel(row.order.payment_status)}</td><td>{row.applied_rate}%</td>
                <td>{row.action === "issue" ? "지급" : "회수"} · {row.processing_mode === "automatic" ? "자동" : "수동"}</td>
                <td>{row.amount.toLocaleString("ko-KR")}원</td><td>{formatDateTime(row.processed_at)}</td><td title={row.error_message ?? ""}>{row.status === "succeeded" ? "완료" : row.status === "failed" ? "실패" : "대기"}</td>
                <td>{row.action === "issue" && row.status === "succeeded" && (
                  <button type="button" className={styles.manualRecoverButton} onClick={() => void manuallyRecover(row.external_order_id)} disabled={recoveringOrderId === row.external_order_id}>
                    {recoveringOrderId === row.external_order_id ? "처리 중..." : "수동 회수"}
                  </button>
                )}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}
