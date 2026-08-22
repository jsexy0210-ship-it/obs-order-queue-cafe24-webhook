import { NextRequest, NextResponse } from "next/server";
import { completeOpening, deleteOrder, setOpening } from "@/lib/store";

export const runtime = "nodejs";

type RouteParams = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const { id: idParam } = await params;
  const id = Number(idParam);

  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));

  if (body.status === "opening") {
    const timerSeconds = body.timerSeconds ? Number(body.timerSeconds) : 60;
    setOpening(id, timerSeconds);
  } else if (body.status === "done") {
    completeOpening(id);
  } else {
    return NextResponse.json(
      { error: "status는 'opening' 또는 'done' 이어야 합니다." },
      { status: 400 }
    );
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const { id: idParam } = await params;
  const id = Number(idParam);

  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  deleteOrder(id);
  return NextResponse.json({ ok: true });
}
