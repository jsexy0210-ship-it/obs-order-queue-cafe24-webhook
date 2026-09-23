import { NextRequest, NextResponse } from "next/server";
import { getLiveState, insertOrder } from "@/lib/store";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(getLiveState());
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

  insertOrder({
    source: "manual",
    userId: String(body.userId),
    product: String(body.product),
    quantity: Number(body.quantity),
    unitPrice: body.unitPrice ? Number(body.unitPrice) : 15000,
    tier: body.tier ? String(body.tier) : "",
    youtubeNickname: body.youtubeNickname ? String(body.youtubeNickname) : null,
  });

  return NextResponse.json({ ok: true });
}
