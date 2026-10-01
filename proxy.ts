import { NextRequest, NextResponse } from "next/server";
import {
  ADMIN_AUTH_COOKIE,
  areAdminAccountsConfigured,
  getValidAdminAuthTokens,
} from "@/lib/adminAuth";

// 카페24 웹훅은 별도의 토큰으로 인증하고, 로그인 API는 인증 전 호출해야 한다.
const PUBLIC_PATHS = new Set([
  "/admin/login",
  "/api/admin/login",
  "/api/webhooks/cafe24",
  "/api/cafe24/oauth/callback",
  "/api/overlay-live",
  "/api/overlay-stream",
  "/overlay-cardbreak",
  "/overlay-shorts",
  "/overlay-vertical",
]);

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (PUBLIC_PATHS.has(pathname)) {
    return NextResponse.next();
  }

  const cookieToken = req.cookies.get(ADMIN_AUTH_COOKIE)?.value;
  const validTokens = areAdminAccountsConfigured() ? await getValidAdminAuthTokens() : [];
  const authed = !!cookieToken && validTokens.includes(cookieToken);

  if (authed) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  return NextResponse.redirect(new URL("/admin/login", req.url));
}

export const config = {
  matcher: ["/((?!_next/|favicon.ico|icon.jpg).*)"],
};
