// 관리자 화면(/admin, /order-history) 접근을 지키기 위한 간단한 비밀번호 인증.
// - 세션/DB 없이, env로 지정한 고정 비밀번호 하나만 사용합니다.
// - 쿠키에는 비밀번호 원문이 아니라 SHA-256 해시값만 저장합니다.
// - middleware(Edge 런타임)와 일반 API 라우트(Node 런타임) 양쪽에서 그대로 쓸 수 있도록
//   Node/Edge 모두에 있는 전역 Web Crypto(crypto.subtle)만 사용합니다.

export const ADMIN_AUTH_COOKIE = "admin_auth";

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** 로그인 성공 시 쿠키에 저장할 토큰(비밀번호의 해시값)을 계산합니다. */
export async function computeAdminAuthToken(password: string): Promise<string> {
  return sha256Hex(password);
}

/**
 * 입력한 비밀번호가 ADMIN_PASSWORD와 일치하는지 확인합니다.
 * ADMIN_PASSWORD가 설정되어 있지 않으면(예: 아직 배포 환경변수를 안 넣은 경우)
 * 로그인 자체를 막습니다 — "비밀번호 없음"을 "누구나 통과"로 해석하지 않기 위함입니다.
 */
export function isAdminPasswordConfigured(): boolean {
  return !!process.env.ADMIN_PASSWORD;
}

export function checkAdminPassword(password: string): boolean {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return false;
  return password === expected;
}
