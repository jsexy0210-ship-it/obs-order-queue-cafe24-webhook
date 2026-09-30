import { NextResponse } from "next/server";
import { resolveLiveBuyerNames } from "@/lib/buyerNames";
import { sanitizeLiveOverlayState } from "@/lib/liveOverlayPrivacy";
import { getLiveState } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(sanitizeLiveOverlayState(await resolveLiveBuyerNames(getLiveState())), {
    headers: { "Cache-Control": "no-store" },
  });
}
