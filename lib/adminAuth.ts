// 관리자 화면(/admin, /order-history) 접근을 지키기 위한 계정 인증.
// - 세션/DB 없이, env로 지정한 주/부계정 두 개만 사용합니다.
// - 쿠키에는 아이디/비밀번호 원문이 아니라 계정별 SHA-256 토큰만 저장합니다.
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

type AdminAccount = {
  id: string;
  password: string;
};

function getConfiguredAdminAccounts(): AdminAccount[] {
  const accounts = [
    { id: process.env.ADMIN_PRIMARY_ID, password: process.env.ADMIN_PRIMARY_PASSWORD },
    { id: process.env.ADMIN_SECONDARY_ID, password: process.env.ADMIN_SECONDARY_PASSWORD },
  ];

  return accounts.filter(
    (account): account is AdminAccount => !!account.id && !!account.password
  );
}

/** 로그인 성공 시 쿠키에 저장할 계정별 인증 토큰을 계산합니다. */
export async function computeAdminAuthToken(id: string, password: string): Promise<string> {
  return sha256Hex(`${id}\u0000${password}`);
}

/**
 * 주/부계정 환경변수가 모두 설정되어 있는지 확인합니다.
 * 하나라도 빠져 있으면 인증 설정 오류로 처리해 관리자 화면을 열지 않습니다.
 */
export function areAdminAccountsConfigured(): boolean {
  return getConfiguredAdminAccounts().length === 2;
}

export async function authenticateAdmin(id: string, password: string): Promise<string | null> {
  for (const account of getConfiguredAdminAccounts()) {
    const suppliedToken = await computeAdminAuthToken(id, password);
    const expectedToken = await computeAdminAuthToken(account.id, account.password);
    if (suppliedToken === expectedToken) return expectedToken;
  }
  return null;
}

export async function getValidAdminAuthTokens(): Promise<string[]> {
  return Promise.all(
    getConfiguredAdminAccounts().map((account) =>
      computeAdminAuthToken(account.id, account.password)
    )
  );
}
