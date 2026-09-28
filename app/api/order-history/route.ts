import { NextResponse } from "next/server";
import {
  getHitCardHistory,
  getOrderHistory,
  getOrderHistoryYears,
  resetAllHistory,
} from "@/lib/store";
import { getDashboardRewardEntries, getRewardSummaries } from "@/lib/rewardService";
import { resolveOrderBuyerNames } from "@/lib/buyerNames";
import { currentOrderView, getCafe24OrdersForMonths } from "@/lib/cafe24OrderView";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const range = searchParams.get("range");
  if (range === "dashboard") {
    const nowKst = new Date(Date.now() + 9 * 60 * 60 * 1000);
    const kstYear = nowKst.getUTCFullYear();
    const dashboardStartUtc = new Date(Date.UTC(kstYear, 0, 1) - (6 * 24 + 9) * 60 * 60 * 1000)
      .toISOString().slice(0, 19).replace("T", " ");
    let cafe24Orders = [] as Awaited<ReturnType<typeof getCafe24OrdersForMonths>>;
    let syncError = false;
    try {
      cafe24Orders = await getCafe24OrdersForMonths(
        kstYear, Array.from({ length: nowKst.getUTCMonth() + 1 }, (_, index) => index + 1)
      );
    } catch {
      syncError = true;
    }
    const current = await currentOrderView(getOrderHistory(), cafe24Orders);
    const statuses = new Map(current.flatMap((order) => order.external_order_id
      ? [[order.external_order_id, order.status] as const] : []));
    return NextResponse.json({
      orders: current.filter((order) => order.created_at >= dashboardStartUtc)
        .map(({ created_at, payment_method, paid_at, status, actual_amount }) => ({
          created_at, payment_method, paid_at, status, actual_amount,
        })),
      rewardEntries: getDashboardRewardEntries(dashboardStartUtc)
        .filter((entry) => statuses.get(entry.external_order_id) !== "cancelled")
        .map((entry) => ({
          amount: entry.action === "recover" ? -entry.amount : entry.amount,
          grade_id: entry.grade_id, processed_at: entry.processed_at,
        })),
      syncError,
    });
  }
  const year = Number(searchParams.get("year"));
  const month = Number(searchParams.get("month"));
  const hasMonthFilter = Number.isInteger(year)
    && year >= 2000
    && year <= 9999
    && Number.isInteger(month)
    && month >= 1
    && month <= 12;

  // 대시보드는 기존처럼 최근 3개월 지표만 계산하고, 주문 이력 화면은
  // 선택한 연/월의 누적 보관 데이터를 받아옵니다.
  const localOrders = range === "recent3months"
    ? getOrderHistory().filter((order) => {
      const createdAt = new Date(`${order.created_at.replace(" ", "T")}Z`).getTime();
      return Number.isFinite(createdAt) && createdAt >= Date.now() - 90 * 24 * 60 * 60 * 1000;
    })
    : getOrderHistory(hasMonthFilter ? { year, month } : undefined);

  let orders = localOrders.map((order) => ({
    ...order, actual_amount: order.status === "cancelled" ? 0 : (order.actual_amount ?? order.unit_price * order.quantity),
  }));
  let syncError = false;
  if (hasMonthFilter) {
    try {
      const cafe24Orders = await getCafe24OrdersForMonths(year, [month]);
      const merged = await currentOrderView(getOrderHistory(), cafe24Orders);
      const startUtc = Date.UTC(year, month - 1, 1) - 9 * 60 * 60 * 1000;
      const endUtc = Date.UTC(year, month, 1) - 9 * 60 * 60 * 1000;
      orders = merged.filter((order) => {
        const time = new Date(`${order.created_at.replace(" ", "T")}Z`).getTime();
        return time >= startUtc && time < endUtc;
      });
    } catch {
      syncError = true;
    }
  }

  return NextResponse.json({
    orders: await resolveOrderBuyerNames(orders),
    availableYears: getOrderHistoryYears(),
    hitCards: getHitCardHistory(30),
    rewardSummaries: getRewardSummaries(
      orders.flatMap((order) => order.external_order_id ? [order.external_order_id] : [])
    ),
    syncError,
  });
}

// 이력 전체 초기화 (주문 + 히트카드). 되돌릴 수 없습니다.
export async function DELETE() {
  resetAllHistory();
  return NextResponse.json({ ok: true });
}
