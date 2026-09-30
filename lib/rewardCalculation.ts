export type RewardOrderItem = {
  payment_amount?: string | number;
  quantity?: string | number;
  order_status?: string;
  status_code?: string;
};

export type RewardAmountOrder = {
  payment_amount?: string | number;
  actual_order_amount?: { order_price_amount?: string | number };
  items?: RewardOrderItem[];
};

const EXCLUDED_ITEM_STATUSES = new Set(["C1", "C2", "C3", "CANCELLED", "RETURNED"]);

export function isExcludedRewardItem(item: RewardOrderItem) {
  return EXCLUDED_ITEM_STATUSES.has(String(item.status_code ?? item.order_status ?? "").toUpperCase());
}

/** Cafe24 품목별 payment_amount는 수량이 이미 반영된 품목 결제금액입니다. */
export function netProductAmount(order: RewardAmountOrder) {
  const items = Array.isArray(order.items) ? order.items : [];
  if (items.length === 0) return null;

  let total = 0;
  let activeItems = 0;
  for (const item of items) {
    if (isExcludedRewardItem(item)) continue;
    const amount = Number(item.payment_amount);
    const quantity = Number(item.quantity ?? 1);
    if (!Number.isFinite(amount) || amount < 0 || !Number.isFinite(quantity) || quantity <= 0) return null;
    total += amount;
    activeItems += 1;
  }
  if (activeItems === 0) return 0;

  const orderTotals = [order.payment_amount, order.actual_order_amount?.order_price_amount]
    .map(Number)
    .filter((value) => Number.isFinite(value) && value >= 0);
  // 품목 합계가 주문 결제 총액보다 커지면 수량 중복 계산이나 원본 불일치로 간주합니다.
  if (orderTotals.length > 0 && total > Math.max(...orderTotals)) return null;
  return Math.floor(total);
}

export function calculateRewardAmount(order: RewardAmountOrder, rate: number) {
  const baseAmount = netProductAmount(order);
  if (baseAmount === null || !Number.isFinite(rate) || rate < 0 || rate > 20) return null;
  return { baseAmount, amount: Math.floor(baseAmount * rate / 100) };
}

type RewardDisplayRow = {
  id: number;
  external_order_id: string;
  action: "issue" | "recover";
  amount: number;
  status: "pending" | "succeeded" | "failed";
};

/** 과지급 정정용 일부 회수는 화면에서 최종 지급액 한 건으로 합칩니다. */
export function collapsePartialRecoveryRows<T extends RewardDisplayRow>(source: T[], limit: number) {
  const rows = source.map((row) => ({ ...row }));
  const byOrder = new Map<string, T[]>();
  for (const row of rows) byOrder.set(row.external_order_id, [...(byOrder.get(row.external_order_id) ?? []), row]);
  const hiddenIds = new Set<number>();
  for (const orderRows of byOrder.values()) {
    const issue = orderRows.find((row) => row.action === "issue" && row.status === "succeeded");
    const recovery = orderRows.find((row) => row.action === "recover" && row.status === "succeeded");
    if (issue && recovery && recovery.amount > 0 && recovery.amount < issue.amount) {
      issue.amount -= recovery.amount;
      hiddenIds.add(recovery.id);
    }
  }
  return rows.filter((row) => !hiddenIds.has(row.id)).slice(0, limit);
}

