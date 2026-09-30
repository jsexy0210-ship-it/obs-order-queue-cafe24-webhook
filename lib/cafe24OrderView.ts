import { getCafe24OrderForReward, listCafe24Orders, type Cafe24RewardOrder } from "./cafe24Admin";
import { extractCafe24YoutubeNickname } from "./cafe24";
import type { OrderRow } from "./store";

export type CurrentOrder = OrderRow & { actual_amount: number; remote_only?: true };

const CACHE_MS = 60_000;
const quarters = new Map<string, { expiresAt: number; orders: Cafe24RewardOrder[] }>();
const pending = new Map<string, Promise<Cafe24RewardOrder[]>>();
const details = new Map<string, Cafe24RewardOrder>();

function dateString(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

async function getQuarter(year: number, firstMonth: number) {
  const todayKst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const currentYear = todayKst.getUTCFullYear();
  const currentMonth = todayKst.getUTCMonth() + 1;
  if (year > currentYear || (year === currentYear && firstMonth > currentMonth)) return [];
  const lastMonth = Math.min(firstMonth + 2, year === currentYear ? currentMonth : 12);
  const lastDay = year === currentYear && lastMonth === currentMonth
    ? todayKst.getUTCDate()
    : new Date(Date.UTC(year, lastMonth, 0)).getUTCDate();
  const key = `${year}-${firstMonth}`;
  const cached = quarters.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.orders;
  const ongoing = pending.get(key);
  if (ongoing) return ongoing;
  const request = listCafe24Orders(
    dateString(year, firstMonth, 1), dateString(year, lastMonth, lastDay)
  ).then((orders) => {
    quarters.set(key, { orders, expiresAt: Date.now() + CACHE_MS });
    return orders;
  }).finally(() => pending.delete(key));
  pending.set(key, request);
  return request;
}

export async function getCafe24OrdersForMonths(year: number, months: number[]) {
  const firstMonths = Array.from(new Set(months.map((month) => Math.floor((month - 1) / 3) * 3 + 1)));
  const pages = await Promise.all(firstMonths.map((month) => getQuarter(year, month)));
  const wanted = new Set(months);
  return pages.flat().filter((order) => {
    const date = order.order_date ? new Date(order.order_date) : null;
    if (!date || Number.isNaN(date.getTime())) return false;
    const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
    return kst.getUTCFullYear() === year && wanted.has(kst.getUTCMonth() + 1);
  });
}

function sqliteUtc(value: string | null | undefined, fallback: string | null) {
  const time = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(time) ? new Date(time).toISOString().slice(0, 19).replace("T", " ") : fallback;
}

function actualAmount(order: Cafe24RewardOrder, localAmount: number) {
  if (order.canceled === "T") return 0;
  const raw = order.paid === "T" ? order.payment_amount
    : order.actual_order_amount?.order_price_amount ?? order.initial_order_amount?.payment_amount;
  const amount = Number(raw);
  return Number.isFinite(amount) && amount >= 0 ? Math.round(amount) : localAmount;
}

function localActualAmount(order: OrderRow) {
  return order.actual_amount ?? order.unit_price * order.quantity;
}

function paymentMethod(order: Cafe24RewardOrder, fallback: string | null) {
  if (Array.isArray(order.payment_method)) return order.payment_method.join(",");
  return order.payment_method || fallback;
}

async function getDetail(orderId: string) {
  const cached = details.get(orderId);
  if (cached) return cached;
  const detail = await getCafe24OrderForReward(orderId);
  details.set(orderId, detail);
  return detail;
}

/** 원본 주문 DB는 유지하고, 화면·집계에 쓰는 주문 정보를 카페24 현재값으로 합칩니다. */
export async function currentOrderView(
  localOrders: OrderRow[],
  cafe24Orders: Cafe24RewardOrder[],
  hiddenOrderIds: ReadonlySet<string> = new Set()
): Promise<CurrentOrder[]> {
  const visibleLocalOrders = localOrders.filter((order) =>
    !order.external_order_id || !hiddenOrderIds.has(order.external_order_id)
  );
  const localById = new Map(visibleLocalOrders.flatMap((order) =>
    order.source === "cafe24" && order.external_order_id ? [[order.external_order_id, order] as const] : []
  ));
  const remoteById = new Map(cafe24Orders.flatMap((order) => order.order_id ? [[order.order_id, order] as const] : []));
  const detailIds = cafe24Orders.filter((order) => {
    if (!order.order_id) return false;
    const local = localById.get(order.order_id);
    return !local || Number(order.actual_order_amount?.order_price_amount) !== local.unit_price * local.quantity;
  }).map((order) => order.order_id!);
  for (let index = 0; index < detailIds.length; index += 5) {
    await Promise.all(detailIds.slice(index, index + 5).map((id) => getDetail(id).catch(() => null)));
  }

  const current = visibleLocalOrders.map((order): CurrentOrder => {
    const remote = order.external_order_id ? remoteById.get(order.external_order_id) : undefined;
    if (!remote || order.source !== "cafe24") {
      return { ...order, actual_amount: order.status === "cancelled" ? 0 : localActualAmount(order) };
    }
    const remoteDetail = details.get(remote.order_id!) ?? remote;
    const items = remoteDetail.items;
    const productNames = items?.map((item) => item.product_name).filter((name): name is string => Boolean(name));
    return {
      ...order,
      youtube_nickname: order.youtube_nickname || extractCafe24YoutubeNickname(remoteDetail.additional_order_info_list),
      user_id: remote.billing_name || order.user_id,
      product: productNames?.length ? productNames.join(" · ") : order.product,
      quantity: items?.length ? items.reduce((total, item) => total + Number(item.quantity || 0), 0) : order.quantity,
      created_at: sqliteUtc(remote.order_date, order.created_at)!,
      paid_at: remote.paid === "T" ? sqliteUtc(remote.payment_date, order.paid_at) : null,
      payment_method: paymentMethod(remote, order.payment_method),
      status: remote.canceled === "T" ? "cancelled"
        : order.status === "cancelled" ? (order.prev_status === "done" ? "done" : "waiting") : order.status,
      cancel_reason: remote.canceled === "T" ? order.cancel_reason ?? "cancelled" : null,
      cancelled_at: remote.canceled === "T" ? sqliteUtc(remote.cancel_date, order.cancelled_at) : null,
      actual_amount: actualAmount(remote, localActualAmount(order)),
    };
  });

  for (const remote of cafe24Orders) {
    if (!remote.order_id || hiddenOrderIds.has(remote.order_id) || localById.has(remote.order_id)) continue;
    const remoteDetail = details.get(remote.order_id) ?? remote;
    const items = remoteDetail.items ?? [];
    current.push({
      id: -current.length - 1,
      source: "cafe24",
      external_order_id: remote.order_id,
      user_id: remote.billing_name || "구매자 확인 불가",
      product: items.map((item) => item.product_name).filter(Boolean).join(" · ") || "카페24 주문",
      quantity: items.reduce((total, item) => total + Number(item.quantity || 0), 0) || 1,
      unit_price: 0,
      tier: "",
      status: remote.canceled === "T" ? "cancelled" : "waiting",
      prev_status: null,
      cancel_reason: remote.canceled === "T" ? "cancelled" : null,
      cancelled_at: sqliteUtc(remote.cancel_date, null),
      started_at: null,
      completed_at: null,
      paid_at: remote.paid === "T" ? sqliteUtc(remote.payment_date, null) : null,
      payment_method: paymentMethod(remote, null),
      payment_gateway_name: null,
      easypay_name: null,
      youtube_nickname: extractCafe24YoutubeNickname(remoteDetail.additional_order_info_list),
      timer_seconds: null,
      created_at: sqliteUtc(remote.order_date, new Date().toISOString().slice(0, 19).replace("T", " "))!,
      actual_amount: actualAmount(remote, 0),
      remote_only: true,
    });
  }
  return current.sort((a, b) => b.created_at.localeCompare(a.created_at));
}
