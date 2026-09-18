import { NextResponse } from "next/server";
import { getHitCardHistory, getOrderHistory, resetAllHistory } from "@/lib/store";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    orders: getOrderHistory(),
    hitCards: getHitCardHistory(30),
  });
}

// 이력 전체 초기화 (주문 + 히트카드). 되돌릴 수 없습니다.
export async function DELETE() {
  resetAllHistory();
  return NextResponse.json({ ok: true });
}
