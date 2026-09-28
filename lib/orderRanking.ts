import { changeCafe24Points, getCafe24CustomerGroups, getCafe24OrderForReward } from "./cafe24Admin";
import { db } from "./db";
import { assertCafe24BonusExecutionAllowed } from "./rewardExecution";
import { getBuyerInfo, getCurrentCustomerGroupNo } from "./buyerNames";
import { isAfterRewardStart } from "./rewardCutoff";

export type OrderRankingRow = {
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

type RankingSourceRow = {
  user_id: string;
  youtube_nickname: string | null;
  tier: string;
  total_purchase_amount: number;
  order_count: number;
};

/** 카페24에서 결제가 확인된 누적 주문만으로 구매자별 랭킹을 만듭니다. */
export function getOrderRanking(limit = 10): OrderRankingRow[] {
  const sources = db.prepare(
    `SELECT user_id,
            MAX(youtube_nickname) AS youtube_nickname,
            MAX(NULLIF(tier, '')) AS tier,
            SUM(unit_price * quantity) AS total_purchase_amount,
            COUNT(*) AS order_count
       FROM orders
      WHERE source = 'cafe24'
        AND paid_at IS NOT NULL
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
      WHERE o.source = 'cafe24'
        AND o.paid_at IS NOT NULL
        AND o.status <> 'cancelled'
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
    buyerName: null,
    youtubeNickname: row.youtube_nickname,
    tier: row.tier || null,
    totalPurchaseAmount: Number(row.total_purchase_amount ?? 0),
    orderCount: Number(row.order_count ?? 0),
    rewardPoints: rewards.get(row.user_id) ?? 0,
    bonusPoints: bonuses.get(row.user_id) ?? 0,
    eligibleForBonus: index < 3 && hasCafe24Order(row.user_id),
  }));
}

/** 최근 결제 주문의 회원 ID로 카페24의 현재 회원등급을 조회합니다. */
export async function getOrderRankingWithGrades(limit = 10): Promise<OrderRankingRow[]> {
  const ranking = getOrderRanking(limit);
  if (ranking.length === 0) return ranking;

  const groups = await getCafe24CustomerGroups().catch(() => []);
  const groupNames = new Map(groups.map((group) => [String(group.group_no), group.group_name]));

  return Promise.all(ranking.map(async (row) => {
    const order = findLatestCafe24Order(row.userId);
    if (!order) return { ...row, tier: null };
    const buyer = await getBuyerInfo(order.external_order_id);
    const groupNo = buyer?.memberId ? await getCurrentCustomerGroupNo(buyer.memberId) : null;
    return { ...row, buyerName: buyer?.name ?? null, tier: groupNo ? groupNames.get(groupNo) ?? null : null };
  }));
}

function findLatestCafe24Order(userId: string) {
  return db.prepare(
    `SELECT external_order_id
       FROM orders
      WHERE user_id = ?
        AND source = 'cafe24'
        AND external_order_id IS NOT NULL
        AND paid_at IS NOT NULL
        AND status <> 'cancelled'
      ORDER BY id DESC LIMIT 1`
  ).get(userId) as { external_order_id: string } | undefined;
}

function hasCafe24Order(userId: string) {
  return Boolean(findLatestCafe24Order(userId));
}

/** 현재 상위 3위에게만 카페24 보너스 적립금을 실제 지급합니다. */
export async function grantRankingBonus(userId: string, amount: number, requestId: string) {
  const normalizedAmount = Number(amount);
  if (!userId || !Number.isSafeInteger(normalizedAmount) || normalizedAmount <= 0 || normalizedAmount > 1_000_000) {
    throw new Error("보너스 적립금은 1원 이상 100만 원 이하의 정수여야 합니다.");
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
    throw new Error("유효하지 않은 지급 요청입니다. 화면을 새로고침하고 다시 시도하세요.");
  }

  assertCafe24BonusExecutionAllowed();

  const ranking = getOrderRanking(10);
  const rankingRow = ranking.find((row) => row.userId === userId);
  if (!rankingRow || rankingRow.rank > 3) {
    throw new Error("보너스 적립금은 현재 주문 랭킹 1~3위에게만 지급할 수 있습니다.");
  }

  const order = findLatestCafe24Order(userId);
  if (!order) {
    throw new Error("카페24 주문번호가 있는 구매자에게만 보너스 적립금을 지급할 수 있습니다.");
  }

  // 표시명은 마스킹되어 서로 다른 회원이 같아질 수 있습니다.
  // 같은 표시명으로 합쳐진 모든 결제 주문의 실제 회원 ID가 일치해야 지급합니다.
  const orderIds = db.prepare(
    `SELECT external_order_id FROM orders
      WHERE user_id = ? AND source = 'cafe24' AND paid_at IS NOT NULL
        AND external_order_id IS NOT NULL AND status <> 'cancelled'`
  ).all(userId) as Array<{ external_order_id: string }>;
  const memberIds = new Set<string>();
  for (const item of orderIds) {
    const cafe24Order = await getCafe24OrderForReward(item.external_order_id);
    const memberId = cafe24Order.member_id?.trim();
    const paid = cafe24Order.paid ?? cafe24Order.payment_confirmation;
    if (!memberId || !(paid === true || paid === 1 || String(paid).toUpperCase() === "T")) {
      throw new Error("카페24에서 구매자와 결제완료 상태를 확인할 수 없어 지급을 중단했습니다.");
    }
    if (!isAfterRewardStart(cafe24Order)) {
      throw new Error("적립 시작일 이전 주문이 랭킹에 포함되어 보너스 적립금을 지급할 수 없습니다.");
    }
    if (!Array.isArray(cafe24Order.items) || cafe24Order.items.length === 0 || cafe24Order.items.some((orderItem) =>
      ["C1", "C2", "C3", "CANCELLED", "RETURNED"].includes(String(orderItem.status_code ?? orderItem.order_status).toUpperCase())
    )) {
      throw new Error("취소·환불 품목이 포함된 주문이 있어 랭킹 보너스 지급을 중단했습니다.");
    }
    memberIds.add(memberId);
    if (memberIds.size > 1) {
      throw new Error("같은 표시명에 여러 카페24 회원이 포함되어 있어 보너스를 지급할 수 없습니다.");
    }
  }
  const memberId = memberIds.values().next().value;
  if (!memberId) throw new Error("카페24 주문에서 회원 정보를 확인할 수 없습니다.");

  const inserted = db.prepare(
    `INSERT INTO ranking_bonus_ledger (request_id, user_id, external_order_id, member_id, amount, rank_at_issue, status)
     VALUES (?, ?, ?, ?, ?, ?, 'failed')
     ON CONFLICT(request_id) DO NOTHING`
  ).run(requestId, userId, order.external_order_id, memberId, normalizedAmount, rankingRow.rank);
  if (!inserted.changes) {
    throw new Error("이미 처리한 지급 요청입니다. 원장을 확인한 뒤 새 요청을 시작하세요.");
  }
  const ledgerId = Number(inserted.lastInsertRowid);

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
    return { amount: normalizedAmount };
  } catch (error) {
    db.prepare("UPDATE ranking_bonus_ledger SET error_message = ? WHERE id = ?")
      .run(error instanceof Error ? error.message.slice(0, 500) : "카페24 지급 실패", ledgerId);
    throw new Error("카페24 지급 결과가 불확실합니다. 재시도하지 말고 카페24 적립내역과 원장을 대조하세요.");
  }
}
