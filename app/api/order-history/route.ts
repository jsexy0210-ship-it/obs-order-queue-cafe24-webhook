import { NextResponse } from "next/server";
import {
  getHitCardHistory,
  getHiddenOrderHistoryIds,
  getOrderHistory,
  getOrderHistoryYears,
  resetAllHistory,
} from "@/lib/store";
import {
  getDashboardCumulativeRewardBalance,
  getDashboardRewardEntries,
  getDashboardLegacyRewardBalanceByGrade,
  getRewardSummaries,
} from "@/lib/rewardService";
import { getRewardSettings } from "@/lib/rewardStore";
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
    // 대시보드도 주문 이력과 같은 숨김 주문 기준으로 집계합니다.
    const hiddenOrderIds = getHiddenOrderHistoryIds();
    const current = await currentOrderView(getOrderHistory(), cafe24Orders, hiddenOrderIds);
    const orderDates = new Map(current.flatMap((order) => order.external_order_id
      ? [[order.external_order_id, order.created_at] as const] : []));
    const cumulativeReward = getDashboardCumulativeRewardBalance();
    const legacyRewardBalanceByGrade = await getDashboardLegacyRewardBalanceByGrade();
    return NextResponse.json({
      orders: current.filter((order) => order.created_at >= dashboardStartUtc)
        .map(({ created_at, payment_method, paid_at, status, actual_amount, points_spent_amount }) => ({
          created_at, payment_method, paid_at, status, actual_amount, points_spent_amount,
        })),
      rewardEntries: getDashboardRewardEntries()
        .filter((entry) => !hiddenOrderIds.has(entry.external_order_id))
        .map((entry) => ({
          amount: entry.action === "recover" ? -entry.amount : entry.amount,
          grade_id: entry.grade_id,
          payment_kind: entry.payment_kind,
          order_created_at: orderDates.get(entry.external_order_id) ?? entry.order_created_at,
        })),
      cumulativeRewardBalance: cumulativeReward.amount,
      cumulativeRewardSource: cumulativeReward.source,
      legacyRewardBalanceByGrade: legacyRewardBalanceByGrade.amounts,
      legacyRewardBalanceUnassignedMemberCount: legacyRewardBalanceByGrade.unassignedMemberCount,
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
    ...order, points_spent_amount: order.source === "cafe24" ? null as number | null : 0, actual_amount: order.status === "cancelled" ? 0 : (order.actual_amount ?? order.unit_price * order.quantity),
  }));
  let syncError = false;
  if (hasMonthFilter) {
    try {
      const cafe24Orders = await getCafe24OrdersForMonths(year, [month]);
      const merged = await currentOrderView(getOrderHistory(), cafe24Orders, getHiddenOrderHistoryIds());
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

  const rewardSummaries = getRewardSummaries(
    orders.flatMap((order) => order.external_order_id ? [order.external_order_id] : [])
  );
  const gradeNames = new Map<string, string>(getRewardSettings().grades.map((grade) => [grade.id, grade.name]));
  const resolvedOrders = (await resolveOrderBuyerNames(orders)).map((order) => {
    const issuedGradeId = order.external_order_id ? rewardSummaries[order.external_order_id]?.issue?.grade_id : undefined;
    // 과거 주문은 현재 회원등급이 아니라, 실제 적립금을 산정한 당시 원장 등급을 표시합니다.
    return issuedGradeId ? { ...order, tier: gradeNames.get(issuedGradeId) ?? order.tier } : order;
  });

  return NextResponse.json({
    orders: resolvedOrders,
    availableYears: getOrderHistoryYears(),
    hitCards: getHitCardHistory(30),
    rewardSummaries,
    syncError,
  });
}

// 이력 전체 초기화 (주문 + 히트카드). 되돌릴 수 없습니다.
export async function DELETE() {
  resetAllHistory();
  return NextResponse.json({ ok: true });
}
