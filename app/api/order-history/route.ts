import { NextResponse } from "next/server";
import {
  getHitCardHistory,
  getOrderHistory,
  getOrderHistoryYears,
  resetAllHistory,
} from "@/lib/store";
import { getDashboardRewardEntries, getRewardSummaries } from "@/lib/rewardService";
import { resolveOrderBuyerNames } from "@/lib/buyerNames";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const range = searchParams.get("range");
  if (range === "dashboard") {
    const kstYear = new Date(Date.now() + 9 * 60 * 60 * 1000).getUTCFullYear();
    const dashboardStartUtc = new Date(Date.UTC(kstYear, 0, 1) - (6 * 24 + 9) * 60 * 60 * 1000)
      .toISOString().slice(0, 19).replace("T", " ");
    return NextResponse.json({
      orders: getOrderHistory()
        .filter((order) => order.created_at >= dashboardStartUtc)
        .map(({ created_at, quantity, unit_price, payment_method }) => ({
          created_at, quantity, unit_price, payment_method,
        })),
      rewardEntries: getDashboardRewardEntries(dashboardStartUtc),
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
  const orders = range === "recent3months"
    ? getOrderHistory().filter((order) => {
      const createdAt = new Date(`${order.created_at.replace(" ", "T")}Z`).getTime();
      return Number.isFinite(createdAt) && createdAt >= Date.now() - 90 * 24 * 60 * 60 * 1000;
    })
    : getOrderHistory(hasMonthFilter ? { year, month } : undefined);

  return NextResponse.json({
    orders: await resolveOrderBuyerNames(orders),
    availableYears: getOrderHistoryYears(),
    hitCards: getHitCardHistory(30),
    rewardSummaries: getRewardSummaries(
      orders.flatMap((order) => order.external_order_id ? [order.external_order_id] : [])
    ),
  });
}

// 이력 전체 초기화 (주문 + 히트카드). 되돌릴 수 없습니다.
export async function DELETE() {
  resetAllHistory();
  return NextResponse.json({ ok: true });
}
