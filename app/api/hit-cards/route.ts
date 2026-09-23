import { NextRequest, NextResponse } from "next/server";
import { addHitCard } from "@/lib/store";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);

  if (!body?.userId || !body?.card) {
    return NextResponse.json({ error: "userId, card는 필수입니다." }, { status: 400 });
  }

  addHitCard(
    String(body.userId),
    String(body.card),
    body.youtubeNickname ? String(body.youtubeNickname) : null
  );
  return NextResponse.json({ ok: true });
}
