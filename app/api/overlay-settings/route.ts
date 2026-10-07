import { NextRequest, NextResponse } from "next/server";
import { getOverlaySettings, saveOverlaySettings } from "@/lib/store";
import { DEFAULT_NEW_OVERLAY_SETTINGS, DEFAULT_OVERLAY_SETTINGS, getDeckAppearance, SHORTS_ZONE_IDS, type OverlaySettings, type ShortsOverlaySettings, type ShortsZoneId } from "@/lib/overlaySettings";

export const runtime = "nodejs";

const clamp = (value: unknown, min: number, max: number) =>
  Math.min(max, Math.max(min, Number(value) || 0));
const color = (value: unknown, fallback: string) =>
  typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;
const text = (value: unknown, fallback: string, max = 160) =>
  typeof value === "string" ? value.slice(0, max) : fallback;
const motion = (value: unknown, fallback: OverlaySettings["shorts"]["zones"][ShortsZoneId]["motion"]) =>
  value === "none" || value === "fade" || value === "slide-up" || value === "left-to-right" || value === "card-turn" ? value : fallback;

export async function GET() {
  return NextResponse.json(getOverlaySettings());
}

export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => null) as OverlaySettings | null;
  if (!body?.scales || !body?.position) {
    return NextResponse.json({ error: "invalid settings" }, { status: 400 });
  }

  const sanitizeDeckAppearance = (source: Partial<OverlaySettings["shorts"]["zones"][ShortsZoneId]> | undefined, fallback: OverlaySettings["shorts"]["zones"][ShortsZoneId], id: ShortsZoneId) => {
    const defaults = getDeckAppearance(id, fallback);
    const input = source?.deckAppearance;
    return {
      backgroundStart: color(input?.backgroundStart, defaults.backgroundStart),
      backgroundMiddle: color(input?.backgroundMiddle, defaults.backgroundMiddle),
      backgroundEnd: color(input?.backgroundEnd, defaults.backgroundEnd),
      titleStart: color(input?.titleStart, defaults.titleStart),
      titleEnd: color(input?.titleEnd, defaults.titleEnd),
      itemBackground: color(input?.itemBackground, defaults.itemBackground),
      borderColor: color(input?.borderColor, defaults.borderColor),
      titleColor: color(input?.titleColor, defaults.titleColor),
      textColor: color(input?.textColor, defaults.textColor),
      nicknameColor: color(input?.nicknameColor, defaults.nicknameColor),
      iconColor: color(input?.iconColor, defaults.iconColor),
      badgeFirstColor: color(input?.badgeFirstColor, defaults.badgeFirstColor),
      badgeRepeatColor: color(input?.badgeRepeatColor, defaults.badgeRepeatColor),
      badgeVipColor: color(input?.badgeVipColor, defaults.badgeVipColor),
      titleIcon: text(input?.titleIcon, defaults.titleIcon, 12),
      openTitle: text(input?.openTitle, defaults.openTitle, 30),
      waitingTitle: text(input?.waitingTitle, defaults.waitingTitle, 30),
      opacity: clamp(input?.opacity ?? defaults.opacity, 0, 100),
      backgroundOpacity: clamp(input?.backgroundOpacity ?? defaults.backgroundOpacity, 0, 100),
      titleOpacity: clamp(input?.titleOpacity ?? defaults.titleOpacity, 0, 100),
      titleScale: clamp(input?.titleScale ?? defaults.titleScale, 50, 200),
      textScale: clamp(input?.textScale ?? defaults.textScale, 50, 200),
      glow: typeof input?.glow === "boolean" ? input.glow : defaults.glow,
      shine: typeof input?.shine === "boolean" ? input.shine : defaults.shine,
      textBurst: typeof input?.textBurst === "boolean" ? input.textBurst : defaults.textBurst,
      cardFlip: typeof input?.cardFlip === "boolean" ? input.cardFlip : defaults.cardFlip,
      effectSeconds: clamp(input?.effectSeconds ?? defaults.effectSeconds, 1, 10),
      flowDirection: input?.flowDirection === "up" || input?.flowDirection === "down" ? input.flowDirection : defaults.flowDirection,
      waitingSeconds: clamp(input?.waitingSeconds ?? defaults.waitingSeconds, 1, 120),
      itemGap: clamp(input?.itemGap ?? defaults.itemGap, 0, 32),
      itemHeight: clamp(input?.itemHeight ?? defaults.itemHeight, 0, 100),
    };
  };

  const sanitizeZone = (source: Partial<OverlaySettings["shorts"]["zones"][ShortsZoneId]> | undefined, fallback: OverlaySettings["shorts"]["zones"][ShortsZoneId], id: ShortsZoneId = "announcement") => ({
    ...(source?.deckAppearance ? { deckAppearance: sanitizeDeckAppearance(source, fallback, id) } : {}),
    visible: source?.visible !== false,
    title: text(source?.title, fallback.title, 60),
    template: text(source?.template, fallback.template),
    x: clamp(source?.x ?? fallback.x, 0, 100),
    y: clamp(source?.y ?? fallback.y, 0, 94),
    width: clamp(source?.width ?? fallback.width, 8, 100),
    height: clamp(source?.height ?? fallback.height, 3, 70),
    zIndex: clamp(source?.zIndex ?? fallback.zIndex, 1, 20),
    accent: color(source?.accent, fallback.accent),
    titleColor: color(source?.titleColor, fallback.titleColor),
    nicknameColor: color(source?.nicknameColor, fallback.nicknameColor),
    textColor: color(source?.textColor, fallback.textColor),
    openTitleColor: color(source?.openTitleColor, fallback.openTitleColor),
    openTextColor: color(source?.openTextColor, fallback.openTextColor),
    openNicknameColor: color(source?.openNicknameColor, fallback.openNicknameColor),
    openProductColor: color(source?.openProductColor, fallback.openProductColor),
    openBorderColor: color(source?.openBorderColor, fallback.openBorderColor),
    waitingTitleColor: color(source?.waitingTitleColor, fallback.waitingTitleColor),
    waitingTextColor: color(source?.waitingTextColor, fallback.waitingTextColor),
    waitingCountColor: color(source?.waitingCountColor, fallback.waitingCountColor),
    waitingIndexColor: color(source?.waitingIndexColor, fallback.waitingIndexColor),
    waitingNicknameColor: color(source?.waitingNicknameColor, fallback.waitingNicknameColor),
    waitingProductColor: color(source?.waitingProductColor, fallback.waitingProductColor),
    waitingBorderColor: color(source?.waitingBorderColor, fallback.waitingBorderColor),
    titleBackgroundColor: color(source?.titleBackgroundColor, fallback.titleBackgroundColor),
    textBackgroundColor: color(source?.textBackgroundColor, fallback.textBackgroundColor),
    titleBackgroundOpacity: clamp(source?.titleBackgroundOpacity ?? fallback.titleBackgroundOpacity, 0, 100),
    borderColor: color(source?.borderColor, fallback.borderColor),
    backgroundOpacity: clamp(source?.backgroundOpacity ?? fallback.backgroundOpacity, 0, 100),
    backgroundColor: color(source?.backgroundColor, fallback.backgroundColor),
    tickerDurationSeconds: clamp(source?.tickerDurationSeconds ?? fallback.tickerDurationSeconds, 1, 60),
    motionDurationSeconds: clamp(source?.motionDurationSeconds ?? fallback.motionDurationSeconds, 0.2, 3),
    motion: motion(source?.motion, fallback.motion),
  });

  const sanitizeProfile = (source: Partial<ShortsOverlaySettings> | undefined, fallback: ShortsOverlaySettings): ShortsOverlaySettings => ({
    hitItemGap: clamp(source?.hitItemGap ?? fallback.hitItemGap, 0, 32),
    hitItemHeight: clamp(source?.hitItemHeight ?? fallback.hitItemHeight, 0, 80),
    waitingItemGap: clamp(source?.waitingItemGap ?? fallback.waitingItemGap, 0, 32),
    ...(fallback.openingEmptyTransparency == null ? {} : {
      openingEmptyTransparency: clamp(source?.openingEmptyTransparency ?? fallback.openingEmptyTransparency, 0, 100),
    }),
    zones: Object.fromEntries(SHORTS_ZONE_IDS.map((id) => [
      id,
      sanitizeZone(source?.zones?.[id], fallback.zones[id], id),
    ])) as ShortsOverlaySettings["zones"],
    newOrder: {
      first: {
        durationSeconds: clamp(source?.newOrder?.first?.durationSeconds ?? fallback.newOrder.first.durationSeconds, 1, 20),
        zone: sanitizeZone(source?.newOrder?.first?.zone, fallback.newOrder.first.zone),
      },
      repeat: {
        durationSeconds: clamp(source?.newOrder?.repeat?.durationSeconds ?? fallback.newOrder.repeat.durationSeconds, 1, 20),
        zone: sanitizeZone(source?.newOrder?.repeat?.zone, fallback.newOrder.repeat.zone),
      },
      vip: {
        durationSeconds: clamp(source?.newOrder?.vip?.durationSeconds ?? fallback.newOrder.vip.durationSeconds, 1, 20),
        zone: sanitizeZone(source?.newOrder?.vip?.zone, fallback.newOrder.vip.zone),
      },
    },
  });

  const shorts = sanitizeProfile(body.shorts, DEFAULT_OVERLAY_SETTINGS.shorts);
  const newOverlay = sanitizeProfile(body.newOverlay, DEFAULT_NEW_OVERLAY_SETTINGS);

  const settings: OverlaySettings = {
    orderVisible: body.orderVisible !== false,
    panelBackgroundVisible: body.panelBackgroundVisible !== false,
    panelBackgroundTransparency: clamp(body.panelBackgroundTransparency ?? DEFAULT_OVERLAY_SETTINGS.panelBackgroundTransparency, 0, 100),
    openingEmptyTransparency: clamp(body.openingEmptyTransparency ?? DEFAULT_OVERLAY_SETTINGS.openingEmptyTransparency, 0, 100),
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
    shorts,
    newOverlay,
  };

  saveOverlaySettings(settings ?? DEFAULT_OVERLAY_SETTINGS);
  return NextResponse.json({ ok: true, settings });
}
