import { NextResponse } from "next/server";
import { getOrderRankingWithGrades } from "@/lib/orderRanking";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 공개 오버레이에는 실명·회원 식별자·결제 정보가 절대 포함되지 않습니다. */
export async function GET() {
  const ranking = await getOrderRankingWithGrades();
  return NextResponse.json({
    ranking: ranking.slice(0, 3).map((row) => ({
      rank: row.rank,
      youtubeNickname: row.youtubeNickname ?? null,
      orderCount: row.orderCount,
    })),
  }, { headers: { "Cache-Control": "no-store" } });
}
