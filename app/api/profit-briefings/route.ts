import { NextResponse } from "next/server";
import { listProfitBriefings } from "@/lib/profitBriefings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    briefings: listProfitBriefings(),
    timezone: "Asia/Seoul",
    marginRate: 0.25,
    schedules: {
      daily: "매일 09:00",
      weekly: "매주 월요일 09:10",
      monthly: "매월 마지막 날 09:00",
    },
  });
}
