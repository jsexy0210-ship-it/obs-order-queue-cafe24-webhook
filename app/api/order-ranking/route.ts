import { NextRequest, NextResponse } from "next/server";
import { getOrderRanking, getOrderRankingExecutionMode, grantRankingBonus } from "@/lib/orderRanking";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ ranking: getOrderRanking(), executionMode: getOrderRankingExecutionMode() });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as { userId?: unknown; amount?: unknown } | null;
  const userId = typeof body?.userId === "string" ? body.userId.trim() : "";
  const amount = Number(body?.amount);
  try {
    const result = await grantRankingBonus(userId, amount);
    return NextResponse.json({ ok: true, result, ranking: getOrderRanking(), executionMode: getOrderRankingExecutionMode() });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "보너스 적립금 지급에 실패했습니다." },
      { status: 400 }
    );
  }
}
