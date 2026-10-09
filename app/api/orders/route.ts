import { db } from "@/lib/db";
import { resolveAdminOrderFinancials, saveManualOrderFinancials } from "@/lib/adminOrderFinancials";
import { NextRequest, NextResponse } from "next/server";
import { getLiveState, getManualOrderHistory, getTodayCompletedOrders, insertOrder } from "@/lib/store";
import { resolveLiveBuyerNames, resolveOrderBuyerNames } from "@/lib/buyerNames";
import { getRewardSummaries } from "@/lib/rewardService";

export const runtime = "nodejs";

export async function GET() {
  const [state, completedToday, manualOrders] = await Promise.all([
    resolveLiveBuyerNames(getLiveState()),
    resolveOrderBuyerNames(getTodayCompletedOrders()),
    resolveOrderBuyerNames(getManualOrderHistory()),
  ]);
  const rewardSummaries = getRewardSummaries(
    [...state.pendingPayments, ...state.waiting].flatMap((order) => order.external_order_id ? [order.external_order_id] : [])
  );
  const rows = await resolveAdminOrderFinancials([...(state.opening ? [state.opening] : []), ...state.waiting, ...manualOrders]);
  const financials = new Map(rows.map((order) => [order.id, order]));
  return NextResponse.json({ ...state,
    opening: state.opening ? financials.get(state.opening.id) ?? state.opening : null,
    waiting: state.waiting.map((order) => financials.get(order.id) ?? order),
    completedToday, manualOrders: manualOrders.map((order) => financials.get(order.id) ?? order), rewardSummaries });
}

// 관리자 화면에서 주문을 수동으로 추가할 때 사용 (카페24 웹훅 없이도 테스트 가능)
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);

  if (!body?.userId || !body?.product || !body?.quantity) {
    return NextResponse.json(
      { error: "userId, product, quantity는 필수입니다." },
      { status: 400 }
    );
  }

  const quantity = Number(body.quantity);
  const unitPrice = Number(body.unitPrice ?? 15000);
  const pointsSpent = Number(body.pointsSpentAmount ?? 0);
  const finalPayment = body.finalPaymentAmount == null || body.finalPaymentAmount === ""
    ? unitPrice * quantity - pointsSpent : Number(body.finalPaymentAmount);
  if (!Number.isSafeInteger(quantity) || quantity < 1 ||
      ![unitPrice, pointsSpent, finalPayment, pointsSpent + finalPayment].every((value) => Number.isSafeInteger(value) && value >= 0) ||
      (body.includeRevenue != null && typeof body.includeRevenue !== "boolean")) {
    return NextResponse.json({ error: "수량은 1 이상, 금액은 0 이상의 정수로 입력하세요." }, { status: 400 });
  }
  db.transaction(() => {
    const orderId = insertOrder({
      source: "manual",
      userId: String(body.userId),
      product: String(body.product),
      quantity,
      unitPrice,
      actualAmount: pointsSpent + finalPayment,
      tier: body.tier ? String(body.tier) : "",
      youtubeNickname: body.youtubeNickname ? String(body.youtubeNickname) : null,
    });

    if (!orderId) throw new Error("주문 저장에 실패했습니다.");
    saveManualOrderFinancials(orderId, pointsSpent, finalPayment, body.includeRevenue === true);
  })();
  return NextResponse.json({ ok: true });
}
