import { getCafe24OrderBuyerName } from "./cafe24Admin";
import type { LiveState, OrderRow } from "./store";

const buyerNames = new Map<string, string>();

export async function getBuyerName(orderId: string): Promise<string | null> {
  const cached = buyerNames.get(orderId);
  if (cached) return cached;
  try {
    const name = await getCafe24OrderBuyerName(orderId);
    if (name) buyerNames.set(orderId, name);
    return name;
  } catch {
    return null;
  }
}

export async function resolveOrderBuyerNames<T extends OrderRow>(orders: T[]): Promise<T[]> {
  const ids = Array.from(new Set(orders.flatMap((order) =>
    order.source === "cafe24" && order.external_order_id && !buyerNames.has(order.external_order_id)
      ? [order.external_order_id]
      : []
  )));
  for (let index = 0; index < ids.length; index += 5) {
    await Promise.all(ids.slice(index, index + 5).map(getBuyerName));
  }
  return orders.map((order) => {
    if (order.source !== "cafe24" || !order.external_order_id) return order;
    const name = buyerNames.get(order.external_order_id);
    return { ...order, user_id: name ?? (order.user_id.includes("*") ? "구매자 확인 불가" : order.user_id) };
  });
}

export async function resolveLiveBuyerNames(state: LiveState): Promise<LiveState> {
  const orders = await resolveOrderBuyerNames([
    ...(state.opening ? [state.opening] : []),
    ...state.waiting,
  ]);
  return {
    ...state,
    opening: state.opening ? orders[0] : null,
    waiting: state.opening ? orders.slice(1) : orders,
  };
}
