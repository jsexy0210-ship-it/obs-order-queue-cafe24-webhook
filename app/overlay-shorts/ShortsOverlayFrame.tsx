"use client";

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { useLiveCardBreak, type LiveOrder } from "@/app/useLiveCardBreak";
import { DEFAULT_NEW_OVERLAY_SETTINGS, getDeckAppearance, SHORTS_ZONE_IDS, type OverlaySettings, type ShortsZoneId } from "@/lib/overlaySettings";
import Image from "next/image";
import pikachuCard from "./icons/pikachu-card.png";
import luffyCard from "./icons/luffy-card.png";
import styles from "./shorts.module.css";

type Props = {
  settingsOverride?: OverlaySettings;
  variant?: "basic" | "deck";
  editing?: boolean;
  /** 관리 화면에서는 실제 방송 비율의 독립된 미리보기 캔버스를 사용합니다. */
  preview?: boolean;
  /** 기본 오버레이와 신규 주문 연출을 관리 화면에서 분리해 미리봅니다. */
  zoneIds?: readonly ShortsZoneId[];
  /** 관리 화면에서 최신 실제 주문으로 신규 주문 효과를 미리봅니다. */
  showAnimationPreview?: boolean;
  /** 관리 화면에서 선택한 주문 유형의 문구와 효과를 즉시 미리봅니다. */
  previewOrderKind?: NewOrderEffectKind;
  /** 신규 덱 미리보기는 관리자 주문 목록의 실제 항목을 사용합니다. */
  previewOpeningOrder?: LiveOrder | null;
  previewWaitingOrders?: LiveOrder[];
  onZoneChange?: (id: ShortsZoneId, patch: Partial<OverlaySettings["shorts"]["zones"][ShortsZoneId]>) => void;
};

type RankingRow = {
  rank: number;
  youtubeNickname: string | null;
  orderCount: number;
};

type ResizeDirection = "n" | "e" | "s" | "w" | "ne" | "nw" | "se" | "sw";
type Interaction = { id: ShortsZoneId; direction: ResizeDirection | "move"; startX: number; startY: number; zone: OverlaySettings["shorts"]["zones"][ShortsZoneId] };
type AlignmentGuides = { vertical?: number; horizontal?: number };
type NewOrderEffectKind = "first" | "repeat" | "vip";
type EffectOrder = Pick<LiveOrder, "id" | "youtube_nickname" | "product" | "quantity" | "product_image_url" | "payment_method" | "order_count" | "ranking_rank">;
type NewOrderEffect = { order: EffectOrder; kind: NewOrderEffectKind };

const zoneLabels: Record<ShortsZoneId, string> = {
  hit: "HIT&RGB",
  ranking: "명예의 전당",
  current: "오픈 대기",
  announcement: "신규 주문 연출",
};

const INITIAL_NEW_ORDER_CATCHUP_MS = 10_000;

function nickname(value: string | null | undefined) {
  return (value ?? "-").replace(/\([^)]*\)/g, "").replaceAll("빙귀쟁이", "방귀쟁이").trim() || "-";
}

function newOrderBadge(kind: NewOrderEffectKind) {
  if (kind === "first") return "첫주문";
  if (kind === "vip") return "VIP";
  return "신규";
}

function orderEffectKind(order: Pick<LiveOrder, "is_first_order" | "ranking_rank">): NewOrderEffectKind {
  if (order.is_first_order) return "first";
  return order.ranking_rank != null && order.ranking_rank <= 3 ? "vip" : "repeat";
}

function fill(template: string, values: Record<string, string | number>) {
  return template.replace(/\{\{(nickname|product|quantity|card|count)\}\}/g, (_, key: string) => String(values[key] ?? "-"));
}

function textFit(value: string, targetCharacters: number) {
  const scale = Math.max(.4, Math.min(1, targetCharacters / Math.max(1, [...value].length)));
  return { "--text-fit": String(scale) } as CSSProperties;
}

function rankingIcon(rank: number) {
  return rank === 1 ? "1" : rank === 2 ? "2" : "3";
}

function CurrentOrderProduct({ product, quantity, forceScroll = false, durationSeconds, quantitySeparator = " · ×", className = "" }: Pick<LiveOrder, "product" | "quantity"> & { forceScroll?: boolean; durationSeconds?: number; quantitySeparator?: string; className?: string }) {
  const label = `${product}${quantitySeparator}${quantity}`;
  const viewportRef = useRef<HTMLElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [overflowing, setOverflowing] = useState(false);
  const [duration, setDuration] = useState(8);

  useEffect(() => {
    const viewport = viewportRef.current;
    const text = textRef.current;
    if (!viewport || !text) return;
    const measure = () => {
      const isOverflowing = text.scrollWidth > viewport.clientWidth + 1;
      setOverflowing((current) => current === isOverflowing ? current : isOverflowing);
      const nextDuration = durationSeconds ?? Math.max(6, Math.min(30, text.scrollWidth / 30));
      setDuration((current) => Math.abs(current - nextDuration) < .5 ? current : nextDuration);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    observer.observe(text);
    return () => observer.disconnect();
  }, [label, durationSeconds]);

  const shouldScroll = forceScroll || overflowing;

  return <em ref={viewportRef} className={`${styles.currentOrderProduct} ${shouldScroll ? styles.currentOrderProductScrolling : ""} ${className}`} style={{ "--product-ticker-duration": `${duration}s` } as CSSProperties}>
    <span className={styles.currentOrderProductTrack}>
      <span ref={textRef} className={styles.currentOrderProductText}>{label}</span>
      {shouldScroll && <span className={styles.currentOrderProductText} aria-hidden="true">{label}</span>}
    </span>
  </em>;
}

export default function ShortsOverlayFrame({ settingsOverride, variant = "basic", editing = false, preview = false, zoneIds = SHORTS_ZONE_IDS, showAnimationPreview = false, previewOrderKind = "repeat", previewOpeningOrder, previewWaitingOrders, onZoneChange }: Props) {
  const live = useLiveCardBreak();
  const [ranking, setRanking] = useState<RankingRow[]>([]);
  const [newOrderEffect, setNewOrderEffect] = useState<NewOrderEffect | null>(null);
  const [previewOrder, setPreviewOrder] = useState<EffectOrder | null>(null);
  const [alignmentGuides, setAlignmentGuides] = useState<AlignmentGuides>({});
  const stageRef = useRef<HTMLDivElement>(null);
  const interactionRef = useRef<Interaction | null>(null);
  const seenOrderIds = useRef<Set<number> | null>(null);
  const newOverlayProfile = live.overlaySettings.newOverlay ?? DEFAULT_NEW_OVERLAY_SETTINGS;
  const settings = settingsOverride ?? (variant === "deck" ? {
    ...live.overlaySettings,
    shorts: newOverlayProfile,
    openingEmptyTransparency: newOverlayProfile.openingEmptyTransparency ?? 40,
  } : live.overlaySettings);
  const openingOrder = preview && variant === "deck" && previewOpeningOrder !== undefined ? previewOpeningOrder : live.opening;
  const waitingOrders = preview && variant === "deck" && previewWaitingOrders !== undefined ? previewWaitingOrders : live.waiting;
  const actualActiveOrder = openingOrder ?? waitingOrders[0] ?? null;
  const activeOrder = actualActiveOrder;
  const displayedHitCards = live.hitCards;
  const visibleHitCards = displayedHitCards;
  const shouldScrollHitCards = visibleHitCards.length >= 4;
  const shouldScrollWaitingOrders = waitingOrders.length >= 3;
  const renderedHitCards = visibleHitCards;
  const latestHit = displayedHitCards[0] ?? null;
  const displayedRanking = ranking;
  const commonValues = {
    nickname: nickname(activeOrder?.youtube_nickname),
    product: activeOrder?.product ?? "대기 중인 주문 없음",
    quantity: activeOrder?.quantity ?? 0,
    card: latestHit?.card ?? "등록된 히트카드 없음",
    count: actualActiveOrder?.id ?? 1,
  };

  useEffect(() => {
    let cancelled = false;
    let loading = false;
    const loadRanking = () => {
      if (loading) return;
      loading = true;
      fetch(`/api/overlay-ranking${variant === "deck" ? "?limit=10" : ""}`, { cache: "no-store" })
        .then((response) => response.ok ? response.json() : Promise.reject(new Error("ranking failed")))
        .then((data: { ranking?: RankingRow[] }) => {
          if (!cancelled) setRanking((data.ranking ?? []).slice(0, variant === "deck" ? 10 : 3));
        })
        .catch(() => {
          if (!cancelled) setRanking([]);
        })
        .finally(() => { loading = false; });
    };
    loadRanking();
    const timer = window.setInterval(loadRanking, 3_000);
    const refreshWhenVisible = () => { if (document.visibilityState === "visible") loadRanking(); };
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [variant]);

  // 관리 화면의 신규 주문 효과는 최신 실제 주문으로 미리봅니다.
  useEffect(() => {
    if (!showAnimationPreview) {
      setPreviewOrder(null);
      return;
    }
    let cancelled = false;
    const loadPreviewOrder = () => {
      fetch("/api/overlay-order-preview", { cache: "no-store" })
        .then((response) => response.ok ? response.json() : Promise.reject(new Error("preview order failed")))
        .then((data: { order?: EffectOrder | null }) => {
          if (!cancelled) setPreviewOrder(data.order ?? null);
        })
        .catch(() => {
          if (!cancelled) setPreviewOrder(null);
        });
    };
    loadPreviewOrder();
    const timer = window.setInterval(loadPreviewOrder, 30_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [showAnimationPreview]);

  // 첫 로드에서 이미 대기 중이던 주문은 재생하지 않습니다. 이후 새로 들어온 ID만 한 번 처리합니다.
  useEffect(() => {
    if (live.loading) return;
    const visibleOrders = [...(live.opening ? [live.opening] : []), ...live.waiting];
    const known = seenOrderIds.current;
    if (!known) {
      seenOrderIds.current = new Set(visibleOrders.map((order) => order.id));
      // OBS가 새로고침되거나 SSE가 재연결된 직후에도, 방금 들어온 주문은 한 번 알립니다.
      // 오래된 대기 주문은 기존처럼 다시 재생하지 않습니다.
      const newestOrder = visibleOrders.reduce<LiveOrder | null>(
        (latest, order) => !latest || order.id > latest.id ? order : latest,
        null,
      );
      const createdAt = newestOrder ? Date.parse(`${newestOrder.created_at.replace(" ", "T")}Z`) : NaN;
      if (newestOrder && Number.isFinite(createdAt) && Date.now() - createdAt >= 0 && Date.now() - createdAt <= INITIAL_NEW_ORDER_CATCHUP_MS) {
        setNewOrderEffect({ order: newestOrder, kind: orderEffectKind(newestOrder) });
      }
      return;
    }
    const incoming = visibleOrders
      .filter((order) => !known.has(order.id))
      .sort((left, right) => right.id - left.id);
    incoming.forEach((order) => known.add(order.id));
    if (incoming.length === 0) return;

    const order = incoming[0];
    setNewOrderEffect({
      order,
      kind: orderEffectKind(order),
    });
  }, [live.loading, live.opening, live.waiting]);

  useEffect(() => {
    if (!newOrderEffect) return;
    const durationSeconds = settings.shorts.newOrder[newOrderEffect.kind].durationSeconds;
    const timer = window.setTimeout(
      () => setNewOrderEffect(null),
      durationSeconds * 1000,
    );
    return () => window.clearTimeout(timer);
  }, [newOrderEffect, settings.shorts.newOrder]);

  const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

  function startInteraction(id: ShortsZoneId, direction: Interaction["direction"], event: ReactPointerEvent<HTMLElement>) {
    if (!editing || !onZoneChange) return;
    event.preventDefault();
    event.stopPropagation();
    const selectedZone = id === "announcement" && showAnimationPreview
      ? settings.shorts.newOrder[previewOrderKind].zone
      : settings.shorts.zones[id];
    interactionRef.current = { id, direction, startX: event.clientX, startY: event.clientY, zone: { ...selectedZone } };
    setAlignmentGuides({});
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveInteraction(event: ReactPointerEvent<HTMLElement>) {
    const interaction = interactionRef.current;
    const rect = stageRef.current?.getBoundingClientRect();
    if (!interaction || !rect || !onZoneChange) return;
    const dx = ((event.clientX - interaction.startX) / rect.width) * 100;
    const dy = ((event.clientY - interaction.startY) / rect.height) * 100;
    let { x, y, width, height } = interaction.zone;
    const direction = interaction.direction;
    if (interaction.id === "announcement") {
      if (direction === "move") return;
      if (direction.includes("e")) width += dx;
      if (direction.includes("s")) height += dy;
      if (direction.includes("w")) width -= dx;
      if (direction.includes("n")) height -= dy;
      onZoneChange(interaction.id, {
        width: clamp(width, 8, 100),
        height: clamp(height, 3, 70),
      });
      return;
    }
    if (direction === "move") { x += dx; y += dy; }
    if (direction !== "move" && direction.includes("e")) width += dx;
    if (direction !== "move" && direction.includes("s")) height += dy;
    if (direction !== "move" && direction.includes("w")) { x += dx; width -= dx; }
    if (direction !== "move" && direction.includes("n")) { y += dy; height -= dy; }
    width = clamp(width, 8, 100);
    height = clamp(height, 3, 70);
    x = clamp(x, 0, 100 - width);
    y = clamp(y, 0, 94 - height);

    const otherZones = zoneIds
      .filter((id) => id !== interaction.id && id !== "announcement")
      .map((id) => settings.shorts.zones[id])
      .filter((zone) => zone.visible);
    const xTargets = [0, 50, 100, ...otherZones.flatMap((zone) => [zone.x, zone.x + zone.width / 2, zone.x + zone.width])];
    const yTargets = [0, 50, 94, ...otherZones.flatMap((zone) => [zone.y, zone.y + zone.height / 2, zone.y + zone.height])];
    const findSnap = (candidates: Array<{ value: number; apply: (target: number) => void }>, targets: number[]) => {
      type SnapMatch = { candidate: { value: number; apply: (target: number) => void }; target: number; distance: number };
      let best: SnapMatch | undefined;
      for (const candidate of candidates) {
        for (const target of targets) {
          const distance = Math.abs(candidate.value - target);
          if (distance <= 1.25 && (!best || distance < best.distance)) best = { candidate, target, distance };
        }
      }
      if (!best) return undefined;
      best.candidate.apply(best.target);
      return best.target;
    };
    const right = x + width;
    const bottom = y + height;
    const xCandidates = direction === "move"
      ? [{ value: x, apply: (target: number) => { x = target; } }, { value: x + width / 2, apply: (target: number) => { x = target - width / 2; } }, { value: right, apply: (target: number) => { x = target - width; } }]
      : direction.includes("w")
        ? [{ value: x, apply: (target: number) => { x = target; width = right - target; } }]
        : direction.includes("e")
          ? [{ value: right, apply: (target: number) => { width = target - x; } }]
          : [];
    const yCandidates = direction === "move"
      ? [{ value: y, apply: (target: number) => { y = target; } }, { value: y + height / 2, apply: (target: number) => { y = target - height / 2; } }, { value: bottom, apply: (target: number) => { y = target - height; } }]
      : direction.includes("n")
        ? [{ value: y, apply: (target: number) => { y = target; height = bottom - target; } }]
        : direction.includes("s")
          ? [{ value: bottom, apply: (target: number) => { height = target - y; } }]
          : [];
    const vertical = findSnap(xCandidates, xTargets);
    const horizontal = findSnap(yCandidates, yTargets);
    width = clamp(width, 8, 100);
    height = clamp(height, 3, 70);
    x = clamp(x, 0, 100 - width);
    y = clamp(y, 0, 94 - height);
    setAlignmentGuides({ vertical, horizontal });
    onZoneChange(interaction.id, { x, y, width, height });
  }

  function endInteraction(event: ReactPointerEvent<HTMLElement>) {
    if (!interactionRef.current) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    interactionRef.current = null;
    setAlignmentGuides({});
  }

  const previewEffectOrder = previewOrder ?? actualActiveOrder;
  const displayedOrderEffect = newOrderEffect ?? (showAnimationPreview && previewEffectOrder
    ? { order: previewEffectOrder, kind: previewOrderKind }
    : null);

  function currentOrderBadge(order: Partial<Pick<LiveOrder, "is_first_order" | "ranking_rank" | "payment_method">>) {
    const kind = orderEffectKind(order);
    const effectZone = settings.shorts.newOrder[kind].zone;
    return (
      <b
        className={`${styles.currentOrderBadge} ${styles[`currentOrderBadge${kind[0].toUpperCase()}${kind.slice(1)}`]}`}
        style={{
          "--order-badge-background": effectZone.titleBackgroundColor,
          "--order-badge-color": effectZone.titleColor,
        } as CSSProperties}
      >
        {newOrderBadge(kind)}
      </b>
    );
  }

  return (
    <div className={`${styles.shortsShell} ${variant === "deck" ? styles.deckVariant : ""} ${!preview && !editing ? styles.liveShell : ""}`} aria-label={editing || preview ? "YouTube Shorts 실제 비율 미리보기" : "망고TCG 라이브 오버레이"}>
      <div className={styles.videoStage} ref={stageRef}>
        {zoneIds.map((id) => {
          const orderEffectSettings = displayedOrderEffect
            ? settings.shorts.newOrder[displayedOrderEffect.kind]
            : settings.shorts.newOrder.repeat;
          const configuredZone = id === "announcement" && displayedOrderEffect
            ? orderEffectSettings.zone
            : settings.shorts.zones[id];
          const zone = id === "announcement"
            ? {
              ...configuredZone,
              width: settings.shorts.newOrder.first.zone.width,
              height: settings.shorts.newOrder.first.zone.height,
              x: (100 - settings.shorts.newOrder.first.zone.width) / 2,
              y: 64,
            }
            : configuredZone;
          if (!zone.visible) return null;
          if (id === "announcement" && !displayedOrderEffect) return null;
          const deckAppearance = getDeckAppearance(id, zone);
          const deckRgb = deckAppearance.borderColor.slice(1).match(/.{2}/g)?.map((part) => parseInt(part, 16)).join(", ") ?? "98, 255, 224";
          const style = {
            ...(variant === "deck" ? {
              opacity: deckAppearance.opacity / 100,
              "--deck-theme-rgb": deckRgb,
              "--deck-background-start": deckAppearance.backgroundStart,
              "--deck-background-middle": deckAppearance.backgroundMiddle,
              "--deck-background-end": deckAppearance.backgroundEnd,
              "--deck-title-start": deckAppearance.titleStart,
              "--deck-title-end": deckAppearance.titleEnd,
              "--deck-item-background": deckAppearance.itemBackground,
              "--deck-border-color": deckAppearance.borderColor,
              "--deck-title-color": deckAppearance.titleColor,
              "--deck-text-color": deckAppearance.textColor,
              "--deck-nickname-color": deckAppearance.nicknameColor,
              "--deck-icon-color": deckAppearance.iconColor,
              "--deck-badge-first-color": deckAppearance.badgeFirstColor,
              "--deck-badge-repeat-color": deckAppearance.badgeRepeatColor,
              "--deck-badge-vip-color": deckAppearance.badgeVipColor,
              "--deck-background-alpha": `${deckAppearance.backgroundOpacity}%`,
              "--deck-title-alpha": `${deckAppearance.titleOpacity}%`,
              "--deck-title-scale": String(deckAppearance.titleScale / 100),
              "--deck-text-scale": String(deckAppearance.textScale / 100),
              "--deck-effect-duration": `${deckAppearance.effectSeconds}s`,
              "--deck-flip-duration": `${zone.motionDurationSeconds}s`,
              "--deck-up-direction": deckAppearance.flowDirection === "up" ? "normal" : "reverse",
              "--deck-down-direction": deckAppearance.flowDirection === "down" ? "normal" : "reverse",
              "--deck-waiting-duration": `${deckAppearance.waitingSeconds}s`,
              "--deck-item-gap": `${deckAppearance.itemGap}px`,
              "--deck-item-height": `${deckAppearance.itemHeight}px`,
            } : {}),
            left: `${zone.x}%`, top: `${zone.y}%`, width: `${zone.width}%`, height: `${zone.height}%`,
            zIndex: zone.zIndex,
            "--zone-accent": zone.accent,
            "--zone-title-color": zone.titleColor,
            "--zone-nickname-color": zone.nicknameColor,
            "--zone-text-color": zone.textColor,
            "--zone-open-title-color": zone.openTitleColor,
            "--zone-open-text-color": zone.openTextColor,
            "--zone-open-nickname-color": zone.openNicknameColor,
            "--zone-open-product-color": zone.openProductColor,
            "--zone-open-border-color": zone.openBorderColor,
            "--zone-waiting-title-color": zone.waitingTitleColor,
            "--zone-waiting-text-color": zone.waitingTextColor,
            "--zone-waiting-count-color": zone.waitingCountColor,
            "--zone-waiting-index-color": zone.waitingIndexColor,
            "--zone-waiting-nickname-color": zone.waitingNicknameColor,
            "--zone-waiting-product-color": zone.waitingProductColor,
            "--zone-waiting-border-color": zone.waitingBorderColor,
            "--zone-title-background-color": zone.titleBackgroundColor,
            "--zone-text-background-color": zone.textBackgroundColor,
            "--zone-title-background-opacity": String(zone.titleBackgroundOpacity / 100),
            "--zone-border-color": zone.borderColor,
            "--zone-background-opacity": String(zone.backgroundOpacity / 100),
            "--zone-background-color": zone.backgroundColor,
            "--ranking-ticker-duration": `${zone.tickerDurationSeconds}s`,
            "--hit-ticker-duration": `${zone.tickerDurationSeconds}s`,
            "--hit-item-gap": `${settings.shorts.hitItemGap}px`,
            "--hit-item-height": settings.shorts.hitItemHeight > 0 ? `${settings.shorts.hitItemHeight}px` : "auto",
            "--waiting-ticker-duration": `${zone.tickerDurationSeconds * (variant === "deck" ? 2 : 1)}s`,
            "--waiting-item-gap": `${settings.shorts.waitingItemGap}px`,
            "--opening-empty-opacity": variant === "deck"
              ? String((100 - settings.openingEmptyTransparency) / 100)
              : ".82",
            "--motion-duration": `${zone.motionDurationSeconds}s`,
          } as CSSProperties;
          const value = id === "current"
              ? `${nickname(activeOrder?.youtube_nickname)}\n${activeOrder?.product ?? "대기 중인 주문 없음"} × ${activeOrder?.quantity ?? 0}`
            : fill(zone.template, commonValues);
          return (
            <section
              key={id}
              className={`${variant === "deck" ? `${!deckAppearance.glow ? styles.deckGlowOff : ""} ${!deckAppearance.shine ? styles.deckShineOff : ""} ${!deckAppearance.textBurst ? styles.deckTextBurstOff : ""} ${!deckAppearance.cardFlip ? styles.deckFlipOff : ""}` : ""} ${styles.zone} ${styles[`zone${id[0].toUpperCase()}${id.slice(1)}`]} ${variant === "deck" && id === "current" ? styles.zoneDeck : ""} ${variant === "deck" && id === "ranking" ? styles.zoneDeck : ""} ${variant === "deck" && id === "hit" ? styles.zoneDeckHit : ""} ${id === "announcement" ? styles.zoneToast : ""} ${id === "announcement" && displayedOrderEffect?.kind === "vip" ? styles.rankOneEffect : ""} ${editing ? styles.editableZone : ""} ${id === "announcement" ? styles[`motion${zone.motion.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase()).replace(/^./, (letter) => letter.toUpperCase())}`] ?? "" : ""}`}
              style={style}
              onPointerDown={id === "announcement" ? undefined : (event) => startInteraction(id, "move", event)}
              onPointerMove={moveInteraction}
              onPointerUp={endInteraction}
              onPointerCancel={endInteraction}
            >
              {id !== "announcement" && !(variant === "deck" && id === "ranking") && <strong>{variant === "deck" && id === "hit" && deckAppearance.titleIcon && <span className={styles.deckTitleIcon} aria-hidden="true">{deckAppearance.titleIcon === "💎" ? <svg viewBox="0 0 24 24" fill="none"><path d="M6 3h12l5 6-11 13L1 9l5-6Z" fill="currentColor" fillOpacity=".25" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /><path d="M1 9h22M6 3l6 19 6-19M6 3l6 6 6-6" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg> : deckAppearance.titleIcon}</span>}{zone.title || zoneLabels[id]}</strong>}
              {id === "ranking" ? (
                variant === "deck" ? (
                  <div className={styles.hallOfFameBoard} aria-label="명예의 전당 순위">
                    <header className={styles.hallOfFameHeader}>{deckAppearance.titleIcon && <span className={styles.hallOfFameTitleIcon} aria-hidden="true">{deckAppearance.titleIcon}</span>}<strong>{zone.title === "VIP" ? "명예의 전당" : zone.title || zoneLabels[id]}</strong></header>
                    {displayedRanking[0] ? <div className={styles.hallOfFameFirst}>
                      <b data-rank="1" aria-label="1위"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6l4 4 5-7 5 7 4-4-3 14H6L3 6Z" fill="currentColor" /><path d="M6 22h12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg><i>1</i></b>
                      <em data-text={nickname(displayedRanking[0].youtubeNickname)}><span>{nickname(displayedRanking[0].youtubeNickname)}</span></em>
                    </div> : <p className={styles.hallOfFameEmpty}>랭킹을 불러오는 중입니다</p>}
                    {displayedRanking.length > 1 && <div className={styles.hallOfFameViewport}>
                      <div className={styles.hallOfFameTrack}>
                        {[false, true].map((clone) => <div className={styles.hallOfFameRows} key={clone ? "next-cycle" : "current-cycle"} aria-hidden={clone || undefined}>
                          {displayedRanking.slice(1, 10).map((row) => <div className={styles.hallOfFameRotation} key={`${row.rank}-${clone ? "next" : "current"}`}>
                            <b data-rank={row.rank} style={{ "--rank-icon-strength": `${100 - (row.rank - 2) * 8}%` } as CSSProperties}><i>{row.rank}</i></b>
                            <em>{nickname(row.youtubeNickname)}</em>
                          </div>)}
                        </div>)}
                      </div>
                    </div>}
                  </div>
                ) : <div className={styles.rankingTicker} aria-label="VIP 주문 랭킹 상위 3명">
                  <div className={styles.rankingTickerTrack}>
                    {[...displayedRanking, ...displayedRanking].map((row, index) => (
                      <span className={styles.rankingTickerItem} key={`${row.rank}-${index}`}>
                        <b aria-label={`${row.rank}위`} data-rank={row.rank}><span className={styles.rankingTrophyIcon}>🏆</span><i>{rankingIcon(row.rank)}</i></b><em>{nickname(row.youtubeNickname)}</em>
                      </span>
                    ))}
                    {displayedRanking.length === 0 && <span className={styles.rankingTickerItem}>주문 랭킹을 불러오는 중입니다</span>}
                  </div>
                </div>
              ) : (
                <div className={styles.zoneBody}>
                  {id === "hit" ? (
                    <div className={shouldScrollHitCards ? styles.hitRowsViewport : undefined}>
                      <div className={`${styles.hitRows} ${shouldScrollHitCards ? styles.hitRowsScrolling : ""}`}>
                        {(shouldScrollHitCards ? [false, true] : [false]).map((copy) => (
                          <div className={styles.hitRowsGroup} key={copy ? "next-cycle" : "current-cycle"} aria-hidden={copy || undefined}>
                            {renderedHitCards.map((hit) => {
                              const hitNickname = nickname(hit.youtube_nickname);
                              const label = `◆ ${hitNickname} · ${hit.card}`;
                              return <p key={`${hit.id}-${copy ? "next" : "current"}`}><span data-text={variant === "deck" ? label : undefined} style={textFit(label, 24)}>{label}</span></p>;
                            })}
                          </div>
                        ))}
                        {displayedHitCards.length === 0 && <p className={styles.emptyState}>등록된 히트카드 없음</p>}
                      </div>
                    </div>
                  ) : id === "current" && variant === "deck" ? (
                    <div className={styles.deckCardLayout}>
                      <section key={openingOrder?.id ?? "empty-opening"} className={`${styles.deckOpenCard} ${openingOrder ? styles.deckOpenCardActive : styles.deckOpenCardEmpty}`}>
                        <header className={styles.deckCardHeader}>
                          <b className={styles.deckCardTitle}><span className={styles.deckTitleIcon} aria-hidden="true"><Image src={pikachuCard} alt="" width={28} height={40} sizes="40px" className={styles.deckCardIcon} /></span>{deckAppearance.openTitle}</b>
                          <span className={styles.deckLiveBadge}>{openingOrder ? "진행 중" : "대기"}</span>
                        </header>
                        {openingOrder ? <>
                          <div className={styles.deckProductCard}>
                            <div className={styles.deckOpeningIdentity}>
                              {nickname(openingOrder.youtube_nickname) !== "-" && currentOrderBadge(openingOrder)}
                              <span className={styles.deckOpeningNickname}>{nickname(openingOrder.youtube_nickname)}</span>
                            </div>
                            <CurrentOrderProduct product={openingOrder.product} quantity={openingOrder.quantity} quantitySeparator=" x " durationSeconds={zone.tickerDurationSeconds} />
                          </div>
                        </> : <p className={styles.deckEmptyMessage}>현재 오픈 중인 주문이 없습니다.</p>}
                      </section>
                      <section className={styles.deckWaitingCard}>
                        <header className={styles.deckWaitingHeader}><b className={styles.deckCardTitle}><span className={styles.deckTitleIcon} aria-hidden="true"><Image src={luffyCard} alt="" width={28} height={40} sizes="40px" className={styles.deckCardIcon} /></span>{deckAppearance.waitingTitle}</b><em>{waitingOrders.length}건</em></header>
                        {waitingOrders.length === 0 ? <p className={styles.deckEmptyMessage}>대기 중인 주문이 없습니다.</p> : (
                          <div className={styles.deckWaitingViewport}>
                            <div className={`${styles.deckWaitingRows} ${waitingOrders.length >= 3 ? styles.deckWaitingRowsScrolling : ""}`}>
                              {(waitingOrders.length >= 3 ? [false, true] : [false]).map((copy) => (
                                <div className={styles.deckWaitingGroup} key={copy ? "deck-next-cycle" : "deck-current-cycle"} aria-hidden={copy || undefined}>
                                  {waitingOrders.map((order) => <p key={`${order.id}-${copy ? "next" : "current"}`}><span className={styles.deckWaitingIdentity}>{nickname(order.youtube_nickname) !== "-" && currentOrderBadge(order)}<span className={styles.deckOpeningNickname}>{nickname(order.youtube_nickname)}</span></span><CurrentOrderProduct product={order.product} quantity={order.quantity} quantitySeparator=" x " durationSeconds={zone.tickerDurationSeconds} className={styles.deckWaitingProduct} /></p>)}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </section>
                    </div>
                  ) : id === "current" ? (
                    <div className={styles.currentOrderColumns}>
                      <section className={`${styles.currentOrderColumn} ${styles.openingOrderColumn}`}>
                        <b className={styles.currentOrderHeading}>오픈</b>
                        {openingOrder ? (
                          <p key={openingOrder.id} className={`${styles.completedOrderRow} ${variant === "deck" ? styles.deckOpeningCard : ""} ${nickname(openingOrder.youtube_nickname) === "-" ? styles.orderWithoutNickname : ""}`}>{nickname(openingOrder.youtube_nickname) !== "-" && <span className={styles.currentOrderIdentity}>{currentOrderBadge(openingOrder)}<i style={textFit(nickname(openingOrder.youtube_nickname), 14)}>{nickname(openingOrder.youtube_nickname)}</i></span>}<CurrentOrderProduct product={openingOrder.product} quantity={openingOrder.quantity} /></p>
                        ) : <p className={`${styles.emptyState} ${styles.emptyOrderState}`}>-</p>}
                      </section>
                      <section className={`${styles.currentOrderColumn} ${styles.waitingOrderColumn}`}>
                        <b className={styles.currentOrderHeading}>대기 <em>{waitingOrders.length}건</em></b>
                        <div className={styles.waitingOrderViewport}>
                          <div className={`${styles.waitingOrderRows} ${shouldScrollWaitingOrders ? styles.waitingOrderRowsScrolling : ""}`}>
                            {(shouldScrollWaitingOrders ? [false, true] : [false]).map((copy) => (
                              <div className={styles.waitingOrderRowsGroup} key={copy ? "next-cycle" : "current-cycle"} aria-hidden={copy || undefined}>
                                {waitingOrders.map((order) => {
                                  const orderNickname = nickname(order.youtube_nickname);
                                  return <p key={`${order.id}-${copy ? "next" : "current"}`} className={`${orderNickname === "-" ? styles.orderWithoutNickname : ""} ${variant === "deck" ? styles.deckWaitingCard : ""}`}>{orderNickname !== "-" && <span className={styles.currentOrderIdentity}>{currentOrderBadge(order)}<i style={textFit(orderNickname, 13)}>{orderNickname}</i></span>}<CurrentOrderProduct product={order.product} quantity={order.quantity} /></p>;
                                })}
                                {waitingOrders.length === 0 && <p className={`${styles.emptyState} ${styles.emptyOrderState}`}>-</p>}
                              </div>
                            ))}
                          </div>
                        </div>
                      </section>
                    </div>
                  ) : id === "announcement" && displayedOrderEffect ? (
                    <div className={styles.orderEffectBody}>
                      <span className={`${styles.newOrderBadge} ${styles[`newOrderBadge${displayedOrderEffect.kind[0].toUpperCase()}${displayedOrderEffect.kind.slice(1)}`]}`}>{newOrderBadge(displayedOrderEffect.kind)}</span>
                      <b className={styles.newOrderNickname}>{nickname(displayedOrderEffect.order.youtube_nickname)}</b>
                      <span className={styles.newOrderProduct} style={textFit(`${displayedOrderEffect.order.product} · ×${displayedOrderEffect.order.quantity}`, 25)}>{displayedOrderEffect.order.product} · ×{displayedOrderEffect.order.quantity}</span>
                    </div>
                  ) : <p>{value}</p>}
                </div>
              )}
              {editing && (
                <>
                  <span className={`${styles.resizeHandle} ${styles.handleN}`} onPointerDown={(event) => startInteraction(id, "n", event)} />
                  <span className={`${styles.resizeHandle} ${styles.handleE}`} onPointerDown={(event) => startInteraction(id, "e", event)} />
                  <span className={`${styles.resizeHandle} ${styles.handleS}`} onPointerDown={(event) => startInteraction(id, "s", event)} />
                  <span className={`${styles.resizeHandle} ${styles.handleW}`} onPointerDown={(event) => startInteraction(id, "w", event)} />
                  <span className={`${styles.resizeHandle} ${styles.handleNe}`} onPointerDown={(event) => startInteraction(id, "ne", event)} />
                  <span className={`${styles.resizeHandle} ${styles.handleNw}`} onPointerDown={(event) => startInteraction(id, "nw", event)} />
                  <span className={`${styles.resizeHandle} ${styles.handleSe}`} onPointerDown={(event) => startInteraction(id, "se", event)} />
                  <span className={`${styles.resizeHandle} ${styles.handleSw}`} onPointerDown={(event) => startInteraction(id, "sw", event)} />
                </>
              )}
            </section>
          );
        })}
        {editing && alignmentGuides.vertical != null && <span aria-hidden className={`${styles.alignmentGuide} ${styles.alignmentGuideVertical}`} style={{ left: `${alignmentGuides.vertical}%` }} />}
        {editing && alignmentGuides.horizontal != null && <span aria-hidden className={`${styles.alignmentGuide} ${styles.alignmentGuideHorizontal}`} style={{ top: `${alignmentGuides.horizontal}%` }} />}
        {editing && <section className={styles.commentsZone} aria-label="YouTube 댓글 영역 잠금">
          <b>🔒 YouTube 댓글 영역</b>
          <span>방귀쟁이-nu9e · 안견치는 뮤 가보자</span>
          <span>꾸르밤티 · 와우 보고싶다</span>
          <span>방귀쟁이-nu9e · 네</span>
        </section>}
        {editing && <div className={styles.bottomSafeZone}>🔒 영상 하단 안내 영역 · 잠금</div>}
      </div>
      {editing && <div className={styles.youtubeFixed} aria-label="YouTube 고정 UI 잠금 영역">
        <div>채팅… <span>☺</span></div>
        <nav><b>⌂<small>홈</small></b><b>◁<small>Shorts</small></b><b>＋</b><b>▣<small>구독</small></b><b>◉<small>내 페이지</small></b></nav>
      </div>}
    </div>
  );
}
