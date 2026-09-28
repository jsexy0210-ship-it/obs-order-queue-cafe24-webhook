"use client";

import { useEffect, useState } from "react";
import styles from "./admin.module.css";

type RankingRow = {
  rank: number;
  userId: string;
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
  executionMode?: "test" | "live";
  error?: string;
};

type PendingBonus = {
  row: RankingRow;
  amount: number;
};

const TROPHIES = ["🥇", "🥈", "🥉"];
const formatWon = (amount: number) => `${amount.toLocaleString("ko-KR")}원`;

export default function OrderRankingPanel() {
  const [ranking, setRanking] = useState<RankingRow[]>([]);
  const [executionMode, setExecutionMode] = useState<"test" | "live">("test");
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
      setExecutionMode(data.executionMode ?? "test");
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
    if (!Number.isInteger(amount) || amount <= 0) {
      setNotice("보너스 적립금은 1원 이상의 정수로 입력하세요.");
      return;
    }
    setPendingBonus({ row, amount });
  }

  async function confirmBonus() {
    if (!pendingBonus) return;
    const { row, amount } = pendingBonus;
    setPendingBonus(null);

    setSavingUserId(row.userId);
    setNotice(null);
    try {
      const response = await fetch("/api/order-ranking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: row.userId, amount }),
      });
      const data = await response.json() as RankingResponse & { result?: { mode: "test" | "live"; amount: number } };
      if (!response.ok) throw new Error(data.error ?? "보너스 적립금 지급에 실패했습니다.");
      setRanking(data.ranking ?? []);
      setExecutionMode(data.executionMode ?? executionMode);
      setBonusAmounts((current) => ({ ...current, [row.userId]: "" }));
      setNotice(data.result?.mode === "live"
        ? `${row.userId}님에게 ${formatWon(data.result.amount)}을 실제 지급했습니다.`
        : `${row.userId}님 보너스 ${formatWon(data.result?.amount ?? amount)} 지급을 테스트로 기록했습니다.`);
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
          <h2 id="ranking-title">주문랭킹 TOP 10</h2>
          <p>최근 3개월 MangoTCG 주문의 취소·환불 제외 누적 구매금액 기준 Top 10입니다.</p>
        </div>
        <button className={styles.rankingRefreshButton} onClick={() => void load()} disabled={loading}>
          {loading ? "불러오는 중" : "새로고침"}
        </button>
      </div>

      <div className={`${styles.rankingMode} ${executionMode === "live" ? styles.rankingModeLive : ""}`}>
        <strong>{executionMode === "live" ? "실운영 모드" : "테스트 모드"}</strong>
        <span>{executionMode === "live" ? "보너스 적립금은 카페24 고객 적립금에 실제 지급됩니다." : "보너스 적립금은 카페24에 지급되지 않고 테스트 기록만 남습니다."}</span>
      </div>
      {notice && <p className={styles.rankingNotice}>{notice}</p>}

      {loading ? (
        <div className={styles.rankingEmpty}>랭킹을 불러오는 중입니다.</div>
      ) : ranking.length === 0 ? (
        <div className={styles.rankingEmpty}>랭킹을 만들 주문 이력이 없습니다.</div>
      ) : (
        <div className={styles.rankingList}>
          {ranking.map((row) => {
            const isTopThree = row.rank <= 3;
            return (
              <article className={`${styles.rankingCard} ${isTopThree ? styles.topRankingCard : ""}`} key={row.userId}>
                <div className={styles.rankingRank} aria-label={`${row.rank}위`}>
                  {isTopThree ? TROPHIES[row.rank - 1] : `${row.rank}위`}
                </div>
                <div className={styles.rankingCustomer}>
                  <strong>{row.userId}</strong>
                  <span>{row.youtubeNickname ? `YT: ${row.youtubeNickname}` : row.tier ?? "회원등급 미확인"}</span>
                </div>
                <dl className={styles.rankingMetrics}>
                  <div><dt>총 구매금액</dt><dd>{formatWon(row.totalPurchaseAmount)}</dd></div>
                  <div><dt>주문 건수</dt><dd>{row.orderCount}건</dd></div>
                  <div><dt>적립 포인트</dt><dd>{formatWon(row.rewardPoints)}</dd></div>
                  <div><dt>보너스 적립금</dt><dd>{formatWon(row.bonusPoints)}</dd></div>
                </dl>
                {isTopThree && (
                  <div className={styles.bonusAction}>
                    <label>
                      <span>보너스 적립금</span>
                      <input
                        type="number"
                        min="1"
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
          <h3 id="bonus-confirm-title">
            {executionMode === "live" ? "실제 적립금 지급을 진행합니다" : "테스트 지급 기록을 남깁니다"}
          </h3>
          <p className={styles.bonusConfirmAmount}>
            {pendingBonus.row.userId} · {formatWon(pendingBonus.amount)}
          </p>
          <div id="bonus-confirm-description" className={styles.bonusConfirmWarning}>
            {executionMode === "live" ? (
              <>
                <strong>주의: 카페24 고객 적립금 잔액이 즉시 증가합니다.</strong>
                <span>이 지급은 주문 적립금과 별개이며, 취소·환불 시 자동 회수되지 않습니다.</span>
                <span>지급 후에는 이 화면에서 되돌릴 수 없습니다.</span>
              </>
            ) : (
              <>
                <strong>테스트 모드: 카페24 고객 적립금에는 실제 지급되지 않습니다.</strong>
                <span>관리자 테스트 지급 이력만 남습니다.</span>
              </>
            )}
          </div>
          <div className={styles.bonusConfirmActions}>
            <button onClick={() => setPendingBonus(null)}>취소</button>
            <button className={styles.bonusConfirmProceed} onClick={() => void confirmBonus()}>
              {executionMode === "live" ? "실제 지급 확정" : "테스트 지급 기록"}
            </button>
          </div>
        </section>
      </div>
    )}
    </>
  );
}
