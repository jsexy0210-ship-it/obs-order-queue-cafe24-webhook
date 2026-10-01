import {
  getCafe24CurrentCustomerGroupNo,
  getCafe24CustomerGroups,
  getCafe24OrderBuyerInfo,
  getCafe24OrderForReward,
} from "./cafe24Admin";
import { db } from "./db";
import type { LiveState, OrderRow } from "./store";

type BuyerInfo = { name: string | null; memberId: string | null };
const buyers = new Map<string, BuyerInfo>();
const firstOrders = new Map<string, boolean>();
const firstOrderChecks = new Map<string, Promise<boolean>>();
const customerGroups = new Map<string, { groupNo: string | null; expiresAt: number }>();

type OverlayOrderMetrics = { orderCount: number; rankingRank: number | null };

/** 공개 오버레이에서 필요한 주문 횟수·랭킹만 계산합니다. 회원 식별자는 반환하지 않습니다. */
function getOverlayOrderMetrics(order: OrderRow): OverlayOrderMetrics {
  const memberId = order.member_id?.trim();
  if (!memberId || order.source !== "cafe24") return { orderCount: 1, rankingRank: null };

  const count = db.prepare(
    `SELECT COUNT(*) AS count FROM orders
      WHERE source = 'cafe24' AND member_id = ? AND status <> 'cancelled'`
  ).get(memberId) as { count: number };
  const ranking = db.prepare(
    `WITH ranking_source AS (
       SELECT member_id AS user_id,
              SUM(COALESCE(actual_amount, unit_price * quantity)) AS total_purchase_amount,
              COUNT(*) AS order_count
         FROM orders
        WHERE source = 'cafe24' AND paid_at IS NOT NULL AND status <> 'cancelled'
          AND NULLIF(member_id, '') IS NOT NULL
        GROUP BY member_id
     ), ranked AS (
       SELECT user_id,
              ROW_NUMBER() OVER (ORDER BY total_purchase_amount DESC, order_count DESC, user_id ASC) AS rank
         FROM ranking_source
     )
     SELECT rank FROM ranked WHERE user_id = ?`
  ).get(memberId) as { rank: number } | undefined;
  return { orderCount: Number(count.count ?? 1), rankingRank: ranking?.rank ?? null };
}

export async function getBuyerInfo(orderId: string): Promise<BuyerInfo | null> {
  const cached = buyers.get(orderId);
  if (cached) return cached;
  try {
    const buyer = await getCafe24OrderBuyerInfo(orderId);
    if (buyer) buyers.set(orderId, buyer);
    return buyer;
  } catch {
    return null;
  }
}

async function isCafe24FirstOrder(orderId: string) {
  const cached = firstOrders.get(orderId);
  if (cached !== undefined) return cached;
  const pending = firstOrderChecks.get(orderId);
  if (pending) return pending;
  const check = getCafe24OrderForReward(orderId)
    .then((order) => {
      const isFirstOrder = order.first_order === "T";
      firstOrders.set(orderId, isFirstOrder);
      return isFirstOrder;
    })
    .catch(() => false)
    .finally(() => firstOrderChecks.delete(orderId));
  firstOrderChecks.set(orderId, check);
  return check;
}

export async function getCurrentCustomerGroupNo(memberId: string): Promise<string | null> {
  const cached = customerGroups.get(memberId);
  if (cached && cached.expiresAt > Date.now()) return cached.groupNo;
  try {
    const groupNo = await getCafe24CurrentCustomerGroupNo(memberId);
    customerGroups.set(memberId, { groupNo, expiresAt: Date.now() + 60_000 });
    return groupNo;
  } catch {
    return null;
  }
}

export async function resolveOrderBuyerNames<T extends OrderRow>(orders: T[]): Promise<T[]> {
  const ids = Array.from(new Set(orders.flatMap((order) =>
    order.source === "cafe24" && order.external_order_id && !buyers.has(order.external_order_id)
      ? [order.external_order_id]
      : []
  )));
  for (let index = 0; index < ids.length; index += 5) {
    await Promise.all(ids.slice(index, index + 5).map(getBuyerInfo));
  }
  const memberIds = Array.from(new Set(orders.flatMap((order) => {
    const memberId = order.external_order_id && buyers.get(order.external_order_id)?.memberId;
    return order.source === "cafe24" && memberId ? [memberId] : [];
  })));
  for (let index = 0; index < memberIds.length; index += 5) {
    await Promise.all(memberIds.slice(index, index + 5).map(getCurrentCustomerGroupNo));
  }
  const groups = memberIds.length ? await getCafe24CustomerGroups().catch(() => []) : [];
  const groupNames = new Map(groups.map((group) => [String(group.group_no), group.group_name]));
  return orders.map((order) => {
    if (order.source !== "cafe24" || !order.external_order_id) return order;
    const buyer = buyers.get(order.external_order_id);
    const groupNo = buyer?.memberId && customerGroups.get(buyer.memberId)?.groupNo;
    return {
      ...order,
      user_id: buyer?.name ?? (order.user_id.includes("*") ? "구매자 확인 불가" : order.user_id),
      tier: buyer?.memberId ? (groupNo ? groupNames.get(groupNo) ?? "" : "") : order.tier,
    };
  });
}

export async function resolveLiveBuyerNames(state: LiveState): Promise<LiveState> {
  const orders = await resolveOrderBuyerNames([
    ...(state.completed ? [state.completed] : []),
    ...(state.opening ? [state.opening] : []),
    ...state.waiting,
    ...state.pendingPayments,
    ...state.cancelledOrders,
  ]);
  const firstOrderFlags = await Promise.all(orders.map((order) =>
    order.source === "cafe24" && order.external_order_id
      ? isCafe24FirstOrder(order.external_order_id)
      : Promise.resolve(false)
  ));
  const ordersWithFirstOrder = orders.map((order, index) => {
    const metrics = getOverlayOrderMetrics(order);
    return {
      ...order,
      is_first_order: firstOrderFlags[index],
      order_count: metrics.orderCount,
      ranking_rank: metrics.rankingRank,
    };
  });
  let offset = 0;
  const completed = state.completed ? ordersWithFirstOrder[offset++] : null;
  const opening = state.opening ? ordersWithFirstOrder[offset++] : null;
  const waiting = ordersWithFirstOrder.slice(offset, offset + state.waiting.length);
  offset += state.waiting.length;
  const pendingPayments = ordersWithFirstOrder.slice(offset, offset + state.pendingPayments.length);
  offset += state.pendingPayments.length;
  return {
    ...state,
    completed,
    opening,
    waiting,
    pendingPayments,
    cancelledOrders: ordersWithFirstOrder.slice(offset),
  };
}
