import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getRequestedCafe24Scopes, isCafe24OAuthConfigured } from "@/lib/cafe24OAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATE_COOKIE = "cafe24_oauth_state";

export async function GET(req: NextRequest) {
  if (!isCafe24OAuthConfigured()) {
    return NextResponse.redirect(new URL("/admin?cafe24_oauth=configuration_required", req.url));
  }

  const state = crypto.randomBytes(32).toString("base64url");
  const mallId = process.env.CAFE24_MALL_ID!;
  const authorizationUrl = new URL(`https://${mallId}.cafe24api.com/api/v2/oauth/authorize`);
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("client_id", process.env.CAFE24_CLIENT_ID!);
  authorizationUrl.searchParams.set("redirect_uri", process.env.CAFE24_REDIRECT_URI!);
  authorizationUrl.searchParams.set("scope", getRequestedCafe24Scopes().join(","));
  authorizationUrl.searchParams.set("state", state);

  const response = NextResponse.redirect(authorizationUrl);
  response.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 10 * 60,
    path: "/",
  });
  return response;
}
