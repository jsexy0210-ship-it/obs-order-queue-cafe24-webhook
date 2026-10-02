import {
  changeCafe24Points,
  getCafe24CustomerGroups,
  getCafe24OrderBuyerInfo,
  getCafe24OrderForReward,
} from "./cafe24Admin";
import { db } from "./db";
import { assertCafe24BonusExecutionAllowed } from "./rewardExecution";
import { getBuyerInfo, getCurrentCustomerGroupNo } from "./buyerNames";
import { isAfterRewardStart } from "./rewardCutoff";
import { refreshCafe24PointBalanceSnapshot } from "./rewardService";
import { saveCafe24OrderIdentity } from "./store";

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
  buyer_name: string | null;
  youtube_nickname: string | null;
  tier: string;
  total_purchase_amount: number;
  order_count: number;
};

/** 카페24에서 결제가 확인된 누적 주문만으로 구매자별 랭킹을 만듭니다. */
export function getOrderRanking(limit = 10): OrderRankingRow[] {
  const sources = db.prepare(
    `WITH eligible_orders AS (
       SELECT *, COALESCE(NULLIF(member_id, ''), 'order:' || COALESCE(external_order_id, id)) AS ranking_user_id
         FROM orders
        WHERE source = 'cafe24'
          AND paid_at IS NOT NULL
          AND status <> 'cancelled'
     )
     SELECT ranking_user_id AS user_id,
            MAX(user_id) AS buyer_name,
            MAX(youtube_nickname) AS youtube_nickname,
            MAX(NULLIF(tier, '')) AS tier,
            SUM(COALESCE(actual_amount, unit_price * quantity)) AS total_purchase_amount,
            COUNT(*) AS order_count
       FROM eligible_orders
      GROUP BY ranking_user_id
      ORDER BY total_purchase_amount DESC, order_count DESC, user_id ASC
      LIMIT ?`
  ).all(limit) as RankingSourceRow[];

  const rewardRows = db.prepare(
    `SELECT COALESCE(NULLIF(o.member_id, ''), 'order:' || COALESCE(o.external_order_id, o.id)) AS user_id,
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
      GROUP BY COALESCE(NULLIF(o.member_id, ''), 'order:' || COALESCE(o.external_order_id, o.id))`
  ).all() as Array<{ user_id: string; reward_points: number | null }>;
  const rewards = new Map(rewardRows.map((row) => [row.user_id, Number(row.reward_points ?? 0)]));

  const pointBalanceRows = db.prepare(
    `SELECT member_id, buyer_name, balance
       FROM cafe24_member_point_balance_snapshots`
  ).all() as Array<{ member_id: string; buyer_name: string; balance: number }>;
  const pointBalancesByMemberId = new Map(pointBalanceRows.map((row) => [row.member_id, Number(row.balance)]));

  const bonusRows = db.prepare(
    `SELECT COALESCE(NULLIF(member_id, ''), user_id) AS user_id, SUM(amount) AS bonus_points
       FROM ranking_bonus_ledger
      WHERE status = 'succeeded'
      GROUP BY COALESCE(NULLIF(member_id, ''), user_id)`
  ).all() as Array<{ user_id: string; bonus_points: number | null }>;
  const bonuses = new Map(bonusRows.map((row) => [row.user_id, Number(row.bonus_points ?? 0)]));

  return sources.map((row, index) => ({
    rank: index + 1,
    userId: row.user_id,
    buyerName: row.buyer_name,
    youtubeNickname: row.youtube_nickname,
    tier: row.tier || null,
    totalPurchaseAmount: Number(row.total_purchase_amount ?? 0),
    orderCount: Number(row.order_count ?? 0),
    // 카페24 잔액 스냅샷이 있으면 현재 누적 적립금을 우선 표시합니다.
    // 스냅샷이 없는 기존 회원만 실제 지급·회수 원장 합계를 사용합니다.
    rewardPoints: pointBalancesByMemberId.get(row.user_id)
      ?? rewards.get(row.user_id)
      ?? 0,
    bonusPoints: bonuses.get(row.user_id) ?? 0,
    eligibleForBonus: index < 10 && hasCafe24Order(row.user_id),
  }));
}

let overlayIdentityRefreshAt = 0;
let overlayIdentityRefresh: Promise<void> | null = null;

/** 공개 오버레이는 현재 순위만 조회하되, 누락된 주문 회원 ID는 드물게 보완합니다. */
export async function getOverlayOrderRanking(limit = 3): Promise<OrderRankingRow[]> {
  if (Date.now() - overlayIdentityRefreshAt >= 30_000) {
    if (!overlayIdentityRefresh) {
      overlayIdentityRefreshAt = Date.now();
      overlayIdentityRefresh = hydrateMissingRankingMemberIds().finally(() => {
        overlayIdentityRefresh = null;
      });
    }
    await overlayIdentityRefresh;
  }
  return getOrderRanking(limit);
}

/** 최근 결제 주문의 회원 ID로 카페24의 현재 회원등급을 조회합니다. */
export async function getOrderRankingWithGrades(limit = 10): Promise<OrderRankingRow[]> {
  await hydrateMissingRankingMemberIds();
  const ranking = getOrderRanking(limit);
  if (ranking.length === 0) return ranking;

  const groups = await getCafe24CustomerGroups().catch(() => []);
  const groupNames = new Map(groups.map((group) => [String(group.group_no), group.group_name]));

  return Promise.all(ranking.map(async (row) => {
    const order = findLatestCafe24Order(row.userId);
    if (!order) return { ...row, tier: null };
    const buyer = await getBuyerInfo(order.external_order_id);
    const groupNo = buyer?.memberId ? await getCurrentCustomerGroupNo(buyer.memberId) : null;
    return {
      ...row,
      buyerName: buyer?.name ?? row.buyerName,
      tier: groupNo ? groupNames.get(groupNo) ?? row.tier : row.tier,
    };
  }));
}

/** 이전 웹훅이 생략한 회원 ID도 랭킹을 열 때 카페24 값으로 한 번 보완해 DB에 남깁니다. */
async function hydrateMissingRankingMemberIds() {
  const rows = db.prepare(
    `SELECT external_order_id
       FROM orders
      WHERE source = 'cafe24'
        AND paid_at IS NOT NULL
        AND external_order_id IS NOT NULL
        AND NULLIF(member_id, '') IS NULL`
  ).all() as Array<{ external_order_id: string }>;

  for (let index = 0; index < rows.length; index += 5) {
    await Promise.all(rows.slice(index, index + 5).map(async ({ external_order_id }) => {
      try {
        const buyer = await getCafe24OrderBuyerInfo(external_order_id);
        if (buyer?.memberId) {
          saveCafe24OrderIdentity(external_order_id, {
            memberId: buyer.memberId,
            buyerName: buyer.name,
          });
        }
      } catch {
        // 카페24 일시 조회 실패 주문은 다음 새로고침 때 다시 보완합니다.
      }
    }));
  }
}

function findLatestCafe24Order(userId: string) {
  return db.prepare(
    `SELECT external_order_id
       FROM orders
      WHERE COALESCE(NULLIF(member_id, ''), 'order:' || COALESCE(external_order_id, id)) = ?
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

/** 현재 상위 10위에게 카페24 보너스 적립금을 실제 지급합니다. */
export async function grantRankingBonus(userId: string, amount: number, requestId: string) {
  const normalizedAmount = Number(amount);
  if (!userId || !Number.isSafeInteger(normalizedAmount) || normalizedAmount <= 0 || normalizedAmount > 1_000_000) {
    throw new Error("보너스 적립금은 1원 이상 100만 원 이하의 정수여야 합니다.");
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
    throw new Error("유효하지 않은 지급 요청입니다. 화면을 새로고침하고 다시 시도하세요.");
  }

  assertCafe24BonusExecutionAllowed();

  await hydrateMissingRankingMemberIds();
  const ranking = getOrderRanking(10);
  const rankingRow = ranking.find((row) => row.userId === userId);
  if (!rankingRow || rankingRow.rank > 10) {
    throw new Error("보너스 적립금은 현재 주문 랭킹 1~10위에게만 지급할 수 있습니다.");
  }

  const order = findLatestCafe24Order(userId);
  if (!order) {
    throw new Error("카페24 주문번호가 있는 구매자에게만 보너스 적립금을 지급할 수 있습니다.");
  }

  // 랭킹은 카페24 실제 회원 ID로 묶으므로, 동일 계정 주문만 지급 기준에 포함합니다.
  const orderIds = db.prepare(
    `SELECT external_order_id FROM orders
      WHERE member_id = ? AND source = 'cafe24' AND paid_at IS NOT NULL
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
    await refreshCafe24PointBalanceSnapshot(memberId, userId);
    return { amount: normalizedAmount };
  } catch (error) {
    db.prepare("UPDATE ranking_bonus_ledger SET error_message = ? WHERE id = ?")
      .run(error instanceof Error ? error.message.slice(0, 500) : "카페24 지급 실패", ledgerId);
    throw new Error("카페24 지급 결과가 불확실합니다. 재시도하지 말고 카페24 적립내역과 원장을 대조하세요.");
  }
}
