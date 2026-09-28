import { changeCafe24Points, getCafe24OrderForReward } from "./cafe24Admin";
import { db } from "./db";
import { canExecuteCafe24RewardChanges, getRewardExecutionMode } from "./rewardExecution";

export type OrderRankingRow = {
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

type RankingSourceRow = {
  user_id: string;
  youtube_nickname: string | null;
  tier: string;
  total_purchase_amount: number;
  order_count: number;
};

/** 최근 3개월 MangoTCG 보관 주문을 기준으로 구매자별 누적 랭킹을 만듭니다. */
export function getOrderRanking(limit = 10): OrderRankingRow[] {
  const sources = db.prepare(
    `SELECT user_id,
            MAX(youtube_nickname) AS youtube_nickname,
            MAX(NULLIF(tier, '')) AS tier,
            SUM(unit_price * quantity) AS total_purchase_amount,
            COUNT(*) AS order_count
       FROM orders
      WHERE created_at >= datetime('now', '-3 months')
        AND status <> 'cancelled'
      GROUP BY user_id
      ORDER BY total_purchase_amount DESC, order_count DESC, user_id ASC
      LIMIT ?`
  ).all(limit) as RankingSourceRow[];

  const rewardRows = db.prepare(
    `SELECT o.user_id,
            SUM(CASE
              WHEN l.action = 'issue' AND l.status = 'succeeded' THEN l.amount
              WHEN l.action = 'recover' AND l.status = 'succeeded' THEN -l.amount
              ELSE 0
            END) AS reward_points
       FROM reward_ledger l
       JOIN orders o ON o.external_order_id = l.external_order_id
      WHERE o.created_at >= datetime('now', '-3 months')
      GROUP BY o.user_id`
  ).all() as Array<{ user_id: string; reward_points: number | null }>;
  const rewards = new Map(rewardRows.map((row) => [row.user_id, Number(row.reward_points ?? 0)]));

  const bonusRows = db.prepare(
    `SELECT user_id, SUM(amount) AS bonus_points
       FROM ranking_bonus_ledger
      WHERE status = 'succeeded'
      GROUP BY user_id`
  ).all() as Array<{ user_id: string; bonus_points: number | null }>;
  const bonuses = new Map(bonusRows.map((row) => [row.user_id, Number(row.bonus_points ?? 0)]));

  return sources.map((row, index) => ({
    rank: index + 1,
    userId: row.user_id,
    youtubeNickname: row.youtube_nickname,
    tier: row.tier || null,
    totalPurchaseAmount: Number(row.total_purchase_amount ?? 0),
    orderCount: Number(row.order_count ?? 0),
    rewardPoints: rewards.get(row.user_id) ?? 0,
    bonusPoints: bonuses.get(row.user_id) ?? 0,
    eligibleForBonus: index < 3 && hasCafe24Order(row.user_id),
  }));
}

function findLatestCafe24Order(userId: string) {
  return db.prepare(
    `SELECT external_order_id
       FROM orders
      WHERE user_id = ?
        AND source = 'cafe24'
        AND external_order_id IS NOT NULL
        AND status <> 'cancelled'
      ORDER BY id DESC LIMIT 1`
  ).get(userId) as { external_order_id: string } | undefined;
}

function hasCafe24Order(userId: string) {
  return Boolean(findLatestCafe24Order(userId));
}

/** 현재 상위 3위에게만 보너스 적립금을 지급합니다. 테스트 모드에서는 원장에 테스트 결과만 남깁니다. */
export async function grantRankingBonus(userId: string, amount: number) {
  const normalizedAmount = Math.floor(Number(amount));
  if (!userId || !Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
    throw new Error("보너스 적립금은 1원 이상의 정수여야 합니다.");
  }

  const ranking = getOrderRanking(10);
  const rankingRow = ranking.find((row) => row.userId === userId);
  if (!rankingRow || rankingRow.rank > 3) {
    throw new Error("보너스 적립금은 현재 주문 랭킹 1~3위에게만 지급할 수 있습니다.");
  }

  const order = findLatestCafe24Order(userId);
  if (!order) {
    throw new Error("카페24 주문번호가 있는 구매자에게만 보너스 적립금을 지급할 수 있습니다.");
  }

  if (!canExecuteCafe24RewardChanges()) {
    db.prepare(
      `INSERT INTO ranking_bonus_ledger (user_id, external_order_id, amount, rank_at_issue, status)
       VALUES (?, ?, ?, ?, 'test')`
    ).run(userId, order.external_order_id, normalizedAmount, rankingRow.rank);
    return { mode: "test" as const, amount: normalizedAmount };
  }

  const cafe24Order = await getCafe24OrderForReward(order.external_order_id);
  const memberId = cafe24Order.member_id?.trim();
  if (!memberId) throw new Error("카페24 주문에서 회원 정보를 확인할 수 없습니다.");

  const ledgerId = Number(db.prepare(
    `INSERT INTO ranking_bonus_ledger (user_id, external_order_id, member_id, amount, rank_at_issue, status)
     VALUES (?, ?, ?, ?, ?, 'failed')`
  ).run(userId, order.external_order_id, memberId, normalizedAmount, rankingRow.rank).lastInsertRowid);

  try {
    await changeCafe24Points({
      memberId,
      orderId: order.external_order_id,
      amount: normalizedAmount,
      type: "increase",
      reason: `망고TCG 주문 랭킹 ${rankingRow.rank}위 보너스 적립금`,
    });
    db.prepare(
      `UPDATE ranking_bonus_ledger
          SET status = 'succeeded', processed_at = datetime('now'), error_message = NULL
        WHERE id = ?`
    ).run(ledgerId);
    return { mode: "live" as const, amount: normalizedAmount };
  } catch (error) {
    db.prepare("UPDATE ranking_bonus_ledger SET error_message = ? WHERE id = ?")
      .run(error instanceof Error ? error.message.slice(0, 500) : "카페24 지급 실패", ledgerId);
    throw error;
  }
}

export function getOrderRankingExecutionMode() {
  return getRewardExecutionMode();
}
