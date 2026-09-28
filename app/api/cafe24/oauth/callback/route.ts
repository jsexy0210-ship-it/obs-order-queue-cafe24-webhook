import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { isCafe24OAuthConfigured, saveCafe24OAuthTokens } from "@/lib/cafe24OAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATE_COOKIE = "cafe24_oauth_state";

function redirectToAdmin(req: NextRequest, result: string) {
  const url = new URL("/admin", req.url);
  url.searchParams.set("cafe24_oauth", result);
  return NextResponse.redirect(url);
}

function statesMatch(expected: string | undefined, received: string | null) {
  if (!expected || !received) return false;
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);
  return (
    expectedBuffer.length === receivedBuffer.length &&
    crypto.timingSafeEqual(expectedBuffer, receivedBuffer)
  );
}

export async function GET(req: NextRequest) {
  const receivedState = req.nextUrl.searchParams.get("state");
  const responseError = req.nextUrl.searchParams.get("error");
  const code = req.nextUrl.searchParams.get("code");
  const expectedState = req.cookies.get(STATE_COOKIE)?.value;

  if (responseError || !statesMatch(expectedState, receivedState) || !code) {
    const response = redirectToAdmin(req, responseError ? "denied" : "invalid_state");
    response.cookies.delete(STATE_COOKIE);
    return response;
  }

  if (!isCafe24OAuthConfigured()) {
    const response = redirectToAdmin(req, "configuration_required");
    response.cookies.delete(STATE_COOKIE);
    return response;
  }

  try {
    const mallId = process.env.CAFE24_MALL_ID!;
    const clientCredentials = Buffer.from(
      `${process.env.CAFE24_CLIENT_ID!}:${process.env.CAFE24_CLIENT_SECRET!}`
    ).toString("base64");
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: process.env.CAFE24_REDIRECT_URI!,
    });
    const tokenResponse = await fetch(`https://${mallId}.cafe24api.com/api/v2/oauth/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${clientCredentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
      cache: "no-store",
    });
    const payload = await tokenResponse.json().catch(() => null) as {
      access_token?: string;
      refresh_token?: string;
      expires_at?: string;
      refresh_token_expires_at?: string;
      scopes?: string[];
      shop_no?: string | number;
      mall_id?: string;
    } | null;

    if (
      !tokenResponse.ok ||
      !payload?.access_token ||
      !payload.refresh_token ||
      !payload.expires_at ||
      !payload.refresh_token_expires_at
    ) {
      console.error("[cafe24 oauth] token exchange failed", { status: tokenResponse.status });
      const response = redirectToAdmin(req, "token_exchange_failed");
      response.cookies.delete(STATE_COOKIE);
      return response;
    }

    saveCafe24OAuthTokens({
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token,
      accessTokenExpiresAt: payload.expires_at,
      refreshTokenExpiresAt: payload.refresh_token_expires_at,
      scopes: Array.isArray(payload.scopes) ? payload.scopes : [],
      shopNo: String(payload.shop_no ?? "1"),
      mallId: payload.mall_id ?? mallId,
    });

    const response = redirectToAdmin(req, "connected");
    response.cookies.delete(STATE_COOKIE);
    return response;
  } catch (error) {
    console.error("[cafe24 oauth] callback failed", error instanceof Error ? error.message : "unknown");
    const response = redirectToAdmin(req, "token_exchange_failed");
    response.cookies.delete(STATE_COOKIE);
    return response;
  }
}
