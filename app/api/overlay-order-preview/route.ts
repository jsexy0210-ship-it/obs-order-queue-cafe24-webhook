import { NextResponse } from "next/server";
import { resolveLiveBuyerNames } from "@/lib/buyerNames";
import { sanitizeLiveOverlayState } from "@/lib/liveOverlayPrivacy";
import { getOrderHistory, getOverlaySettings } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 관리자 미리보기용 최신 실제 주문입니다.
 * 공개 오버레이와 같은 개인정보 제거 단계를 거친 뒤 닉네임·상품·썸네일만 반환합니다.
 */
export async function GET() {
  const latestOrder = getOrderHistory().find((order) => order.status !== "cancelled") ?? null;
  if (!latestOrder) return NextResponse.json({ order: null }, { headers: { "Cache-Control": "no-store" } });

  const enriched = await resolveLiveBuyerNames({
    opening: latestOrder,
    completed: null,
    waiting: [],
    pendingPayments: [],
    cancelledOrders: [],
    hitCards: [],
    overlaySettings: getOverlaySettings(),
  });
  const safe = sanitizeLiveOverlayState(enriched);
  return NextResponse.json({ order: safe.opening }, { headers: { "Cache-Control": "no-store" } });
}
