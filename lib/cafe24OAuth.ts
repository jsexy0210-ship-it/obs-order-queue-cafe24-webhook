import crypto from "crypto";
import { db } from "./db";

const TOKEN_ENCRYPTION_KEY_BYTES = 32;

export type Cafe24OAuthTokens = {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: string;
  refreshTokenExpiresAt: string;
  scopes: string[];
  shopNo: string;
  mallId: string;
};

type EncryptedPayload = {
  version: 1;
  iv: string;
  tag: string;
  ciphertext: string;
};

function getEncryptionKey(): Buffer {
  const encoded = process.env.CAFE24_TOKEN_ENCRYPTION_KEY;
  if (!encoded) {
    throw new Error("CAFE24_TOKEN_ENCRYPTION_KEY가 설정되지 않았습니다.");
  }

  const key = Buffer.from(encoded, "base64");
  if (key.length !== TOKEN_ENCRYPTION_KEY_BYTES) {
    throw new Error("CAFE24_TOKEN_ENCRYPTION_KEY는 Base64 인코딩된 32바이트 키여야 합니다.");
  }
  return key;
}

function encrypt(value: Cafe24OAuthTokens): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  const payload: EncryptedPayload = {
    version: 1,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
  return JSON.stringify(payload);
}

function decrypt(value: string): Cafe24OAuthTokens {
  const payload = JSON.parse(value) as EncryptedPayload;
  if (payload.version !== 1 || !payload.iv || !payload.tag || !payload.ciphertext) {
    throw new Error("저장된 카페24 토큰 형식이 올바르지 않습니다.");
  }

  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    getEncryptionKey(),
    Buffer.from(payload.iv, "base64")
  );
  decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
  return JSON.parse(plaintext) as Cafe24OAuthTokens;
}

export function isCafe24OAuthConfigured() {
  return Boolean(
    process.env.CAFE24_MALL_ID &&
      process.env.CAFE24_CLIENT_ID &&
      process.env.CAFE24_CLIENT_SECRET &&
      process.env.CAFE24_REDIRECT_URI &&
      process.env.CAFE24_TOKEN_ENCRYPTION_KEY
  );
}

export function saveCafe24OAuthTokens(tokens: Cafe24OAuthTokens) {
  db.prepare(
    `INSERT INTO cafe24_oauth_tokens (id, encrypted_value, updated_at) VALUES (1, ?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET encrypted_value = excluded.encrypted_value, updated_at = datetime('now')`
  ).run(encrypt(tokens));
}

export function getCafe24OAuthTokens(): Cafe24OAuthTokens | null {
  const row = db
    .prepare("SELECT encrypted_value FROM cafe24_oauth_tokens WHERE id = 1")
    .get() as { encrypted_value: string } | undefined;
  if (!row) return null;
  return decrypt(row.encrypted_value);
}

export function getCafe24OAuthStatus() {
  if (!isCafe24OAuthConfigured()) {
    return { configured: false, connected: false, scopes: [] as string[], shopNo: null as string | null };
  }

  try {
    const tokens = getCafe24OAuthTokens();
    return {
      configured: true,
      connected: Boolean(tokens),
      scopes: tokens?.scopes ?? [],
      shopNo: tokens?.shopNo ?? null,
    };
  } catch {
    // 암호화 키 교체 또는 저장값 훼손 시 토큰을 사용하지 않고 재연결을 요구합니다.
    return { configured: true, connected: false, scopes: [] as string[], shopNo: null as string | null };
  }
}

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_at?: string;
  refresh_token_expires_at?: string;
  scopes?: string[];
  shop_no?: string | number;
  mall_id?: string;
};

function isExpiringSoon(value: string, gracePeriodMs = 5 * 60 * 1000) {
  const expiresAt = new Date(value).getTime();
  return !Number.isFinite(expiresAt) || expiresAt <= Date.now() + gracePeriodMs;
}

async function refreshCafe24AccessToken(current: Cafe24OAuthTokens): Promise<Cafe24OAuthTokens> {
  const clientCredentials = Buffer.from(
    `${process.env.CAFE24_CLIENT_ID!}:${process.env.CAFE24_CLIENT_SECRET!}`
  ).toString("base64");
  const response = await fetch(
    `https://${process.env.CAFE24_MALL_ID!}.cafe24api.com/api/v2/oauth/token`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${clientCredentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: current.refreshToken,
      }),
      cache: "no-store",
    }
  );
  const payload = await response.json().catch(() => null) as TokenResponse | null;
  if (
    !response.ok ||
    !payload?.access_token ||
    !payload.refresh_token ||
    !payload.expires_at ||
    !payload.refresh_token_expires_at
  ) {
    throw new Error(`카페24 Access Token 갱신 실패 (HTTP ${response.status})`);
  }

  const refreshed: Cafe24OAuthTokens = {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    accessTokenExpiresAt: payload.expires_at,
    refreshTokenExpiresAt: payload.refresh_token_expires_at,
    scopes: Array.isArray(payload.scopes) ? payload.scopes : current.scopes,
    shopNo: String(payload.shop_no ?? current.shopNo),
    mallId: payload.mall_id ?? current.mallId,
  };
  saveCafe24OAuthTokens(refreshed);
  return refreshed;
}

declare global {
  var __cafe24TokenRefreshPromise: Promise<Cafe24OAuthTokens> | undefined;
}

/**
 * 카페24 Admin API를 호출하기 직전에 사용합니다.
 * Access Token 만료 5분 전부터는 Refresh Token으로 새 토큰을 발급받고,
 * Refresh Token은 단 한 번만 쓸 수 있으므로 동시 갱신 요청을 하나로 묶습니다.
 */
export async function getValidCafe24AccessToken(): Promise<Cafe24OAuthTokens> {
  if (!isCafe24OAuthConfigured()) {
    throw new Error("카페24 OAuth 환경변수가 설정되지 않았습니다.");
  }
  const current = getCafe24OAuthTokens();
  if (!current) {
    throw new Error("카페24 OAuth 연결이 완료되지 않았습니다.");
  }
  if (!isExpiringSoon(current.accessTokenExpiresAt)) return current;
  if (isExpiringSoon(current.refreshTokenExpiresAt, 0)) {
    throw new Error("카페24 Refresh Token이 만료되었습니다. 카페24 재연결이 필요합니다.");
  }

  if (!global.__cafe24TokenRefreshPromise) {
    global.__cafe24TokenRefreshPromise = refreshCafe24AccessToken(current).finally(() => {
      global.__cafe24TokenRefreshPromise = undefined;
    });
  }
  return global.__cafe24TokenRefreshPromise;
}

export function getRequestedCafe24Scopes() {
  const configured = process.env.CAFE24_OAUTH_SCOPES;
  if (configured) {
    return configured.split(",").map((scope) => scope.trim()).filter(Boolean);
  }

  // 현재 망고TCG 앱의 개발자센터 권한 설정과 일치하는 기본 Scope입니다.
  return [
    "mall.read_order",
    "mall.read_customer",
    "mall.write_customer",
    "mall.read_mileage",
    "mall.write_mileage",
  ];
}
