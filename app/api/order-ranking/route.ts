import { NextRequest, NextResponse } from "next/server";
import { getOrderRankingWithGrades, grantRankingBonus } from "@/lib/orderRanking";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ ranking: await getOrderRankingWithGrades() });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as { userId?: unknown; amount?: unknown; requestId?: unknown } | null;
  const userId = typeof body?.userId === "string" ? body.userId.trim() : "";
  const amount = Number(body?.amount);
  const requestId = typeof body?.requestId === "string" ? body.requestId : "";
  try {
    const result = await grantRankingBonus(userId, amount, requestId);
    return NextResponse.json({ ok: true, result, ranking: await getOrderRankingWithGrades() });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "보너스 적립금 지급에 실패했습니다." },
      { status: 400 }
    );
  }
}
