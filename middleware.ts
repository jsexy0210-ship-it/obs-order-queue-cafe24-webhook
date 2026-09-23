import { NextRequest, NextResponse } from "next/server";
import {
  ADMIN_AUTH_COOKIE,
  areAdminAccountsConfigured,
  getValidAdminAuthTokens,
} from "@/lib/adminAuth";

// 사용자용 페이지는 기본적으로 모두 로그인 보호한다.
// 공개 예외는 OBS가 로그인 없이 직접 읽어야 하는 실제 방송 오버레이와 로그인 화면뿐이다.
//
// 공개 유지:
//  - /admin/login
//  - /overlay, /overlay-cardbreak, /overlay-vertical
//  - /api/orders (GET), /api/stream (SSE) — 오버레이 상태 조회용
//  - /api/webhooks/cafe24 — Cafe24 서버 웹훅(자체 token 검증)
//
// 로그인 보호:
//  - /, /admin, /order-history, /preview-* 및 향후 추가되는 일반 페이지
//  - 주문/히트카드/설정 등을 변경하는 쓰기 API
const PUBLIC_EXACT_PAGES = ["/admin/login"];
const PUBLIC_PAGE_PREFIXES = ["/overlay", "/overlay-cardbreak", "/overlay-vertical"];

function isPublicPage(pathname: string): boolean {
  if (PUBLIC_EXACT_PAGES.includes(pathname)) return true;

  return PUBLIC_PAGE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

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

  const isPageRequest = !pathname.startsWith("/api/");
  const isProtectedPage = isPageRequest && !isPublicPage(pathname);
  const isProtectedApi = isProtectedApiRequest(pathname, req.method);

  if (!isProtectedPage && !isProtectedApi) {
    return NextResponse.next();
  }

  const cookieToken = req.cookies.get(ADMIN_AUTH_COOKIE)?.value;
  const validTokens = areAdminAccountsConfigured() ? await getValidAdminAuthTokens() : [];
  const authed = !!cookieToken && validTokens.includes(cookieToken);

  if (authed) {
    return NextResponse.next();
  }

  if (isProtectedPage) {
    const loginUrl = new URL("/admin/login", req.url);
    loginUrl.searchParams.set("next", pathname === "/" ? "/admin" : pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
}

export const config = {
  matcher: [
    // 일반 페이지는 기본 로그인 보호. API/Next 내부 리소스/앱 아이콘은 별도 처리한다.
    "/((?!api|_next/static|_next/image|favicon.ico|icon.jpg).*)",
    // 쓰기 API는 기존과 동일하게 인증 보호한다.
    "/api/orders/:path*",
    "/api/hit-cards/:path*",
    "/api/order-history",
    "/api/overlay-settings",
  ],
};
