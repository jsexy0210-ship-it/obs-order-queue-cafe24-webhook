import { NextRequest, NextResponse } from "next/server";
import { getOverlaySettings, saveOverlaySettings } from "@/lib/store";
import { DEFAULT_OVERLAY_SETTINGS, type OverlaySettings } from "@/lib/overlaySettings";

export const runtime = "nodejs";

const clamp = (value: unknown, min: number, max: number) =>
  Math.min(max, Math.max(min, Number(value) || 0));
const color = (value: unknown, fallback: string) =>
  typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;

export async function GET() {
  return NextResponse.json(getOverlaySettings());
}

export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => null) as OverlaySettings | null;
  if (!body?.scales || !body?.position) {
    return NextResponse.json({ error: "invalid settings" }, { status: 400 });
  }

  const settings: OverlaySettings = {
    orderVisible: body.orderVisible !== false,
    scales: {
      order: clamp(body.scales.order, 0.6, 1.8),
      hit: clamp(body.scales.hit, 0.6, 1.8),
      right: clamp(body.scales.right, 0.6, 1.8),
    },
    widths: {
      order: clamp(body.widths?.order ?? DEFAULT_OVERLAY_SETTINGS.widths.order, 28, 90),
      hit: clamp(body.widths?.hit ?? DEFAULT_OVERLAY_SETTINGS.widths.hit, 28, 90),
      right: clamp(body.widths?.right ?? DEFAULT_OVERLAY_SETTINGS.widths.right, 28, 90),
    },
    position: {
      orderX: clamp(body.position.orderX, -100, 100),
      orderY: clamp(body.position.orderY, -100, 100),
      hitX: clamp(body.position.hitX, -100, 100),
      hitY: clamp(body.position.hitY, -100, 100),
      rightX: clamp(body.position.rightX, -100, 100),
      rightY: clamp(body.position.rightY, -100, 100),
    },
    colors: {
      orderAccent: color(body.colors?.orderAccent, DEFAULT_OVERLAY_SETTINGS.colors.orderAccent),
      hitAccent: color(body.colors?.hitAccent, DEFAULT_OVERLAY_SETTINGS.colors.hitAccent),
      liveAccent: color(body.colors?.liveAccent, DEFAULT_OVERLAY_SETTINGS.colors.liveAccent),
      panelBackground: color(body.colors?.panelBackground, DEFAULT_OVERLAY_SETTINGS.colors.panelBackground),
      primaryText: color(body.colors?.primaryText, DEFAULT_OVERLAY_SETTINGS.colors.primaryText),
      orderText: color(body.colors?.orderText, DEFAULT_OVERLAY_SETTINGS.colors.orderText),
      hitHeaderText: color(body.colors?.hitHeaderText, DEFAULT_OVERLAY_SETTINGS.colors.hitHeaderText),
      hitBuyerText: color(body.colors?.hitBuyerText, DEFAULT_OVERLAY_SETTINGS.colors.hitBuyerText),
      hitCardText: color(body.colors?.hitCardText, DEFAULT_OVERLAY_SETTINGS.colors.hitCardText),
      liveHeaderText: color(body.colors?.liveHeaderText, DEFAULT_OVERLAY_SETTINGS.colors.liveHeaderText),
      liveBuyerText: color(body.colors?.liveBuyerText, DEFAULT_OVERLAY_SETTINGS.colors.liveBuyerText),
      liveProductText: color(body.colors?.liveProductText, DEFAULT_OVERLAY_SETTINGS.colors.liveProductText),
      queueBuyerText: color(body.colors?.queueBuyerText, DEFAULT_OVERLAY_SETTINGS.colors.queueBuyerText),
      queueProductText: color(body.colors?.queueProductText, DEFAULT_OVERLAY_SETTINGS.colors.queueProductText),
      quantityText: color(body.colors?.quantityText, DEFAULT_OVERLAY_SETTINGS.colors.quantityText),
      timerText: color(body.colors?.timerText, DEFAULT_OVERLAY_SETTINGS.colors.timerText),
    },
  };

  saveOverlaySettings(settings ?? DEFAULT_OVERLAY_SETTINGS);
  return NextResponse.json({ ok: true, settings });
}
