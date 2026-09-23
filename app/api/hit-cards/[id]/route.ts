import { NextRequest, NextResponse } from "next/server";
import { deleteHitCard } from "@/lib/store";

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
