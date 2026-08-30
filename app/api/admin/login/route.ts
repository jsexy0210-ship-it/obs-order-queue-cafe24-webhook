import { NextRequest, NextResponse } from "next/server";
import {
  ADMIN_AUTH_COOKIE,
  areAdminAccountsConfigured,
  authenticateAdmin,
} from "@/lib/adminAuth";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  if (!areAdminAccountsConfigured()) {
    return NextResponse.json(
      { error: "서버에 관리자 계정이 올바르게 설정되어 있지 않습니다." },
      { status: 500 }
    );
  }

  const body = await req.json().catch(() => null);
  const id = typeof body?.id === "string" ? body.id.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const token = await authenticateAdmin(id, password);

  if (!token) {
    return NextResponse.json({ error: "아이디 또는 비밀번호가 올바르지 않습니다." }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_AUTH_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365, // 한 번 로그인하면 1년간 인증 유지
  });
  return res;
}
