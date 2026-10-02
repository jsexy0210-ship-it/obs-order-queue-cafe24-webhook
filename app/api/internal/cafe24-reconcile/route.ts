import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { reconcileCafe24Orders } from "@/lib/cafe24Reconciliation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isAuthorized(request: NextRequest) {
  const expected = process.env.CAFE24_WEBHOOK_TOKEN;
  const supplied = request.headers.get("x-mango-reconciliation-token");
  if (!expected || !supplied) return false;
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  return expectedBytes.length === suppliedBytes.length && crypto.timingSafeEqual(expectedBytes, suppliedBytes);
}

function kstDate(daysAgo: number) {
  const value = new Date(Date.now() + 9 * 60 * 60 * 1000 - daysAgo * 24 * 60 * 60 * 1000);
  return value.toISOString().slice(0, 10);
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    // 지연 웹훅·부분 취소까지 포착할 수 있도록 최근 7일을 겹쳐서 멱등 보정합니다.
    const result = await reconcileCafe24Orders({ startDate: kstDate(7), endDate: kstDate(0) });
    return NextResponse.json({ ok: result.failedCount === 0, result }, { status: result.failedCount ? 207 : 200 });
  } catch (error) {
    console.error("[cafe24 reconciliation] failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "reconciliation_failed" }, { status: 502 });
  }
}
