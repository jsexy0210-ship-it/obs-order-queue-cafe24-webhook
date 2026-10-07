export const SHORTS_ZONE_IDS = ["hit", "ranking", "current", "announcement"] as const;

export type ShortsZoneId = (typeof SHORTS_ZONE_IDS)[number];

export type DeckAppearanceSettings = {
  backgroundStart: string;
  backgroundMiddle: string;
  backgroundEnd: string;
  titleStart: string;
  titleEnd: string;
  itemBackground: string;
  borderColor: string;
  titleColor: string;
  textColor: string;
  nicknameColor: string;
  iconColor: string;
  titleIcon: string;
  openTitle: string;
  waitingTitle: string;
  badgeFirstColor: string;
  badgeRepeatColor: string;
  badgeVipColor: string;
  opacity: number;
  backgroundOpacity: number;
  titleOpacity: number;
  titleScale: number;
  textScale: number;
  glow: boolean;
  shine: boolean;
  textBurst: boolean;
  cardFlip: boolean;
  effectSeconds: number;
  flowDirection: "up" | "down";
  waitingSeconds: number;
  itemGap: number;
  itemHeight: number;
};

export type ShortsZoneSettings = {
  /** 신규 카드덱에서만 사용하는 표시 설정입니다. */
  deckAppearance?: Partial<DeckAppearanceSettings>;
  visible: boolean;
  title: string;
  /** {{nickname}}, {{product}}, {{quantity}}, {{card}}, {{count}} 토큰을 사용할 수 있습니다. */
  template: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  accent: string;
  titleColor: string;
  nicknameColor: string;
  textColor: string;
  /** 진행상황 카드의 오픈·대기 영역은 색상을 서로 독립적으로 사용합니다. */
  openTitleColor: string;
  openTextColor: string;
  openNicknameColor: string;
  openProductColor: string;
  openBorderColor: string;
  waitingTitleColor: string;
  waitingTextColor: string;
  waitingCountColor: string;
  waitingIndexColor: string;
  waitingNicknameColor: string;
  waitingProductColor: string;
  waitingBorderColor: string;
  titleBackgroundColor: string;
  textBackgroundColor: string;
  /** 제목 배경 불투명도(0: 투명, 100: 불투명) */
  titleBackgroundOpacity: number;
  borderColor: string;
  /** 카드 배경의 불투명도(0: 투명, 100: 불투명) */
  backgroundOpacity: number;
  /** 카드 배경색 */
  backgroundColor: string;
  /** VIP 랭킹 정보가 한 바퀴 흐르는 시간(초). 작을수록 빠릅니다. */
  tickerDurationSeconds: number;
  /** 등장 모션이 끝나는 시간(초). 작을수록 빠릅니다. */
  motionDurationSeconds: number;
  motion: "none" | "fade" | "slide-up" | "left-to-right" | "card-turn";
};

export type NewOrderEffectCopy = {
  durationSeconds: number;
  /** 주문 유형마다 독립적으로 토스트 위치·크기·색상·모션을 설정합니다. */
  zone: ShortsZoneSettings;
};

export type NewOrderEffectSettings = {
  first: NewOrderEffectCopy;
  repeat: NewOrderEffectCopy;
  vip: NewOrderEffectCopy;
};

export type ShortsOverlaySettings = {
  zones: Record<ShortsZoneId, ShortsZoneSettings>;
  newOrder: NewOrderEffectSettings;
  hitItemGap: number;
  hitItemHeight: number;
  waitingItemGap: number;
  openingEmptyTransparency?: number;
};

export type OverlaySettings = {
  orderVisible: boolean;
  panelBackgroundVisible: boolean;
  panelBackgroundTransparency: number;
  openingEmptyTransparency: number;
  scales: { order: number; hit: number; right: number };
  widths: { order: number; hit: number; right: number };
  position: {
    orderX: number;
    orderY: number;
    hitX: number;
    hitY: number;
    rightX: number;
    rightY: number;
  };
  colors: {
    orderAccent: string;
    hitAccent: string;
    liveAccent: string;
    panelBackground: string;
    primaryText: string;
    orderText: string;
    hitHeaderText: string;
    hitBuyerText: string;
    hitCardText: string;
    liveHeaderText: string;
    liveBuyerText: string;
    liveProductText: string;
    queueBuyerText: string;
    queueProductText: string;
    quantityText: string;
    timerText: string;
  };
  /** 실제 Shorts 영상(9:16) 안에서만 쓰는 새 오버레이 영역 설정입니다. */
  shorts: ShortsOverlaySettings;
  /** 기본 오버레이를 유지하면서 편집할 수 있는 독립 신규 오버레이 프로필입니다. */
  newOverlay?: ShortsOverlaySettings;
};

const DEFAULT_NEW_ORDER_ZONE: ShortsZoneSettings = {
  visible: true,
  title: "N",
  template: "",
  x: 5,
  y: 64,
  width: 90,
  height: 7,
  zIndex: 5,
  accent: "#ed8e07",
  titleColor: "#ffffff",
  nicknameColor: "#ffffff",
  textColor: "#ffffff",
  openTitleColor: "#ffffff",
  openTextColor: "#ffffff",
  openNicknameColor: "#ffffff",
  openProductColor: "#ffffff",
  openBorderColor: "#ed8e07",
  waitingTitleColor: "#fff45c",
  waitingTextColor: "#ffffff",
  waitingCountColor: "#ffffff",
  waitingIndexColor: "#fff45c",
  waitingNicknameColor: "#fff45c",
  waitingProductColor: "#ffffff",
  waitingBorderColor: "#ed8e07",
  titleBackgroundColor: "#ed8e07",
  textBackgroundColor: "#04080e",
  titleBackgroundOpacity: 90,
  borderColor: "#ed8e07",
  backgroundOpacity: 90,
  backgroundColor: "#05090f",
  tickerDurationSeconds: 20,
  motionDurationSeconds: 0.7,
  motion: "slide-up",
};

export const DEFAULT_OVERLAY_SETTINGS: OverlaySettings = {
  orderVisible: true,
  panelBackgroundVisible: true,
  panelBackgroundTransparency: 0,
  openingEmptyTransparency: 40,
  scales: { order: 1, hit: 1, right: 1 },
  widths: { order: 52, hit: 46, right: 63 },
  position: { orderX: 0, orderY: 0, hitX: 0, hitY: 0, rightX: 0, rightY: 0 },
  colors: {
    orderAccent: "#ffffff",
    hitAccent: "#ecba17",
    liveAccent: "#6838ea",
    panelBackground: "#05090f",
    primaryText: "#ffffff",
    orderText: "#ffffff",
    hitHeaderText: "#ffffff",
    hitBuyerText: "#fff06a",
    hitCardText: "#ffffff",
    liveHeaderText: "#ffffff",
    liveBuyerText: "#fff45c",
    liveProductText: "#ffffff",
    queueBuyerText: "#fff06a",
    queueProductText: "#ffffff",
    quantityText: "#e8ff42",
    timerText: "#ffffff",
  },
  shorts: {
    hitItemGap: 6,
    hitItemHeight: 0,
    waitingItemGap: 6,
    zones: {
      hit: {
        visible: true,
        title: "HIT&RGB",
        template: "",
        x: 3,
        y: 3,
        width: 45,
        height: 16,
        zIndex: 3,
        accent: "#ff9214",
        titleColor: "#ffffff",
        nicknameColor: "#ffffff",
        textColor: "#ffffff",
        openTitleColor: "#ffffff",
        openTextColor: "#ffffff",
        openNicknameColor: "#ffffff",
        openProductColor: "#ffffff",
        openBorderColor: "#ff9214",
        waitingTitleColor: "#fff45c",
        waitingTextColor: "#ffffff",
        waitingCountColor: "#ffffff",
        waitingIndexColor: "#fff45c",
        waitingNicknameColor: "#fff45c",
        waitingProductColor: "#ffffff",
        waitingBorderColor: "#ff9214",
        titleBackgroundColor: "#ff9214",
        textBackgroundColor: "#04080e",
        titleBackgroundOpacity: 88,
        borderColor: "#ff9214",
        backgroundOpacity: 88,
        backgroundColor: "#05090f",
        tickerDurationSeconds: 20,
        motionDurationSeconds: 0.7,
        motion: "none",
      },
      ranking: {
        visible: true,
        title: "명예의 전당",
        template: "순위 · 닉네임 · 총 주문 건수",
        x: 3,
        y: 21,
        width: 94,
        height: 3.6,
        zIndex: 2,
        accent: "#20c878",
        titleColor: "#54f4a0",
        nicknameColor: "#ffffff",
        textColor: "#ffffff",
        openTitleColor: "#ffffff",
        openTextColor: "#ffffff",
        openNicknameColor: "#ffffff",
        openProductColor: "#ffffff",
        openBorderColor: "#20c878",
        waitingTitleColor: "#fff45c",
        waitingTextColor: "#ffffff",
        waitingCountColor: "#ffffff",
        waitingIndexColor: "#fff45c",
        waitingNicknameColor: "#fff45c",
        waitingProductColor: "#ffffff",
        waitingBorderColor: "#20c878",
        titleBackgroundColor: "#041d12",
        textBackgroundColor: "#041d12",
        titleBackgroundOpacity: 94,
        borderColor: "#20c878",
        backgroundOpacity: 94,
        backgroundColor: "#041d12",
        tickerDurationSeconds: 20,
        motionDurationSeconds: 0.7,
        motion: "none",
      },
      current: {
        visible: true,
        title: "오픈 대기",
        template: "",
        x: 70,
        y: 31,
        width: 27,
        height: 16,
        zIndex: 3,
        accent: "#28b7ff",
        titleColor: "#ffffff",
        nicknameColor: "#ffffff",
        textColor: "#ffffff",
        openTitleColor: "#ffffff",
        openTextColor: "#ffffff",
        openNicknameColor: "#ffffff",
        openProductColor: "#ffffff",
        openBorderColor: "#28b7ff",
        waitingTitleColor: "#fff45c",
        waitingTextColor: "#ffffff",
        waitingCountColor: "#ffffff",
        waitingIndexColor: "#fff45c",
        waitingNicknameColor: "#fff45c",
        waitingProductColor: "#ffffff",
        waitingBorderColor: "#28b7ff",
        titleBackgroundColor: "#086f9a",
        textBackgroundColor: "#04080e",
        titleBackgroundOpacity: 88,
        borderColor: "#28b7ff",
        backgroundOpacity: 88,
        backgroundColor: "#05090f",
        tickerDurationSeconds: 20,
        motionDurationSeconds: 0.7,
        motion: "none",
      },
      announcement: {
        ...DEFAULT_NEW_ORDER_ZONE,
      },
    },
    newOrder: {
      first: { durationSeconds: 1, zone: { ...DEFAULT_NEW_ORDER_ZONE } },
      repeat: { durationSeconds: 1, zone: { ...DEFAULT_NEW_ORDER_ZONE } },
      vip: { durationSeconds: 1, zone: { ...DEFAULT_NEW_ORDER_ZONE } },
    },
  },
};

const DEFAULT_DECK_APPEARANCE: DeckAppearanceSettings = {
  backgroundStart: "#bb14ab", backgroundMiddle: "#5711b8", backgroundEnd: "#f01c77",
  titleStart: "#d91cd0", titleEnd: "#ec278d", itemBackground: "#2f0c6e",
  borderColor: "#ff44da", titleColor: "#fff2fd", textColor: "#ffffff", nicknameColor: "#ffffff", iconColor: "#ffd2f8",
  titleIcon: "🏆", openTitle: "오픈", waitingTitle: "대기",
  badgeFirstColor: "#ff5368", badgeRepeatColor: "#27d7ae", badgeVipColor: "#ffe786",
  opacity: 100, backgroundOpacity: 98, titleOpacity: 100, titleScale: 100, textScale: 100,
  glow: true, shine: true, textBurst: true, cardFlip: true, effectSeconds: 3,
  flowDirection: "up", waitingSeconds: 40, itemGap: 4, itemHeight: 0,
};

export function getDeckAppearance(id: ShortsZoneId, zone: ShortsZoneSettings): DeckAppearanceSettings {
  const defaults = id === "hit" ? {
    ...DEFAULT_DECK_APPEARANCE,
    backgroundStart: "#00a4d1", backgroundMiddle: "#0b41c9", backgroundEnd: "#6218ca",
    titleStart: "#00bddd", titleEnd: "#7626db", itemBackground: "#082466",
    borderColor: "#00d5ff", titleColor: "#f0fcff", iconColor: "#c3fbff", titleIcon: "💎", flowDirection: "down" as const,
  } : id === "current" ? {
    ...DEFAULT_DECK_APPEARANCE,
    backgroundStart: "#00b887", backgroundMiddle: "#007ab4", backgroundEnd: "#3b42d3",
    titleStart: "#30edb9", titleEnd: "#128fbf", itemBackground: "#052b37",
    borderColor: "#62ffe0", titleColor: "#f2fff9", textColor: "#f2fff9", nicknameColor: "#f2fff9", iconColor: "#c5fff3",
    titleIcon: "", backgroundOpacity: 97, flowDirection: "down" as const,
    waitingSeconds: Math.min(120, zone.tickerDurationSeconds * 2),
  } : DEFAULT_DECK_APPEARANCE;
  return { ...defaults, ...zone.deckAppearance };
}

const defaultShorts = DEFAULT_OVERLAY_SETTINGS.shorts;
const deckColors = {
  accent: "#e73531",
  borderColor: "#f4bd51",
  titleBackgroundColor: "#7c1718",
  backgroundColor: "#260b0c",
};

/** 영상의 레드·골드 카드 프레임용 독립 기본값. 기존 설정과 참조를 공유하지 않습니다. */
export const DEFAULT_NEW_OVERLAY_SETTINGS: ShortsOverlaySettings = {
  ...defaultShorts,
  openingEmptyTransparency: 40,
  zones: {
    hit: {
      ...defaultShorts.zones.hit,
      x: 3,
      y: 31,
      width: 45,
      height: 16,
    },
    ranking: {
      ...defaultShorts.zones.ranking,
      title: "명예의 전당",
      x: 3,
      y: 8,
      width: 45,
      height: 21,
      tickerDurationSeconds: 1.2,
    },
    current: {
      ...defaultShorts.zones.current,
      x: 66,
      y: 22,
      width: 31,
      height: 46,
      tickerDurationSeconds: 8,
      accent: deckColors.accent,
      titleColor: "#fff1c2",
      nicknameColor: "#fff1c2",
      textColor: "#fff4d2",
      openBorderColor: deckColors.borderColor,
      waitingBorderColor: deckColors.borderColor,
      titleBackgroundColor: deckColors.titleBackgroundColor,
      backgroundColor: deckColors.backgroundColor,
      borderColor: deckColors.borderColor,
      backgroundOpacity: 94,
      titleBackgroundOpacity: 96,
    },
    announcement: { ...defaultShorts.zones.announcement },
  },
  newOrder: {
    first: { ...defaultShorts.newOrder.first, zone: { ...defaultShorts.newOrder.first.zone } },
    repeat: { ...defaultShorts.newOrder.repeat, zone: { ...defaultShorts.newOrder.repeat.zone } },
    vip: { ...defaultShorts.newOrder.vip, zone: { ...defaultShorts.newOrder.vip.zone } },
  },
};
