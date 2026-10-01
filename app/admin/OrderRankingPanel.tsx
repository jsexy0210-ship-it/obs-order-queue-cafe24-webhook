"use client";

import { useEffect, useState } from "react";
import GlobalLoadingOverlay from "@/app/GlobalLoadingOverlay";
import styles from "./admin.module.css";

type RankingRow = {
  rank: number;
  userId: string;
  buyerName: string | null;
  youtubeNickname: string | null;
  tier: string | null;
  totalPurchaseAmount: number;
  orderCount: number;
  rewardPoints: number;
  bonusPoints: number;
  eligibleForBonus: boolean;
};

type RankingResponse = {
  ranking?: RankingRow[];
  error?: string;
};

type PendingBonus = {
  row: RankingRow;
  amount: number;
  requestId: string;
};

const formatWon = (amount: number) => `${amount.toLocaleString("ko-KR")}원`;

export default function OrderRankingPanel({ onBack }: { onBack: () => void }) {
  const [ranking, setRanking] = useState<RankingRow[]>([]);
  const [bonusAmounts, setBonusAmounts] = useState<Record<string, string>>({});
  const [savingUserId, setSavingUserId] = useState<string | null>(null);
  const [pendingBonus, setPendingBonus] = useState<PendingBonus | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    try {
      const response = await fetch("/api/order-ranking", { cache: "no-store" });
      const data = await response.json() as RankingResponse;
      if (!response.ok) throw new Error(data.error ?? "주문 랭킹을 불러올 수 없습니다.");
      setRanking(data.ranking ?? []);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "주문 랭킹을 불러올 수 없습니다.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function requestBonus(row: RankingRow) {
    const amount = Number(bonusAmounts[row.userId] ?? "");
    if (!Number.isInteger(amount) || amount <= 0 || amount > 1_000_000) {
      setNotice("보너스 적립금은 1원 이상 100만 원 이하의 정수로 입력하세요.");
      return;
    }
    setPendingBonus({ row, amount, requestId: crypto.randomUUID() });
  }

  async function confirmBonus() {
    if (!pendingBonus) return;
    const { row, amount, requestId } = pendingBonus;
    setPendingBonus(null);

    setSavingUserId(row.userId);
    setNotice(null);
    try {
      const response = await fetch("/api/order-ranking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: row.userId, amount, requestId }),
      });
      const data = await response.json() as RankingResponse & { result?: { amount: number } };
      if (!response.ok) throw new Error(data.error ?? "보너스 적립금 지급에 실패했습니다.");
      setRanking(data.ranking ?? []);
      setBonusAmounts((current) => ({ ...current, [row.userId]: "" }));
      setNotice(`${row.buyerName ?? "구매자 확인 불가"}님에게 ${formatWon(data.result?.amount ?? amount)}을 카페24 적립금으로 지급했습니다.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "보너스 적립금 지급에 실패했습니다.");
    } finally {
      setSavingUserId(null);
    }
  }

  return (
    <>
    <section className={styles.rankingPage} aria-labelledby="ranking-title">
      <div className={styles.rankingHero}>
        <div>
          <div className={styles.pageTitleRow}>
            <button className={styles.pageBackButton} onClick={onBack} aria-label="뒤로가기" title="뒤로가기">←</button>
            <h2 id="ranking-title">주문랭킹 TOP 10</h2>
          </div>
          <p>카페24 결제완료 주문의 취소·환불 제외 누적 구매금액 기준 Top 10입니다.</p>
        </div>
        <button className={styles.rankingRefreshButton} onClick={() => void load()} disabled={loading}>
          {loading ? "불러오는 중" : "새로고침"}
        </button>
      </div>

      {notice && <p className={styles.rankingNotice}>{notice}</p>}

      {loading ? <GlobalLoadingOverlay /> : ranking.length === 0 ? (
        <div className={styles.rankingEmpty}>랭킹을 만들 주문 이력이 없습니다.</div>
      ) : (
        <div className={styles.rankingList}>
          {ranking.map((row) => {
            const isTopThree = row.rank <= 3;
            const isTopTen = row.rank <= 10;
            return (
              <article className={`${styles.rankingCard} ${isTopThree ? styles.topRankingCard : ""}`} key={row.userId}>
                <div className={styles.rankingRank} aria-label={`${row.rank}위`}>
                  {isTopThree ? (
                    <span className={`${styles.rankingTrophy} ${styles[`rankingTrophy${row.rank}`]}`}>
                      <span aria-hidden="true">🏆</span>
                      <strong>{row.rank}</strong>
                    </span>
                  ) : `${row.rank}위`}
                </div>
                <div className={styles.rankingCustomer}>
                  <div className={styles.rankingIdentity}>
                    <strong>{row.buyerName ?? "구매자 확인 불가"}</strong>
                    <span
                      className={`${styles.rankingGradeBadge} ${row.tier ? "" : styles.rankingGradeUnknown}`}
                      title="카페24의 현재 회원등급"
                    >
                      {row.tier ?? "등급 확인 불가"}
                    </span>
                  </div>
                  {row.youtubeNickname && <span>YT: {row.youtubeNickname}</span>}
                </div>
                <dl className={styles.rankingMetrics}>
                  <div><dt>총 구매금액</dt><dd>{formatWon(row.totalPurchaseAmount)}</dd></div>
                  <div><dt>주문 건수</dt><dd>{row.orderCount}건</dd></div>
                  <div><dt>보유 적립금</dt><dd>{formatWon(row.rewardPoints)}</dd></div>
                  <div><dt>보너스 적립금</dt><dd>{formatWon(row.bonusPoints)}</dd></div>
                </dl>
                {isTopTen && (
                  <div className={styles.bonusAction}>
                    <label>
                      <span>보너스 적립금</span>
                      <input
                        type="number"
                        min="1"
                        max="1000000"
                        step="1"
                        placeholder="금액"
                        value={bonusAmounts[row.userId] ?? ""}
                        onChange={(event) => setBonusAmounts((current) => ({ ...current, [row.userId]: event.target.value }))}
                        disabled={!row.eligibleForBonus || savingUserId === row.userId}
                      />
                    </label>
                    <button
                      onClick={() => requestBonus(row)}
                      disabled={!row.eligibleForBonus || savingUserId === row.userId}
                      title={!row.eligibleForBonus ? "카페24 주문번호가 있는 구매자에게만 지급할 수 있습니다." : undefined}
                    >
                      {savingUserId === row.userId ? "지급 중" : "보너스 지급"}
                    </button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
    {pendingBonus && (
      <div className={styles.bonusConfirmBackdrop} role="presentation">
        <section
          className={styles.bonusConfirmDialog}
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="bonus-confirm-title"
          aria-describedby="bonus-confirm-description"
        >
          <p className={styles.bonusConfirmEyebrow}>지급 전 최종 확인</p>
          <h3 id="bonus-confirm-title">카페24 적립금 실지급을 진행합니다</h3>
          <p className={styles.bonusConfirmAmount}>
            {pendingBonus.row.buyerName ?? "구매자 확인 불가"} · {formatWon(pendingBonus.amount)}
          </p>
          <div id="bonus-confirm-description" className={styles.bonusConfirmWarning}>
            <strong>주의: 카페24 고객 적립금 잔액이 즉시 증가합니다.</strong>
            <span>이 지급은 주문 적립금과 별개이며, 취소·환불 시 자동 회수되지 않습니다.</span>
            <span>지급 후에는 이 화면에서 되돌릴 수 없습니다.</span>
          </div>
          <div className={styles.bonusConfirmActions}>
            <button onClick={() => setPendingBonus(null)}>취소</button>
            <button className={styles.bonusConfirmProceed} onClick={() => void confirmBonus()}>
              실제 지급 확정
            </button>
          </div>
        </section>
      </div>
    )}
    </>
  );
}
