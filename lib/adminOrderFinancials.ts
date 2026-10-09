import { db } from "./db";
import { getCafe24OrdersForMonths, pointsSpentAmount } from "./cafe24OrderView";
import type { OrderRow } from "./store";

export type AdminOrderFinancials = {
  points_spent_amount: number | null;
  final_payment_amount: number | null;
  include_revenue: boolean;
};
type ManualFinancials = { order_id: number; points_spent_amount: number; final_payment_amount: number; include_revenue: number };

export function saveManualOrderFinancials(orderId: number, pointsSpent: number, finalPayment: number, includeRevenue: boolean) {
  // 직접입력 요청 때만 추가합니다. 조회·배포로 기존 주문 DB를 변경하지 않습니다.
  db.exec(`CREATE TABLE IF NOT EXISTS manual_order_financials (
    order_id INTEGER PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
    points_spent_amount INTEGER NOT NULL CHECK (points_spent_amount >= 0),
    final_payment_amount INTEGER NOT NULL CHECK (final_payment_amount >= 0),
    include_revenue INTEGER NOT NULL CHECK (include_revenue IN (0, 1))
  )`);
  db.prepare("INSERT INTO manual_order_financials VALUES (?, ?, ?, ?)")
    .run(orderId, pointsSpent, finalPayment, includeRevenue ? 1 : 0);
}

export function applyManualOrderFinancials<T extends OrderRow & { points_spent_amount?: number | null }>(orders: T[]): Array<T & AdminOrderFinancials> {
  const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'manual_order_financials'").get();
  const manual = new Map((exists ? db.prepare("SELECT * FROM manual_order_financials").all() as ManualFinancials[] : [])
    .map((row) => [row.order_id, row]));
  return orders.map((order) => {
    const saved = order.source === "manual" ? manual.get(order.id) : undefined;
    const points = saved?.points_spent_amount ?? (order.source === "manual" ? 0 : order.points_spent_amount ?? null);
    const amount = order.actual_amount ?? order.unit_price * order.quantity;
    return { ...order, points_spent_amount: points,
      final_payment_amount: saved?.final_payment_amount ?? (points == null ? null : amount - points),
      include_revenue: order.source !== "manual" || saved?.include_revenue === 1 };
  });
}

export async function resolveAdminOrderFinancials(orders: OrderRow[]) {
  const months = new Map<string, { year: number; month: number }>();
  for (const order of orders) {
    if (order.source !== "cafe24" || !order.external_order_id) continue;
    const date = new Date(order.created_at.replace(" ", "T") + "Z");
    if (!Number.isFinite(date.getTime())) continue;
    const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
    const year = kst.getUTCFullYear(), month = kst.getUTCMonth() + 1;
    months.set(year + "-" + month, { year, month });
  }
  const pages = await Promise.all([...months.values()].map(({ year, month }) =>
    getCafe24OrdersForMonths(year, [month]).catch(() => [])));
  const remote = new Map(pages.flat().map((order) => [order.order_id, order]));
  return applyManualOrderFinancials(orders.map((order) => ({ ...order,
    points_spent_amount: order.external_order_id && remote.has(order.external_order_id)
      ? pointsSpentAmount(remote.get(order.external_order_id)!) : null,
  })));
}
