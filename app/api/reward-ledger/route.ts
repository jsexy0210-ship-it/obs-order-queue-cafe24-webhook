import { NextRequest, NextResponse } from "next/server";
import { listRewardLedger, recoverRewardForOrder } from "@/lib/rewardService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ rows: listRewardLedger() });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null) as { orderId?: unknown } | null;
  const orderId = typeof body?.orderId === "string" ? body.orderId.trim() : "";
  if (!orderId) return NextResponse.json({ error: "주문번호가 필요합니다." }, { status: 400 });
  try {
    const result = await recoverRewardForOrder(orderId, "manual");
    return NextResponse.json({ result, rows: listRewardLedger() });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "적립금 회수에 실패했습니다.", rows: listRewardLedger() },
      { status: 502 }
    );
  }
}
