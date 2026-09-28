/** 주문과 결제 모두 운영 시작 시각 이후인지 카페24 원본 시각으로 확인합니다. */
export function isAfterRewardStart(order: { order_date?: string | null; payment_date?: string | null }) {
  const start = Date.parse(process.env.CAFE24_REWARD_START_AT ?? "");
  const ordered = Date.parse(order.order_date ?? "");
  const paid = Date.parse(order.payment_date ?? "");
  return Number.isFinite(start) && Number.isFinite(ordered) && Number.isFinite(paid)
    && ordered >= start && paid >= start;
}
