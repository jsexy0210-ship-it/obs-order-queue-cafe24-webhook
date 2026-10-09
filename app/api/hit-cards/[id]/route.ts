import { NextRequest, NextResponse } from "next/server";
import { deleteHitCard, updateHitCard } from "@/lib/store";

export const runtime = "nodejs";

type RouteParams = { params: Promise<{ id: string }> };

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const { id: idParam } = await params;
  const id = Number(idParam);

  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  deleteHitCard(id);
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const { id: idParam } = await params;
  const id = Number(idParam);
  if (!Number.isSafeInteger(id) || id <= 0) {
    return NextResponse.json({ error: "유효하지 않은 카드입니다." }, { status: 400 });
  }
  const body = await req.json().catch(() => null);
  if (typeof body?.card !== "string" || !body.card.trim() || (body.youtubeNickname !== undefined && typeof body.youtubeNickname !== "string")) {
    return NextResponse.json({ error: "카드명과 닉네임을 확인하세요." }, { status: 400 });
  }
  if (!updateHitCard(id, body.card.trim(), body.youtubeNickname?.trim() || null)) {
    return NextResponse.json({ error: "수정할 카드가 없습니다." }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
