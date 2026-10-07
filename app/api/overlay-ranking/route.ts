import { NextResponse } from "next/server";
import { getOverlayOrderRanking } from "@/lib/orderRanking";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 공개 오버레이에는 실명·회원 식별자·결제 정보가 절대 포함되지 않습니다. */
export async function GET(request: Request) {
  const requestedLimit = Number(new URL(request.url).searchParams.get("limit"));
  const limit = requestedLimit === 10 ? 10 : requestedLimit === 9 ? 9 : 3;
  const ranking = await getOverlayOrderRanking(limit);
  return NextResponse.json({
    ranking: ranking.map((row) => ({
      rank: row.rank,
      youtubeNickname: row.youtubeNickname ?? null,
      orderCount: row.orderCount,
    })),
  }, { headers: { "Cache-Control": "no-store" } });
}
