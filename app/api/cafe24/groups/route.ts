import { NextResponse } from "next/server";
import { getCafe24CustomerGroups } from "@/lib/cafe24Admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ groups: await getCafe24CustomerGroups() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "등급 조회에 실패했습니다." }, { status: 502 });
  }
}
