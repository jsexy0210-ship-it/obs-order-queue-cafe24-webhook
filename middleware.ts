import { NextRequest, NextResponse } from "next/server";
import { ADMIN_AUTH_COOKIE, computeAdminAuthToken } from "@/lib/adminAuth";

// 비밀번호로 보호할 대상:
//  - 관리자 화면 페이지: /admin, /order-history
//  - 그 화면들이 쓰는 "쓰기" API (주문/히트카드 추가·삭제·상태변경, 이력 초기화)
//
// 절대 막으면 안 되는 것들(OBS 브라우저 소스가 로그인 없이 항상 떠 있어야 함):
//  - /overlay-cardbreak, /overlay-vertical, /preview-cardbreak, /preview-vertical
//  - /api/orders (GET), /api/stream (SSE) — 오버레이가 상태를 읽어오는 용도
//  - /api/webhooks/cafe24 — 카페24 서버가 호출하는 웹훅(자체 token 파라미터로 이미 인증됨)
const PROTECTED_PAGE_PREFIXES = ["/admin", "/order-history"];
const PUBLIC_ADMIN_PAGES = ["/admin/login"];

function isProtectedApiRequest(pathname: string, method: string): boolean {
  if (pathname === "/api/orders" && method === "POST") return true;
  if (pathname.startsWith("/api/orders/") && (method === "PATCH" || method === "DELETE")) return true;
  if (pathname === "/api/hit-cards" && method === "POST") return true;
  if (pathname.startsWith("/api/hit-cards/") && method === "DELETE") return true;
  if (pathname === "/api/order-history" && method === "DELETE") return true;
  if (pathname === "/api/overlay-settings" && method === "PUT") return true;
  return false;
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const isProtectedPage =
    !PUBLIC_ADMIN_PAGES.includes(pathname) &&
    PROTECTED_PAGE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  const isProtectedApi = isProtectedApiRequest(pathname, req.method);

  if (!isProtectedPage && !isProtectedApi) {
    return NextResponse.next();
  }

  const adminPassword = process.env.ADMIN_PASSWORD;

  // ADMIN_PASSWORD 환경변수가 아직 설정되지 않았다면(예: 배포 직후) 기존처럼 그대로 열어둡니다.
  if (!adminPassword) {
    return NextResponse.next();
  }

  const cookieToken = req.cookies.get(ADMIN_AUTH_COOKIE)?.value;
  const expectedToken = await computeAdminAuthToken(adminPassword);
  const authed = !!cookieToken && cookieToken === expectedToken;

  if (authed) {
    return NextResponse.next();
  }

  if (isProtectedPage) {
    const loginUrl = new URL("/admin/login", req.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
}

export const config = {
  matcher: [
    "/admin/:path*",
    "/order-history/:path*",
    "/api/orders/:path*",
    "/api/hit-cards/:path*",
    "/api/order-history",
    "/api/overlay-settings",
  ],
};
