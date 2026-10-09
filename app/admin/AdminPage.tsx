"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ADMIN_ROUTES } from "./adminRoutes";
import { type LiveOrder } from "@/app/useLiveCardBreak";
import { useAdminLiveCardBreak } from "./useAdminLiveCardBreak";
import { getDevelopmentLiveOverlayReference } from "./developmentHomeSamples";
import GlobalLoadingOverlay from "@/app/GlobalLoadingOverlay";
import OrderHistoryContent, { HitCardHistoryContent } from "@/app/order-history/OrderHistoryContent";
import ShortsOverlayFrame from "@/app/overlay-shorts/ShortsOverlayFrame";
import { DEFAULT_NEW_OVERLAY_SETTINGS, DEFAULT_OVERLAY_SETTINGS, getDeckAppearance, type DeckAppearanceSettings, type OverlaySettings, type ShortsOverlaySettings, type ShortsZoneId } from "@/lib/overlaySettings";
import RewardSettingsPanel from "./RewardSettingsPanel";
import RewardLedgerModal from "./RewardLedgerModal";
import OrderDashboard, { DashboardRangePicker, type DashboardRange } from "./OrderDashboard";
import OrderRankingPanel from "./OrderRankingPanel";
import styles from "./admin.module.css";

const DEFAULT_TIMER_SECONDS = 60;
const BASIC_SHORTS_ZONE_IDS: ShortsZoneId[] = ["ranking", "hit", "current"];
const ORDER_ANIMATION_ZONE_IDS: ShortsZoneId[] = ["announcement"];
const WAITING_PAGE_SIZE = 3;
const CANCELLED_ORDER_PAGE_SIZE = 3;
const HIT_PAGE_SIZE = 5;
const TOAST_DISPLAY_MS = 5000;
const SITE_LINKS = [
  { label: "망고TCG 사이트", href: "https://mangotcg.com/" },
  { label: "쇼핑몰 관리자", href: "https://dhdudals5555.cafe24.com/disp/admin/shop1/main/dashboard" },
  { label: "호스팅 관리자", href: "https://hosting.cafe24.com/?controller=myservice_hosting_main" },
  { label: "개발자 센터", href: "https://developers.cafe24.com/admin/dashboard/main/front/app" },
] as const;

type Toast = { id: number; eventKey: string; title: string; userId: string; product: string };
type PaymentBadge = { label: "카드" | "무통장" | "카드+적립금" | "무통장+적립금"; kind: "card" | "bank" | "card-point" | "bank-point" };
type QueueHistoryKind = "opening" | "waiting" | "pending";

function getPaymentBadge(order: Pick<LiveOrder, "payment_method" | "payment_gateway_name" | "easypay_name">): PaymentBadge {
  const payment = [order.payment_method, order.payment_gateway_name, order.easypay_name].filter(Boolean).join(" ").toLowerCase();
  const isBankTransfer = /cash|bank|deposit|무통/.test(payment);
  const usesReward = /point|mileage|reserve|reward|적립금|예치금/.test(payment);
  if (isBankTransfer && usesReward) return { label: "무통장+적립금", kind: "bank-point" };
  if (isBankTransfer) return { label: "무통장", kind: "bank" };
  if (usesReward) return { label: "카드+적립금", kind: "card-point" };
  return { label: "카드", kind: "card" };
}

function formatOrderAmount(order: LiveOrder) {
  return `${(order.actual_amount ?? order.unit_price * order.quantity).toLocaleString("ko-KR")}원`;
}

function formatYoutubeNickname(youtubeNickname: string) {
  return `유튜브 닉네임 - ${youtubeNickname}`;
}

function parseOrderDate(value: string) {
  const normalized = value.replace(" ", "T");
  return new Date(/[zZ]|[+-]\d{2}:\d{2}$/.test(normalized) ? normalized : `${normalized}Z`);
}

function formatCompletedTime(completedAt: string | null) {
  if (!completedAt) return "완료 시각 미확인";
  const date = parseOrderDate(completedAt);
  if (Number.isNaN(date.getTime())) return "완료 시각 미확인";
  return date.toLocaleTimeString("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
}

function isTodayInKorea(value: string | null) {
  if (!value) return false;
  const date = parseOrderDate(value);
  if (Number.isNaN(date.getTime())) return false;
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" });
  return formatter.format(date) === formatter.format(new Date());
}

export default function AdminPage() {
  const router = useRouter();
  const pathname = usePathname();
  const showHistory = pathname.startsWith(ADMIN_ROUTES.history);
  const showRanking = pathname === ADMIN_ROUTES.ranking;
  const showSettings = pathname === ADMIN_ROUTES.settings;
  const showOverlayPreview = pathname.startsWith(ADMIN_ROUTES.overlay);
  const showHitHistory = pathname === ADMIN_ROUTES.hitHistory;
  const showRewardLedger = pathname === ADMIN_ROUTES.rewards;
  const overlayPreviewMode = pathname === ADMIN_ROUTES.basicOverlay ? "basic" : pathname === ADMIN_ROUTES.orderAlerts ? "animation" : "new";
  const { opening, completedToday, manualOrders, waiting, pendingPayments, cancelledOrders, hitCards, overlaySettings, loading: liveLoading } = useAdminLiveCardBreak();

  const [form, setForm] = useState({
    userId: "",
    product: "",
    quantity: 1,
    unitPrice: 15000,
    tier: "",
    youtubeNickname: "",
    pointsSpentAmount: 0,
    finalPaymentAmount: "",
    includeRevenue: false,
  });
  const [editingHitId, setEditingHitId] = useState<number | null>(null);
  const [savingHit, setSavingHit] = useState(false);
  const [hitForm, setHitForm] = useState({ card: "", youtubeNickname: "" });
  const [showManualOrder, setShowManualOrder] = useState(false);
  const [dashboardRange, setDashboardRange] = useState<DashboardRange>("day");
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [showHitRegistration, setShowHitRegistration] = useState(false);
  const [showLegacyOverlayMenu, setShowLegacyOverlayMenu] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [siteMenuOpen, setSiteMenuOpen] = useState(false);
  const [orderVisibleSetting, setOrderVisibleSetting] = useState(overlaySettings.orderVisible);
  const [savingOrderVisible, setSavingOrderVisible] = useState(false);
  const [editingOverlay, setEditingOverlay] = useState(false);
  const [selectedShortsZone, setSelectedShortsZone] = useState<ShortsZoneId>("current");
  const [selectedNewOrderCopy, setSelectedNewOrderCopy] = useState<"first" | "repeat" | "vip">("first");
  const [shortsSettings, setShortsSettings] = useState<OverlaySettings>(DEFAULT_OVERLAY_SETTINGS);
  const [newOverlaySettings, setNewOverlaySettings] = useState<ShortsOverlaySettings>(DEFAULT_NEW_OVERLAY_SETTINGS);
  const [savingShortsSettings, setSavingShortsSettings] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [orderAlertsEnabled, setOrderAlertsEnabled] = useState(false);
  const [notificationPermission, setNotificationPermission] = useState<
    NotificationPermission | "unsupported"
  >("default");
  const [waitingPage, setWaitingPage] = useState(1);
  const [pendingPaymentPage, setPendingPaymentPage] = useState(1);
  const [cancelledOrderPage, setCancelledOrderPage] = useState(1);
  const [hitPage, setHitPage] = useState(1);
  const [confirmingPaymentId, setConfirmingPaymentId] = useState<number | null>(null);
  const [queueHistoryModal, setQueueHistoryModal] = useState<QueueHistoryKind | null>(null);

  const waitingPageCount = Math.max(1, Math.ceil(waiting.length / WAITING_PAGE_SIZE));
  const pendingPaymentPageCount = Math.max(1, Math.ceil(pendingPayments.length / WAITING_PAGE_SIZE));
  const cancelledOrderPageCount = Math.max(1, Math.ceil(cancelledOrders.length / CANCELLED_ORDER_PAGE_SIZE));
  const hitPageCount = Math.max(1, Math.ceil(hitCards.length / HIT_PAGE_SIZE));
  const pagedWaiting = waiting.slice(
    (waitingPage - 1) * WAITING_PAGE_SIZE,
    waitingPage * WAITING_PAGE_SIZE
  );
  const pagedPendingPayments = pendingPayments.slice(
    (pendingPaymentPage - 1) * WAITING_PAGE_SIZE,
    pendingPaymentPage * WAITING_PAGE_SIZE
  );
  const pagedCancelledOrders = cancelledOrders.slice(
    (cancelledOrderPage - 1) * CANCELLED_ORDER_PAGE_SIZE,
    cancelledOrderPage * CANCELLED_ORDER_PAGE_SIZE
  );
  const pagedHitCards = hitCards.slice((hitPage - 1) * HIT_PAGE_SIZE, hitPage * HIT_PAGE_SIZE);

  const todayWaiting = waiting.filter((order) => isTodayInKorea(order.created_at));
  const todayPendingPayments = pendingPayments.filter((order) => isTodayInKorea(order.created_at));
  const queueHistory = queueHistoryModal === "opening"
    ? { title: "오늘 최종 오픈", empty: "오늘 최종 오픈 이력이 없습니다.", orders: completedToday }
    : queueHistoryModal === "waiting"
      ? { title: "대기 주문 · 오늘 이력", empty: "오늘 접수된 대기 주문이 없습니다.", orders: todayWaiting }
      : queueHistoryModal === "pending"
        ? { title: "무통장 입금 전 · 오늘 이력", empty: "오늘 접수된 무통장 입금 전 주문이 없습니다.", orders: todayPendingPayments }
        : null;

  const editableShortsZoneIds = overlayPreviewMode === "animation" ? ORDER_ANIMATION_ZONE_IDS : BASIC_SHORTS_ZONE_IDS;
  const selectedShortsZoneId = editableShortsZoneIds.includes(selectedShortsZone)
    ? selectedShortsZone
    : editableShortsZoneIds[0];
  const selectedNewOrderSettings = shortsSettings.shorts.newOrder[selectedNewOrderCopy];
  const activeShortsProfile = overlayPreviewMode === "new" ? newOverlaySettings : shortsSettings.shorts;
  const selectedShortsZoneSettings = overlayPreviewMode === "animation"
    ? selectedNewOrderSettings.zone
    : activeShortsProfile.zones[selectedShortsZoneId];
  const selectedDeckAppearance = getDeckAppearance(selectedShortsZoneId, selectedShortsZoneSettings);

  const seenOrderStates = useRef<Map<number, "pending" | "paid"> | null>(null);
  const alertedOrderStates = useRef<Map<number, "pending" | "paid"> | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    setOrderVisibleSetting(overlaySettings.orderVisible);
  }, [overlaySettings.orderVisible]);

  useEffect(() => {
    if (!editingOverlay) setShortsSettings((current) => ({
      ...overlaySettings,
      shorts: {
        ...overlaySettings.shorts,
        newOrder: {
          first: overlaySettings.shorts.newOrder.first,
          repeat: {
            ...overlaySettings.shorts.newOrder.repeat,
            zone: {
              ...overlaySettings.shorts.newOrder.repeat.zone,
              width: overlaySettings.shorts.newOrder.first.zone.width,
              height: overlaySettings.shorts.newOrder.first.zone.height,
            },
          },
          vip: {
            ...overlaySettings.shorts.newOrder.vip,
            zone: {
              ...overlaySettings.shorts.newOrder.vip.zone,
              width: overlaySettings.shorts.newOrder.first.zone.width,
              height: overlaySettings.shorts.newOrder.first.zone.height,
            },
          },
        },
      },
    }));
  }, [editingOverlay, overlaySettings]);

  useEffect(() => {
    if (!editingOverlay) {
      const saved = getDevelopmentLiveOverlayReference(overlaySettings.newOverlay ?? DEFAULT_NEW_OVERLAY_SETTINGS);
      const legacyRanking = saved.zones.ranking.title === "VIP";
      setNewOverlaySettings(legacyRanking ? {
        ...saved,
        zones: { ...saved.zones, ranking: { ...saved.zones.ranking, title: "명예의 전당", tickerDurationSeconds: saved.zones.ranking.tickerDurationSeconds === 20 ? 1.2 : saved.zones.ranking.tickerDurationSeconds } },
      } : saved);
    }
  }, [editingOverlay, overlaySettings]);

  useEffect(() => {
    const savedTheme = window.localStorage.getItem("mangotcg-admin-theme");
    if (savedTheme === "light" || savedTheme === "dark") setTheme(savedTheme);
  }, []);


  function toggleTheme() {
    setTheme((current) => {
      const next = current === "dark" ? "light" : "dark";
      window.localStorage.setItem("mangotcg-admin-theme", next);
      return next;
    });
  }

  async function toggleOrderVisibilitySetting() {
    setSavingOrderVisible(true);
    try {
      const currentResponse = await fetch("/api/overlay-settings");
      if (!currentResponse.ok) throw new Error("load failed");
      const currentSettings = await currentResponse.json() as OverlaySettings;
      const nextVisible = !currentSettings.orderVisible;
      const response = await fetch("/api/overlay-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...currentSettings, orderVisible: nextVisible }),
      });
      if (!response.ok) throw new Error("save failed");
      setOrderVisibleSetting(nextVisible);
    } catch {
      window.alert("주문 접수 설정 저장에 실패했습니다.");
    } finally {
      setSavingOrderVisible(false);
    }
  }

  const playOrderChime = useCallback(() => {
    const context = audioContextRef.current;
    if (!context || context.state !== "running") return;

    const now = context.currentTime;
    const notes = [
      { frequency: 659.25, delay: 0 },
      { frequency: 987.77, delay: 0.16 },
    ];

    notes.forEach(({ frequency, delay }) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const start = now + delay;

      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(frequency, start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.18, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.3);

      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.32);
    });
  }, []);

  async function toggleOrderAlerts() {
    if (orderAlertsEnabled) {
      setOrderAlertsEnabled(false);
      const context = audioContextRef.current;
      audioContextRef.current = null;
      if (context && context.state !== "closed") {
        await context.close().catch(() => undefined);
      }
      return;
    }

    if (typeof window.AudioContext === "undefined") {
      window.alert("이 브라우저에서는 소리 알림을 사용할 수 없습니다.");
      return;
    }

    const context = new window.AudioContext();
    audioContextRef.current = context;

    const permissionPromise: Promise<NotificationPermission | "unsupported"> =
      typeof window.Notification !== "undefined"
        ? Notification.permission === "default"
          ? Notification.requestPermission()
          : Promise.resolve(Notification.permission)
        : Promise.resolve("unsupported");

    const [, nextPermission] = await Promise.all([
      context.resume().catch(() => undefined),
      permissionPromise,
    ]);

    setNotificationPermission(nextPermission);
    setOrderAlertsEnabled(context.state === "running");

    if (context.state === "running") {
      playOrderChime();
    }

    if (nextPermission === "granted") {
      const testNotification = new Notification("망고TCG 주문 알림", {
        body: "새 주문이 들어오면 소리와 함께 Windows 알림을 표시합니다.",
        tag: "mangotcg-order-alert-test",
        silent: true,
      });
      window.setTimeout(() => testNotification.close(), 4000);
    }
  }

  useEffect(() => {
    if (typeof window.Notification !== "undefined") {
      setNotificationPermission(Notification.permission);
    } else {
      setNotificationPermission("unsupported");
    }

    return () => {
      const context = audioContextRef.current;
      audioContextRef.current = null;
      if (context && context.state !== "closed") {
        void context.close();
      }
    };
  }, []);

  // 최초 데이터 로드 후 무통장 신규 주문과 입금 완료 전환을 토스트로 표시합니다.
  useEffect(() => {
    if (liveLoading) return;
    const activeOrders = [
      ...pendingPayments.map((order) => ({ order, state: "pending" as const })),
      ...waiting.map((order) => ({ order, state: "paid" as const })),
    ];
    const currentStates = new Map(activeOrders.map(({ order, state }) => [order.id, state]));
    if (seenOrderStates.current === null) {
      seenOrderStates.current = currentStates;
      return;
    }
    const previousStates = seenOrderStates.current;
    seenOrderStates.current = currentStates;
    const events = activeOrders.filter(({ order, state }) => {
      const previous = previousStates.get(order.id);
      return previous === undefined || (previous === "pending" && state === "paid");
    }).map(({ order, state }) => ({
      id: order.id,
      eventKey: `${order.id}-${state}`,
      title: state === "pending" ? "무통장 입금 전 신규 주문" : previousStates.get(order.id) === "pending" ? "주문 입금 완료" : "새 주문 접수",
      userId: order.user_id,
      product: order.product,
    }));
    if (events.length === 0) return;
    setToasts((current) => [...current, ...events]);
    events.forEach((event) => window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.eventKey !== event.eventKey));
    }, TOAST_DISPLAY_MS));
  }, [liveLoading, pendingPayments, waiting]);

  useEffect(() => {
    if (!orderAlertsEnabled) {
      alertedOrderStates.current = null;
      return;
    }
    let cancelled = false;
    const checkOrders = async () => {
      try {
        const response = await fetch("/api/orders", { cache: "no-store" });
        if (!response.ok) return;
        const data = await response.json() as {
          pendingPayments?: LiveOrder[];
          waiting?: LiveOrder[];
          rewardSummaries?: Record<string, { issue?: { amount: number; status: string } }>;
        };
        if (cancelled) return;
        const next = new Map<number, "pending" | "paid">();
        for (const order of data.pendingPayments ?? []) next.set(order.id, "pending");
        for (const order of data.waiting ?? []) next.set(order.id, "paid");
        const previous = alertedOrderStates.current;
        alertedOrderStates.current = next;
        if (previous === null) return;
        for (const order of [...(data.pendingPayments ?? []), ...(data.waiting ?? [])]) {
          if (order.source !== "cafe24") continue;
          const status = next.get(order.id)!;
          const before = previous.get(order.id);
          if (before === status || (status === "pending" && before !== undefined)) continue;
          playOrderChime();
          if (typeof window.Notification === "undefined" || Notification.permission !== "granted") continue;
          const paid = status === "paid";
          const summary = order.external_order_id ? data.rewardSummaries?.[order.external_order_id]?.issue : undefined;
          const issuedPoints = summary?.status === "succeeded" ? `\n카페24 적립금 지급 ${summary.amount.toLocaleString("ko-KR")}원` : "";
          const createdAt = new Date(`${order.created_at.replace(" ", "T")}Z`).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
          const amount = (order.actual_amount ?? order.unit_price * order.quantity).toLocaleString("ko-KR");
          const payment = getPaymentBadge(order).label;
          const notice = new Notification(paid ? "주문 입금 완료" : "무통장 입금 전 신규 주문", {
            body: [
              `주문번호 ${order.external_order_id ?? "-"} · ${createdAt}`,
              `구매자 ${order.user_id} · 유튜브 ${order.youtube_nickname ?? "-"}`,
              `${order.product} × ${order.quantity} · ${amount}원`,
              `${payment} · ${paid ? "입금 완료" : "입금 전"} · ${order.tier || "등급 미확인"}${issuedPoints}`,
            ].join("\n"),
            tag: `mangotcg-order-${order.external_order_id ?? order.id}-${status}`,
            requireInteraction: true,
            silent: true,
          });
          notice.onclick = () => { window.focus(); notice.close(); };
        }
      } catch {
        // 주문 알림 상태 조회가 일시 실패하면 다음 간격에서 다시 확인합니다.
      }
    };
    void checkOrders();
    const timer = window.setInterval(() => void checkOrders(), 3000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [orderAlertsEnabled, playOrderChime]);

  // 이력 모달이 열려 있는 동안에는 뒤쪽 화면이 같이 스크롤되지 않도록 막습니다.
  useEffect(() => {
    document.body.style.overflow = showHitHistory || showHitRegistration || showRewardLedger || showManualOrder || queueHistoryModal ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [showHitHistory, showHitRegistration, showRewardLedger, showManualOrder, queueHistoryModal]);

  useEffect(() => {
    setWaitingPage((page) => Math.min(page, waitingPageCount));
  }, [waitingPageCount]);

  useEffect(() => {
    setPendingPaymentPage((page) => Math.min(page, pendingPaymentPageCount));
  }, [pendingPaymentPageCount]);

  useEffect(() => {
    setCancelledOrderPage((page) => Math.min(page, cancelledOrderPageCount));
  }, [cancelledOrderPageCount]);

  useEffect(() => {
    setHitPage((page) => Math.min(page, hitPageCount));
  }, [hitPageCount]);

  function closeOverlayPreview() {
    setEditingOverlay(false);
    setSelectedShortsZone("current");
    setShowLegacyOverlayMenu(false);
    navigateAdmin(ADMIN_ROUTES.home);
  }

  function updateDeckAppearance<K extends keyof DeckAppearanceSettings>(key: K, value: DeckAppearanceSettings[K]) {
    setNewOverlaySettings((current) => {
      const zone = current.zones[selectedShortsZoneId];
      return { ...current, zones: { ...current.zones, [selectedShortsZoneId]: { ...zone, deckAppearance: { ...getDeckAppearance(selectedShortsZoneId, zone), [key]: value } } } };
    });
  }

  function updateShortsZone<K extends keyof OverlaySettings["shorts"]["zones"][ShortsZoneId]>(
    id: ShortsZoneId,
    key: K,
    value: OverlaySettings["shorts"]["zones"][ShortsZoneId][K]
  ) {
    if (overlayPreviewMode === "animation" && id === "announcement") {
      if (key === "width" || key === "height") {
        setShortsSettings((current) => ({
          ...current,
          shorts: {
            ...current.shorts,
            newOrder: {
              first: { ...current.shorts.newOrder.first, zone: { ...current.shorts.newOrder.first.zone, [key]: value } },
              repeat: { ...current.shorts.newOrder.repeat, zone: { ...current.shorts.newOrder.repeat.zone, [key]: value } },
              vip: { ...current.shorts.newOrder.vip, zone: { ...current.shorts.newOrder.vip.zone, [key]: value } },
            },
          },
        }));
        return;
      }
      setShortsSettings((current) => ({
        ...current,
        shorts: {
          ...current.shorts,
          newOrder: {
            ...current.shorts.newOrder,
            [selectedNewOrderCopy]: {
              ...current.shorts.newOrder[selectedNewOrderCopy],
              zone: { ...current.shorts.newOrder[selectedNewOrderCopy].zone, [key]: value },
            },
          },
        },
      }));
      return;
    }
    if (overlayPreviewMode === "new") {
      setNewOverlaySettings((current) => ({
        ...current,
        zones: { ...current.zones, [id]: { ...current.zones[id], [key]: value } },
      }));
      return;
    }
    setShortsSettings((current) => ({
      ...current,
      shorts: {
        ...current.shorts,
        zones: {
          ...current.shorts.zones,
          [id]: { ...current.shorts.zones[id], [key]: value },
        },
      },
    }));
  }

  function updateNewOrderEffect<K extends keyof OverlaySettings["shorts"]["newOrder"][typeof selectedNewOrderCopy]>(
    key: K,
    value: OverlaySettings["shorts"]["newOrder"][typeof selectedNewOrderCopy][K]
  ) {
    setShortsSettings((current) => ({
      ...current,
      shorts: {
        ...current.shorts,
        newOrder: {
          ...current.shorts.newOrder,
          [selectedNewOrderCopy]: {
            ...current.shorts.newOrder[selectedNewOrderCopy],
            [key]: value,
          },
        },
      },
    }));
  }

  async function saveShortsSettings() {
    const unifiedSettings: OverlaySettings = {
      ...shortsSettings,
      newOverlay: newOverlaySettings,
      shorts: {
        ...shortsSettings.shorts,
        newOrder: {
          first: shortsSettings.shorts.newOrder.first,
          repeat: { ...shortsSettings.shorts.newOrder.repeat, zone: { ...shortsSettings.shorts.newOrder.repeat.zone, width: shortsSettings.shorts.newOrder.first.zone.width, height: shortsSettings.shorts.newOrder.first.zone.height } },
          vip: { ...shortsSettings.shorts.newOrder.vip, zone: { ...shortsSettings.shorts.newOrder.vip.zone, width: shortsSettings.shorts.newOrder.first.zone.width, height: shortsSettings.shorts.newOrder.first.zone.height } },
        },
      },
    };
    setShortsSettings(unifiedSettings);
    setSavingShortsSettings(true);
    try {
      const response = await fetch("/api/overlay-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(unifiedSettings),
      });
      if (!response.ok) throw new Error("save failed");
      setEditingOverlay(false);
    } catch {
      window.alert("쇼츠 오버레이 설정 저장에 실패했습니다.");
    } finally {
      setSavingShortsSettings(false);
    }
  }

  async function hideOrderList(orders: typeof pendingPayments, label: string) {
    if (orders.length === 0 || !window.confirm(`${label} ${orders.length}건을 목록에서 삭제할까요? 카페24 주문과 적립금 내역은 유지됩니다.`)) return;
    const results = await Promise.all(orders.map((order) => fetch(`/api/orders/${order.id}`, {
      method: "DELETE",
      headers: order.external_order_id ? { "Content-Type": "application/json" } : undefined,
      body: order.external_order_id ? JSON.stringify({ externalOrderId: order.external_order_id }) : undefined,
    })));
    if (results.some((response) => !response.ok)) {
      window.alert("일부 주문을 목록에서 삭제하지 못했습니다. 새로고침 후 다시 확인해 주세요.");
      return;
    }
    window.location.reload();
  }

  function navigateAdmin(path: string) {
    setMobileMenuOpen(false);
    setSiteMenuOpen(false);
    setShowManualOrder(false);
    router.push(path);
  }

  function goToDashboard() {
    setEditingOverlay(false);
    setShowLegacyOverlayMenu(false);
    setSelectedShortsZone("current");
    if (pathname === ADMIN_ROUTES.home) router.refresh();
    else navigateAdmin(ADMIN_ROUTES.home);
  }

  const startOpening = useCallback(async (id: number) => {
    if (!window.confirm("지금 카드를 오픈하시겠습니까?")) return false;
    const response = await fetch(`/api/orders/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "opening", timerSeconds: DEFAULT_TIMER_SECONDS }),
    });
    if (!response.ok) throw new Error("오픈 시작 처리에 실패했습니다.");
    return true;
  }, []);

  const completeOrder = useCallback(async (id: number) => {
    if (!window.confirm("오픈 완료 처리하시겠습니까?")) return false;
    const response = await fetch(`/api/orders/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "done" }),
    });
    if (!response.ok) throw new Error("오픈 완료 처리에 실패했습니다.");
    return true;
  }, []);

  const enterActionRef = useRef<string | null>(null);
  const enterPendingRef = useRef(false);
  const enterOrderId = opening?.id ?? waiting[0]?.id;
  const enterActionKey = enterOrderId === undefined ? null : `${opening ? "complete" : "start"}:${enterOrderId}`;

  useEffect(() => {
    enterActionRef.current = null;
  }, [enterActionKey]);

  useEffect(() => {
    if (pathname !== ADMIN_ROUTES.home || showManualOrder || showHitRegistration || queueHistoryModal || mobileMenuOpen || siteMenuOpen) return;
    const handleEnter = async (event: KeyboardEvent) => {
      if (event.key !== "Enter" || event.repeat || event.isComposing || event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
      const target = event.target;
      if (target instanceof Element && target.closest('input, textarea, select, button, a, [contenteditable]:not([contenteditable="false"]), [role="dialog"]')) return;
      if (enterOrderId === undefined || !enterActionKey || enterPendingRef.current || enterActionRef.current === enterActionKey) return;
      event.preventDefault();
      enterPendingRef.current = true;
      enterActionRef.current = enterActionKey;
      try {
        const accepted = await (opening ? completeOrder(enterOrderId) : startOpening(enterOrderId));
        if (!accepted) enterActionRef.current = null;
      } catch (error) {
        enterActionRef.current = null;
        window.alert(error instanceof Error ? error.message : "주문 처리에 실패했습니다.");
      } finally {
        enterPendingRef.current = false;
      }
    };
    window.addEventListener("keydown", handleEnter);
    return () => window.removeEventListener("keydown", handleEnter);
  }, [pathname, showManualOrder, showHitRegistration, queueHistoryModal, mobileMenuOpen, siteMenuOpen, enterOrderId, enterActionKey, opening, completeOrder, startOpening]);

  async function confirmPendingPayment(order: LiveOrder) {
    const orderNumber = order.external_order_id ?? String(order.id);
    if (!window.confirm(`${orderNumber} 주문의 실제 입금을 확인했습니다.\n카페24에서도 입금확인 처리하고 대기 주문으로 이동할까요?`)) return;

    setConfirmingPaymentId(order.id);
    try {
      const response = await fetch(`/api/orders/${order.id}/payment`, { method: "POST" });
      const payload = await response.json().catch(() => ({})) as { error?: string; alreadyPaid?: boolean };
      if (!response.ok) throw new Error(payload.error ?? "카페24 입금확인 처리에 실패했습니다.");
      window.alert(payload.alreadyPaid ? "카페24에서 이미 입금확인된 주문입니다. 대기 주문으로 이동했습니다." : "카페24 입금확인 후 대기 주문으로 이동했습니다.");
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "입금확인 처리에 실패했습니다.");
    } finally {
      setConfirmingPaymentId(null);
    }
  }

  async function addManualOrder(e: FormEvent) {
    e.preventDefault();
    if (!form.userId) {
      window.alert("구매자를 입력하세요.");
      return;
    }
    if (!form.product) {
      window.alert("상품명을 입력하세요.");
      return;
    }
    if (!window.confirm("상품을 추가하시겠습니까?")) return;

    const response = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });

    if (!response.ok) {
      const result = await response.json().catch(() => null);
      window.alert(result?.error ?? "주문 추가에 실패했습니다.");
      return;
    }
    setForm({ userId: "", product: "", quantity: 1, unitPrice: 15000, tier: "", youtubeNickname: "", pointsSpentAmount: 0, finalPaymentAmount: "", includeRevenue: false });
    setShowManualOrder(false);
  }

  async function addHit(e: FormEvent) {
    e.preventDefault();
    if (!hitForm.card.trim()) {
      window.alert("카드명을 입력하세요.");
      return;
    }
    if (savingHit) return;
    setSavingHit(true);
    try {
      const response = await fetch(editingHitId === null ? "/api/hit-cards" : `/api/hit-cards/${editingHitId}`, {
        method: editingHitId === null ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...hitForm, card: hitForm.card.trim(), userId: "" }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error ?? "히트카드 저장에 실패했습니다.");
      }
      setHitForm({ card: "", youtubeNickname: "" });
      setEditingHitId(null);
      setShowHitRegistration(false);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "히트카드 저장에 실패했습니다.");
    } finally {
      setSavingHit(false);
    }
  }

  async function removeHit(id: number) {
    if (!window.confirm("카드 목록을 삭제하시겠습니까?")) return;
    await fetch(`/api/hit-cards/${id}`, { method: "DELETE" });
  }

  async function logout() {
    if (!window.confirm("관리자 페이지에서 로그아웃하시겠습니까?")) return;

    await fetch("/api/admin/logout", { method: "POST" });
    router.replace("/admin/login");
    router.refresh();
  }

  function renderOrderFinancialBadges(order: LiveOrder) {
    const points = order.points_spent_amount;
    const finalPayment = order.final_payment_amount;
    return <div className={styles.orderFinancialBadges}>
      <span className={styles.pointsUsedBadge}>적립금 사용액 {points == null ? "조회 불가" : points.toLocaleString("ko-KR") + "원"}</span>
      <span className={styles.finalPaymentBadge}>최종결제액 {finalPayment == null ? "조회 불가" : finalPayment.toLocaleString("ko-KR") + "원"}</span>
    </div>;
  }

  function renderWaitingRow(order: LiveOrder) {
    const payment = getPaymentBadge(order);
    return (
      <div className={`${styles.row} ${styles.queueOrderRow}`} key={order.id}>
        <div className={styles.orderIdentity}>
          <div className={styles.orderIdentityMain}>
            <strong>{order.user_id || "구매자 미확인"}</strong>
            <span className={styles.memberGradeBadge}>{order.tier || "등급 미확인"}</span>
          </div>
          {order.youtube_nickname && <span className={styles.ytBadge}>{formatYoutubeNickname(order.youtube_nickname)}</span>}
        </div>
        <div className={styles.orderProductLine}>
          <span className={styles.orderDescription}>{order.product} × {order.quantity}</span>
          <span className={styles.orderAmount}>{formatOrderAmount(order)}</span>
        </div>
        {renderOrderFinancialBadges(order)}
        <div className={styles.orderRowFooter}>
          <span className={styles.paymentBadge} data-kind={payment.kind}>{payment.label}</span>
          {payment.kind.startsWith("bank") && order.paid_at && <span className={styles.paidBadge}>입금 후</span>}
          <div className={styles.rowActions}>
            <button onClick={() => startOpening(order.id)}>오픈시작 (Enter)</button>
          </div>
        </div>
      </div>
    );
  }

  function renderQueueHistoryRow(order: LiveOrder, kind: QueueHistoryKind) {
    const payment = getPaymentBadge(order);
    const isOpeningHistory = kind === "opening";
    const isPendingHistory = kind === "pending";
    const timestamp = isOpeningHistory ? order.completed_at : order.created_at;
    return (
      <div className={`${styles.row} ${styles.queueOrderRow} ${styles.completedOpeningRow}`} key={order.id}>
        <div className={styles.orderIdentity}>
          <div className={styles.orderIdentityMain}>
            <strong>{order.user_id || "구매자 미확인"}</strong>
            <span className={styles.memberGradeBadge}>{order.tier || "등급 미확인"}</span>
          </div>
          <time className={styles.completedOpeningTime} dateTime={timestamp ?? undefined}>
            {formatCompletedTime(timestamp)}
          </time>
        </div>
        <div className={styles.orderProductLine}>
          <span className={styles.orderDescription}>{order.product} × {order.quantity}</span>
          <span className={styles.orderAmount}>{formatOrderAmount(order)}</span>
        </div>
        <div className={styles.orderRowFooter}>
          <span className={styles.completedOpeningBadge}>{isOpeningHistory ? "최종오픈" : isPendingHistory ? "입금 전" : "대기"}</span>
          <span className={styles.paymentBadge} data-kind={payment.kind}>{payment.label}</span>
        </div>
      </div>
    );
  }

  function renderPendingPaymentRow(order: LiveOrder) {
    return (
      <div className={`${styles.row} ${styles.queueOrderRow} ${styles.pendingPaymentRow}`} key={order.id}>
        <div className={styles.orderIdentity}>
          <div className={styles.orderIdentityMain}>
            <strong>{order.user_id || "구매자 미확인"}</strong>
            <span className={styles.memberGradeBadge}>{order.tier || "등급 미확인"}</span>
          </div>
          {order.youtube_nickname && <span className={styles.ytBadge}>{formatYoutubeNickname(order.youtube_nickname)}</span>}
        </div>
        <div className={styles.orderProductLine}>
          <span className={styles.orderDescription}>{order.product} × {order.quantity}</span>
          <span className={styles.orderAmount}>{formatOrderAmount(order)}</span>
        </div>
        <div className={styles.orderRowFooter}>
          <span className={styles.unpaidBadge}>입금 전</span>
          <div className={styles.rowActions}>
            <button
              className={styles.confirmPaymentButton}
              disabled={confirmingPaymentId === order.id}
              onClick={() => confirmPendingPayment(order)}
            >
              {confirmingPaymentId === order.id ? "확인 중" : "입금완료"}
            </button>
            <button className={styles.hitDelete} onClick={() => void hideOrderList([order], "무통장 입금 전 주문")}>삭제</button>
          </div>
        </div>
      </div>
    );
  }

  function renderCancelledOrderRow(order: LiveOrder) {
    const isRefunded = order.cancel_reason === "refunded";
    return (
      <div className={`${styles.row} ${styles.queueOrderRow} ${styles.cancelledOrderRow}`} key={order.id}>
        <div className={styles.orderIdentity}>
          <div className={styles.orderIdentityMain}>
            <strong>{order.user_id || "구매자 미확인"}</strong>
            <span className={styles.memberGradeBadge}>{order.tier || "등급 미확인"}</span>
          </div>
          {order.youtube_nickname && <span className={styles.ytBadge}>{formatYoutubeNickname(order.youtube_nickname)}</span>}
        </div>
        <div className={styles.orderProductLine}>
          <span className={styles.orderDescription}>{order.product} × {order.quantity}</span>
          <span className={styles.orderAmount}>{formatOrderAmount(order)}</span>
        </div>
        <div className={styles.orderRowFooter}>
          <span className={styles.cancelStatusBadge} data-refunded={isRefunded}>{isRefunded ? "환불" : "취소"}</span>
          <span className={styles.cancelledOrderId}>{order.external_order_id ?? "-"}</span>
          <button className={styles.hitDelete} onClick={() => void hideOrderList([order], "취소·환불 주문")}>삭제</button>
        </div>
      </div>
    );
  }

  return (
    <main className={styles.page} data-theme={theme}>
      {liveLoading && <GlobalLoadingOverlay />}
      <div className={`${styles.headerRow} ${showHistory || showRanking || showOverlayPreview ? styles.historyHeader : ""}`}>
        <button
          className={styles.headerBrand}
          type="button"
          onClick={goToDashboard}
          aria-label="망고TCG 관리자 대시보드로 이동하고 새로고침"
          title="대시보드로 이동 및 새로고침"
        >
          <span>LIVE OPERATIONS</span>
          <h1>망고TCG 관리자</h1>
        </button>
        <button
          className={styles.mobileMenuButton}
          type="button"
          aria-label="관리자 메뉴"
          aria-controls="admin-header-menu"
          aria-expanded={mobileMenuOpen}
          onClick={() => setMobileMenuOpen((open) => !open)}
        >
          ☰
        </button>
        <div
          id="admin-header-menu"
          className={`${styles.headerButtons} ${mobileMenuOpen ? styles.mobileMenuOpen : ""}`}
        >
          {showOverlayPreview && (
            <div className={styles.legacyOverlayMenu}>
              <button
                className={styles.historyButton}
                type="button"
                aria-expanded={showLegacyOverlayMenu}
                aria-controls="legacy-overlay-menu"
                onClick={() => setShowLegacyOverlayMenu((open) => !open)}
              >
                구버전
              </button>
              {showLegacyOverlayMenu && (
                <div id="legacy-overlay-menu" className={styles.legacyOverlayPanel} role="dialog" aria-label="구버전 오버레이">
                  <strong>구버전 오버레이</strong>
                  <a href="/overlay-vertical" target="_blank" rel="noopener noreferrer">기존 세로형 열기</a>
                </div>
              )}
            </div>
          )}
          {!showSettings && !showHistory && !showRanking && !showOverlayPreview && (
            <>
              <div className={styles.siteMenu}>
                <button
                  className={`${styles.historyButton} ${styles.siteMenuToggle}`}
                  type="button"
                  data-site-menu-toggle
                  aria-expanded={siteMenuOpen}
                  aria-controls="admin-site-menu"
                  onClick={() => setSiteMenuOpen((open) => !open)}
                >
                  <span>🏪 사이트</span>
                  <span className={styles.siteMenuCaret} aria-hidden="true">{siteMenuOpen ? "▴" : "▾"}</span>
                </button>
                {siteMenuOpen && (
                  <div id="admin-site-menu" className={styles.siteMenuPanel}>
                    {SITE_LINKS.map((link) => (
                      <a
                        key={link.href}
                        href={link.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() => {
                          setMobileMenuOpen(false);
                          setSiteMenuOpen(false);
                        }}
                      >
                        {link.label}
                      </a>
                    ))}
                  </div>
                )}
              </div>
              <button className={styles.historyButton} onClick={() => {
                setMobileMenuOpen(false);
                navigateAdmin(ADMIN_ROUTES.overlay);
              }}>
                📺 오버레이
              </button>
              <button className={styles.historyButton} onClick={() => {
                setMobileMenuOpen(false);
                navigateAdmin(ADMIN_ROUTES.ranking);
              }}>
                🏆 주문랭킹
              </button>
              <button className={styles.historyButton} onClick={() => {
                setMobileMenuOpen(false);
                navigateAdmin(ADMIN_ROUTES.history);
              }}>
                🗂️ 주문이력
              </button>
            </>
          )}
          <button
            className={styles.historyButton}
            onClick={() => {
              setMobileMenuOpen(false);
              setSiteMenuOpen(false);
              if (showSettings || showHistory || showRanking || showOverlayPreview) {
                goToDashboard();
              } else {
                navigateAdmin(ADMIN_ROUTES.settings);
              }
            }}
            aria-pressed={showSettings}
          >
            {showSettings || showHistory || showRanking || showOverlayPreview ? "← 관리자 홈" : "⚙️ 설정"}
          </button>
          {showHistory && (
            <button className={styles.historyButton} onClick={() => {
              setMobileMenuOpen(false);
              navigateAdmin(ADMIN_ROUTES.rewards);
            }}>
              💰 적립금 원장
            </button>
          )}
          {showHistory && (
            <button className={styles.historyButton} onClick={() => {
              setMobileMenuOpen(false);
              navigateAdmin(ADMIN_ROUTES.hitHistory);
            }}>
              🃏 히트카드
            </button>
          )}
          <button className={styles.logoutButton} onClick={logout}>
            로그아웃
          </button>
        </div>
      </div>
      {showSettings ? (
        <section className={styles.settingsPage} aria-labelledby="settings-title">
          <div className={styles.pageTitleRow}>
            <button className={styles.pageBackButton} onClick={() => navigateAdmin(ADMIN_ROUTES.home)} aria-label="뒤로가기" title="뒤로가기">←</button>
            <h2 id="settings-title">설정</h2>
          </div>
          <div className={styles.settingRow}>
            <div>
              <h3>브라우저 주문 알림</h3>
              <p>관리자 브라우저에서 새 카페24 주문의 소리와 Windows 알림을 표시합니다.</p>
            </div>
            <button
              className={styles.historyButton}
              onClick={toggleOrderAlerts}
              aria-pressed={orderAlertsEnabled}
              title={notificationPermission === "denied" ? "Windows 알림은 브라우저 알림 권한을 허용해야 합니다." : undefined}
            >
              {orderAlertsEnabled
                ? notificationPermission === "granted"
                  ? "🔔 주문 알림 켜짐"
                  : "🔊 소리 알림 켜짐"
                : "🔔 주문 알림 켜기"}
            </button>
          </div>
          <div className={styles.settingRow}>
            <div>
              <h3>주문 접수 카드</h3>
              <p>오버레이에 주문 접수 카드를 표시합니다.</p>
            </div>
            <button
              className={styles.historyButton}
              onClick={toggleOrderVisibilitySetting}
              aria-pressed={orderVisibleSetting}
              disabled={savingOrderVisible}
            >
              주문 접수 {orderVisibleSetting ? "ON" : "OFF"}
            </button>
          </div>
          <div className={styles.settingRow}>
            <div>
              <h3>화면 모드</h3>
              <p>관리자 화면의 밝은 테마와 어두운 테마를 전환합니다.</p>
            </div>
            <button
              className={styles.historyButton}
              onClick={toggleTheme}
              aria-label={`${theme === "dark" ? "라이트" : "다크"} 모드로 전환`}
            >
              {theme === "dark" ? "☀ 라이트 모드" : "◐ 다크 모드"}
            </button>
          </div>
          <RewardSettingsPanel />
        </section>
      ) : showHistory ? (
        <section className={styles.historyPage} aria-label="주문 이력">
          <OrderHistoryContent onBack={() => navigateAdmin(ADMIN_ROUTES.home)} />
        </section>
      ) : showRanking ? (
        <OrderRankingPanel onBack={() => navigateAdmin(ADMIN_ROUTES.home)} />
      ) : (
      <>
      {!showOverlayPreview && (
      <>
      <div className={`${styles.homeSectionHeader} ${styles.dashboardTitleHeader}`}>
        <h2 className={styles.homeSectionTitle}>대시보드</h2>
        <DashboardRangePicker value={dashboardRange} onChange={setDashboardRange} />
      </div>
      <OrderDashboard range={dashboardRange} />

      <div className={styles.homeSectionHeader}>
        <h2 className={styles.homeSectionTitle}>오버레이</h2>
        <button className={styles.historyButton} onClick={() => setShowManualOrder(true)}>
          주문 직접입력
        </button>
      </div>
      <div className={styles.operationsGrid}>
      <section className={`${styles.block} ${styles.primaryBlock} ${styles.queueBlock}`}>
        <div className={styles.queueCardHeader}>
          <h2>지금 오픈 중 <span className={styles.sectionCount}>{opening ? "1건" : "0건"}</span></h2>
          <button type="button" className={styles.queueHistoryButton} onClick={() => setQueueHistoryModal("opening")}>이력보기</button>
        </div>
        <div className={styles.openingCardBody}>
          {opening ? (
            <div className={`${styles.row} ${styles.queueOrderRow} ${styles.openingOrderRow}`}>
              <div className={styles.orderIdentity}>
                <div className={styles.orderIdentityMain}>
                  <strong>{opening.user_id || "구매자 미확인"}</strong>
                  <span className={styles.memberGradeBadge}>{opening.tier || "등급 미확인"}</span>
                </div>
                {opening.youtube_nickname && <span className={styles.ytBadge}>{formatYoutubeNickname(opening.youtube_nickname)}</span>}
              </div>
              <div className={styles.orderProductLine}>
                <span className={styles.orderDescription}>{opening.product} × {opening.quantity}</span>
                <span className={styles.orderAmount}>{formatOrderAmount(opening)}</span>
              </div>
              {renderOrderFinancialBadges(opening)}
              <div className={styles.orderRowFooter}>
                {opening.paid_at && <span className={styles.paidBadge}>입금완료</span>}
                <div className={styles.rowActions}>
                  <button className={styles.completeButton} onClick={() => completeOrder(opening.id)}>오픈완료 (Enter)</button>
                </div>
              </div>
            </div>
          ) : (
            <p className={styles.openingEmpty}>현재 진행 중인 오픈이 없습니다.</p>
          )}
        </div>
      </section>

      <section className={`${styles.block} ${styles.waitingOrdersBlock} ${styles.queueBlock}`} id="waiting-orders">
        <div className={styles.queueCardHeader}>
          <h2>대기 주문 ({waiting.length})</h2>
          <button type="button" className={styles.queueHistoryButton} onClick={() => setQueueHistoryModal("waiting")}>이력보기</button>
        </div>
        {waiting.length === 0 && <p className={styles.empty}>대기 중인 주문 없음</p>}
        <div className={styles.pagedList}>{pagedWaiting.map(renderWaitingRow)}</div>
        <div className={styles.pagination}>
          <button disabled={waitingPage === 1} onClick={() => setWaitingPage((page) => page - 1)}>
            이전
          </button>
          <span>{waitingPage} / {waitingPageCount}</span>
          <button
            disabled={waitingPage === waitingPageCount}
            onClick={() => setWaitingPage((page) => page + 1)}
          >
            다음
          </button>
        </div>
      </section>
      <section className={`${styles.block} ${styles.pendingPaymentsBlock} ${styles.queueBlock}`} id="pending-payments">
        <div className={styles.queueCardHeader}>
          <h2>무통장 입금 전 ({pendingPayments.length})</h2>
          <button type="button" className={styles.queueHistoryButton} onClick={() => setQueueHistoryModal("pending")}>이력보기</button>
        </div>
        {pendingPayments.length === 0 && <p className={styles.empty}>무통장 입금 전 주문 없음</p>}
        <div className={styles.pagedList}>{pagedPendingPayments.map(renderPendingPaymentRow)}</div>
        <div className={styles.pagination}>
          <button disabled={pendingPaymentPage === 1} onClick={() => setPendingPaymentPage((page) => page - 1)}>이전</button>
          <span>{pendingPaymentPage} / {pendingPaymentPageCount}</span>
          <button disabled={pendingPaymentPage === pendingPaymentPageCount} onClick={() => setPendingPaymentPage((page) => page + 1)}>다음</button>
        </div>
      </section>
      <div className={styles.operationsSecondaryRow}>
      <section className={`${styles.block} ${styles.cancelledOrdersBlock} ${styles.queueBlock}`}>
        <h2>취소 · 환불 ({cancelledOrders.length})</h2>
        {cancelledOrders.length === 0 && <p className={styles.empty}>취소 · 환불 주문 없음</p>}
        <div className={`${styles.pagedList} ${styles.cancelledOrdersList}`}>{pagedCancelledOrders.map(renderCancelledOrderRow)}</div>
        <div className={styles.pagination}>
          <button disabled={cancelledOrderPage === 1} onClick={() => setCancelledOrderPage((page) => page - 1)}>이전</button>
          <span>{cancelledOrderPage} / {cancelledOrderPageCount}</span>
          <button disabled={cancelledOrderPage === cancelledOrderPageCount} onClick={() => setCancelledOrderPage((page) => page + 1)}>다음</button>
        </div>
      </section>

      <section className={styles.block}>
        <div className={styles.queueCardHeader}>
          <h2>HIT&amp;RGB</h2>
          <button type="button" className={styles.queueHistoryButton} onClick={() => { setEditingHitId(null); setHitForm({ card: "", youtubeNickname: "" }); setShowHitRegistration(true); }}>신규등록</button>
        </div>
        {hitCards.length === 0 && <p className={styles.empty}>등록된 히트카드 이력 없음</p>}
        <ul className={styles.hitList}>
          {pagedHitCards.map((h) => (
            <li key={h.id} className={styles.hitItem}>
              <span className={styles.hitItemText}>
                {(h.youtube_nickname || h.user_id) && <b>◆ {h.youtube_nickname || h.user_id} -</b>}
                <em>{h.card}</em>
              </span>
              <div className={styles.hitActions}>
                <button type="button" className={`${styles.hitDelete} ${styles.hitEdit}`} onClick={() => {
                  setEditingHitId(h.id);
                  setHitForm({ card: h.card, youtubeNickname: h.youtube_nickname ?? "" });
                  setShowHitRegistration(true);
                }}>수정</button>
                <button type="button" className={styles.hitDelete} onClick={() => removeHit(h.id)}>삭제</button>
              </div>
            </li>
          ))}
        </ul>
        <div className={styles.pagination}>
          <button disabled={hitPage === 1} onClick={() => setHitPage((page) => page - 1)}>
            이전
          </button>
          <span>{hitPage} / {hitPageCount}</span>
          <button disabled={hitPage === hitPageCount} onClick={() => setHitPage((page) => page + 1)}>
            다음
          </button>
        </div>
      </section>
      </div>
      </div>

      </>
      )}

      {showOverlayPreview && (
        <section className={styles.overlayPreviewPage} aria-labelledby="overlay-preview-title">
          <div className={`${styles.overlayEditorModal} ${styles.overlayEditorPage}`}>
            <div className={`${styles.modalTopBarWithTitle} ${styles.overlayModalHeader}`}>
              <div className={styles.overlayModalHero}>
                <div className={styles.pageTitleRow}>
                  <button className={styles.pageBackButton} onClick={closeOverlayPreview} aria-label="뒤로가기" title="뒤로가기">←</button>
                  <h2 className={styles.modalTitle} id="overlay-preview-title">오버레이 미리보기</h2>
                </div>
              </div>
              <div className={styles.overlayModalActions}>
                <div className={styles.overlayPreviewModes} role="tablist" aria-label="오버레이 미리보기 종류">
                  <button
                    className={`${styles.overlayPreviewModeButton} ${overlayPreviewMode === "new" ? styles.overlayPreviewModeActive : ""}`}
                    type="button"
                    role="tab"
                    aria-selected={overlayPreviewMode === "new"}
                    onClick={() => {
                      navigateAdmin(ADMIN_ROUTES.overlay);
                      setSelectedShortsZone("current");
                    }}
                  >
                    신규 오버레이
                  </button>
                  <button
                    className={`${styles.overlayPreviewModeButton} ${overlayPreviewMode === "basic" ? styles.overlayPreviewModeActive : ""}`}
                    type="button"
                    role="tab"
                    aria-selected={overlayPreviewMode === "basic"}
                    onClick={() => {
                      navigateAdmin(ADMIN_ROUTES.basicOverlay);
                      setSelectedShortsZone("hit");
                    }}
                  >
                    기본 오버레이
                  </button>
                  <button
                    className={`${styles.overlayPreviewModeButton} ${overlayPreviewMode === "animation" ? styles.overlayPreviewModeActive : ""}`}
                    type="button"
                    role="tab"
                    aria-selected={overlayPreviewMode === "animation"}
                    onClick={() => {
                      navigateAdmin(ADMIN_ROUTES.orderAlerts);
                      setSelectedShortsZone("announcement");
                    }}
                  >
                    주문알림 설정
                  </button>
                </div>
                <button
                  className={`${styles.modalActionButton} ${editingOverlay ? styles.modalActionActive : ""}`}
                  onClick={() => setEditingOverlay((value) => !value)}
                >
                  {editingOverlay ? "편집 취소" : "편집"}
                </button>
                {editingOverlay && (
                  <>
                    <button
                      className={`${styles.modalActionButton} ${styles.saveActionButton}`}
                      onClick={saveShortsSettings}
                      disabled={savingShortsSettings}
                    >
                      {savingShortsSettings ? "저장 중" : "저장"}
                    </button>
                  </>
                )}
              </div>
            </div>
            {editingOverlay && (
              <div className={styles.shortsEditor} aria-label="쇼츠 오버레이 영역 설정">
                {overlayPreviewMode !== "animation" && (
                  <div className={styles.zonePicker} role="tablist" aria-label="편집할 오버레이 영역">
                    {editableShortsZoneIds.map((id) => (
                      <button
                        key={id}
                        type="button"
                        role="tab"
                        aria-selected={selectedShortsZoneId === id}
                        className={`${styles.zonePickerButton} ${selectedShortsZoneId === id ? styles.zonePickerButtonActive : ""}`}
                        onClick={() => setSelectedShortsZone(id)}
                      >
                        {overlayPreviewMode === "new" && id === "ranking" && activeShortsProfile.zones[id].title === "VIP" ? "명예의 전당" : activeShortsProfile.zones[id].title || id}
                      </button>
                    ))}
                  </div>
                )}
                <fieldset className={styles.shortsZoneControl}>
                  <legend>{overlayPreviewMode === "animation" ? "주문알림 설정" : `${overlayPreviewMode === "new" && selectedShortsZoneId === "ranking" && selectedShortsZoneSettings.title === "VIP" ? "명예의 전당" : selectedShortsZoneSettings.title || selectedShortsZoneId} 설정`}</legend>
                  <label className={styles.zoneEnabledToggle}>
                    <span>사용여부</span>
                    <input type="checkbox" checked={selectedShortsZoneSettings.visible} onChange={(event) => updateShortsZone(selectedShortsZoneId, "visible", event.target.checked)} />
                    <span className={styles.toggleTrack} aria-hidden="true"><i /></span>
                    <output>{selectedShortsZoneSettings.visible ? "On" : "Off"}</output>
                  </label>
                  {overlayPreviewMode !== "animation" && <label className={`${styles.opacityControl} ${styles.wideFormField}`}>
                    오픈 주문 없음 배경 투명도
                    <span><input type="range" min="0" max="100" value={overlayPreviewMode === "new" ? newOverlaySettings.openingEmptyTransparency ?? 40 : shortsSettings.openingEmptyTransparency} onChange={(event) => overlayPreviewMode === "new" ? setNewOverlaySettings((current) => ({ ...current, openingEmptyTransparency: Number(event.target.value) })) : setShortsSettings((current) => ({ ...current, openingEmptyTransparency: Number(event.target.value) }))} /><output>{overlayPreviewMode === "new" ? newOverlaySettings.openingEmptyTransparency ?? 40 : shortsSettings.openingEmptyTransparency}%</output></span>
                  </label>}
                  {overlayPreviewMode === "animation" && (
                    <div className={styles.newOrderCopySection}>
                      <h3>주문 유형별 설정</h3>
                      <div className={styles.zonePicker} role="tablist" aria-label="주문알림 유형">
                        <button type="button" role="tab" aria-selected={selectedNewOrderCopy === "first"} className={`${styles.zonePickerButton} ${selectedNewOrderCopy === "first" ? styles.zonePickerButtonActive : ""}`} onClick={() => setSelectedNewOrderCopy("first")}>첫주문</button>
                        <button type="button" role="tab" aria-selected={selectedNewOrderCopy === "repeat"} className={`${styles.zonePickerButton} ${selectedNewOrderCopy === "repeat" ? styles.zonePickerButtonActive : ""}`} onClick={() => setSelectedNewOrderCopy("repeat")}>신규 주문</button>
                        <button type="button" role="tab" aria-selected={selectedNewOrderCopy === "vip"} className={`${styles.zonePickerButton} ${selectedNewOrderCopy === "vip" ? styles.zonePickerButtonActive : ""}`} onClick={() => setSelectedNewOrderCopy("vip")}>VIP 주문 (TOP3)</button>
                      </div>
                      <div className={styles.newOrderCopyForm}>
                        <label>표시 시간(초)<input type="number" min="1" max="20" value={selectedNewOrderSettings.durationSeconds} onChange={(event) => updateNewOrderEffect("durationSeconds", Number(event.target.value))} /></label>
                        <label>모션 속도(초)<input type="number" min="0.2" max="3" step="0.1" value={selectedShortsZoneSettings.motionDurationSeconds} onChange={(event) => updateShortsZone(selectedShortsZoneId, "motionDurationSeconds", Number(event.target.value))} /><small>작을수록 빠르게 나타납니다.</small></label>
                      </div>
                      <p className={styles.templateHint}>N 표시, 닉네임, 주문상품과 건수가 하단 중앙 토스트로 표시됩니다. 크기는 한 번 조절하면 첫주문·신규 주문·VIP 주문에 모두 적용되고, 색상·모션 속도는 각각 설정할 수 있습니다.</p>
                    </div>
                  )}
                  <div className={styles.zoneFormGrid}>
                    {overlayPreviewMode !== "animation" && !(overlayPreviewMode === "new" && selectedShortsZoneId === "current") && <label>제목<input value={selectedShortsZoneSettings.title} onChange={(event) => updateShortsZone(selectedShortsZoneId, "title", event.target.value)} /></label>}
                    {selectedShortsZoneId === "current" && overlayPreviewMode !== "new" && <p className={`${styles.zoneAutoCopy} ${styles.wideFormField}`}>제목 색상은 진행현황·오픈·대기·건수에 함께 적용됩니다. 닉네임과 상품명은 각각 공통 색상으로 설정합니다.</p>}
                    {selectedShortsZoneId === "ranking" && <p className={`${styles.zoneAutoCopy} ${styles.wideFormField}`}>순위와 유튜브 닉네임이 자동으로 표시됩니다.</p>}
                    {selectedShortsZoneId === "announcement" && <p className={`${styles.zoneAutoCopy} ${styles.wideFormField}`}>첫주문, 신규 주문, VIP 주문의 노출 시간·위치·크기·색상·모션을 각각 설정할 수 있습니다.</p>}
                    {(selectedShortsZoneId === "ranking" || selectedShortsZoneId === "hit" || selectedShortsZoneId === "current") && <label className={styles.wideFormField}>{selectedShortsZoneId === "hit" ? "HIT 흐름 속도(초)" : selectedShortsZoneId === "current" ? overlayPreviewMode === "new" ? "덱 텍스트 순환 속도(초)" : "대기 목록 흐름 속도(초)" : overlayPreviewMode === "new" ? "명예의 전당 순환 속도(초)" : "VIP 흐름 속도(초)"}<input type="number" min={overlayPreviewMode === "new" && selectedShortsZoneId === "ranking" ? "1" : "5"} max="60" step={overlayPreviewMode === "new" && selectedShortsZoneId === "ranking" ? "0.1" : "1"} value={selectedShortsZoneSettings.tickerDurationSeconds} onChange={(event) => updateShortsZone(selectedShortsZoneId, "tickerDurationSeconds", Math.max(overlayPreviewMode === "new" && selectedShortsZoneId === "ranking" ? 1 : 5, Number(event.target.value)))} /><small>{overlayPreviewMode === "new" && selectedShortsZoneId === "ranking" ? "1위는 고정되고 2~10위가 설정한 방향으로 순환합니다. 초가 짧을수록 빠릅니다." : selectedShortsZoneId === "current" && overlayPreviewMode === "new" ? "배지는 고정되고, 닉네임과 상품명이 함께 흐릅니다. 작을수록 빠릅니다." : selectedShortsZoneId === "current" ? "대기 주문 3건부터 적용합니다. 작을수록 빠르게 흐릅니다." : "작을수록 빠르게 흐릅니다."}</small></label>}
                    {selectedShortsZoneId === "current" && overlayPreviewMode === "basic" && <>
                      <label>대기 항목 간격(px)<input type="number" min="0" max="32" value={activeShortsProfile.waitingItemGap} onChange={(event) => setShortsSettings((current) => ({ ...current, shorts: { ...current.shorts, waitingItemGap: Math.min(32, Math.max(0, Number(event.target.value) || 0)) } }))} /></label>
                      <label>오픈 대기 너비(%)<input type="number" min="8" max="100" value={selectedShortsZoneSettings.width} onChange={(event) => updateShortsZone(selectedShortsZoneId, "width", Math.min(100, Math.max(8, Number(event.target.value) || 8)))} /></label>
                      <label>오픈 대기 높이(%)<input type="number" min="3" max="70" value={selectedShortsZoneSettings.height} onChange={(event) => updateShortsZone(selectedShortsZoneId, "height", Math.min(70, Math.max(3, Number(event.target.value) || 3)))} /></label>
                    </>}
                    {selectedShortsZoneId === "hit" && overlayPreviewMode !== "animation" && <>
                      <label>항목 간격(px)<input type="number" min="0" max="32" value={activeShortsProfile.hitItemGap} onChange={(event) => overlayPreviewMode === "new" ? setNewOverlaySettings((current) => ({ ...current, hitItemGap: Math.min(32, Math.max(0, Number(event.target.value) || 0)) })) : setShortsSettings((current) => ({ ...current, shorts: { ...current.shorts, hitItemGap: Math.min(32, Math.max(0, Number(event.target.value) || 0)) } }))} /></label>
                      <label>항목 높이(px)<input type="number" min="0" max="80" value={activeShortsProfile.hitItemHeight} onChange={(event) => overlayPreviewMode === "new" ? setNewOverlaySettings((current) => ({ ...current, hitItemHeight: Math.min(80, Math.max(0, Number(event.target.value) || 0)) })) : setShortsSettings((current) => ({ ...current, shorts: { ...current.shorts, hitItemHeight: Math.min(80, Math.max(0, Number(event.target.value) || 0)) } }))} /><small>0은 내용에 맞춤</small></label>
                    </>}
                    <label className={`${styles.opacityControl} ${styles.wideFormField}`}>{overlayPreviewMode === "animation" ? "토스트 배경 불투명도" : "카드 배경 불투명도"}
                      <span><input type="range" min="0" max="100" value={overlayPreviewMode === "new" ? selectedDeckAppearance.backgroundOpacity : selectedShortsZoneSettings.backgroundOpacity} onChange={(event) => overlayPreviewMode === "new" ? updateDeckAppearance("backgroundOpacity", Number(event.target.value)) : updateShortsZone(selectedShortsZoneId, "backgroundOpacity", Number(event.target.value))} /><output>{overlayPreviewMode === "new" ? selectedDeckAppearance.backgroundOpacity : selectedShortsZoneSettings.backgroundOpacity}%</output></span>
                    </label>
                    {overlayPreviewMode !== "animation" && <label className={`${styles.opacityControl} ${styles.wideFormField}`}>제목 배경 불투명도
                      <span><input type="range" min="0" max="100" value={overlayPreviewMode === "new" ? selectedDeckAppearance.titleOpacity : selectedShortsZoneSettings.titleBackgroundOpacity} onChange={(event) => overlayPreviewMode === "new" ? updateDeckAppearance("titleOpacity", Number(event.target.value)) : updateShortsZone(selectedShortsZoneId, "titleBackgroundOpacity", Number(event.target.value))} /><output>{overlayPreviewMode === "new" ? selectedDeckAppearance.titleOpacity : selectedShortsZoneSettings.titleBackgroundOpacity}%</output></span>
                    </label>}
                    {overlayPreviewMode === "new" && <>
                      <label className={`${styles.opacityControl} ${styles.wideFormField}`}>이 카드 투명도<span><input type="range" min="0" max="100" value={100 - selectedDeckAppearance.opacity} onChange={(event) => updateDeckAppearance("opacity", 100 - Number(event.target.value))} /><output>{100 - selectedDeckAppearance.opacity}%</output></span></label>
                      {selectedShortsZoneId !== "current" && <label>제목 아이콘<input maxLength={12} value={selectedDeckAppearance.titleIcon} onChange={(event) => updateDeckAppearance("titleIcon", event.target.value)} /></label>}
                      {selectedShortsZoneId === "current" && <><label>오픈 제목<input maxLength={30} value={selectedDeckAppearance.openTitle} onChange={(event) => updateDeckAppearance("openTitle", event.target.value)} /></label><label>대기 제목<input maxLength={30} value={selectedDeckAppearance.waitingTitle} onChange={(event) => updateDeckAppearance("waitingTitle", event.target.value)} /></label></>}
                      <label>제목 글자 크기(%)<input type="number" min="50" max="200" value={selectedDeckAppearance.titleScale} onChange={(event) => updateDeckAppearance("titleScale", Math.min(200, Math.max(50, Number(event.target.value) || 50)))} /></label>
                      <label>본문 글자 크기(%)<input type="number" min="50" max="200" value={selectedDeckAppearance.textScale} onChange={(event) => updateDeckAppearance("textScale", Math.min(200, Math.max(50, Number(event.target.value) || 50)))} /></label>
                      <label>목록 흐름 방향<select value={selectedDeckAppearance.flowDirection} onChange={(event) => updateDeckAppearance("flowDirection", event.target.value as "up" | "down")}><option value="up">아래에서 위로</option><option value="down">위에서 아래로</option></select></label>
                      {selectedShortsZoneId === "current" && <label>대기 목록 순환 시간(초)<input type="number" min="1" max="120" value={selectedDeckAppearance.waitingSeconds} onChange={(event) => updateDeckAppearance("waitingSeconds", Math.min(120, Math.max(1, Number(event.target.value) || 1)))} /></label>}
                      {selectedShortsZoneId !== "hit" && <><label>목록 항목 간격(px)<input type="number" min="0" max="32" value={selectedDeckAppearance.itemGap} onChange={(event) => updateDeckAppearance("itemGap", Math.min(32, Math.max(0, Number(event.target.value) || 0)))} /></label>{selectedShortsZoneId === "current" ? <><label>오픈 주문행 높이(px)<input type="number" min="0" value={selectedDeckAppearance.openRowHeight} onChange={(event) => updateDeckAppearance("openRowHeight", Math.max(0, Number(event.target.value) || 0))} /><small>0은 내용에 맞춤 · 배지·글자도 함께 확대 · 덱 높이는 고정</small></label><label>대기 주문행 높이(px)<input type="number" min="0" value={selectedDeckAppearance.waitingRowHeight} onChange={(event) => updateDeckAppearance("waitingRowHeight", Math.max(0, Number(event.target.value) || 0))} /><small>0은 내용에 맞춤 · 배지·글자도 함께 확대 · 덱 높이는 고정</small></label></> : <label>목록 항목 높이(px)<input type="number" min="0" max="100" value={selectedDeckAppearance.itemHeight} onChange={(event) => updateDeckAppearance("itemHeight", Math.min(100, Math.max(0, Number(event.target.value) || 0)))} /><small>0은 내용에 맞춤</small></label>}</>}
                      <label>효과 반복 시간(초)<input type="number" min="1" max="10" step="0.1" value={selectedDeckAppearance.effectSeconds} onChange={(event) => updateDeckAppearance("effectSeconds", Math.min(10, Math.max(1, Number(event.target.value) || 1)))} /></label>
                      {([ ["glow", "테두리 발광"], ["shine", "빛 스윕"], ["textBurst", "글씨 돌출·빛 확산"] ] as const).filter(([key]) => selectedShortsZoneId !== "current" || key !== "textBurst").map(([key, label]) => <label key={key} className={styles.zoneEnabledToggle}><span>{label}</span><input type="checkbox" checked={selectedDeckAppearance[key]} onChange={(event) => updateDeckAppearance(key, event.target.checked)} /><span className={styles.toggleTrack} aria-hidden="true"><i /></span><output>{selectedDeckAppearance[key] ? "On" : "Off"}</output></label>)}
                      {selectedShortsZoneId === "current" && <label>오픈 카드 등장 시간(초)<input type="number" min="0.2" max="3" step="0.1" value={selectedShortsZoneSettings.motionDurationSeconds} onChange={(event) => updateShortsZone(selectedShortsZoneId, "motionDurationSeconds", Math.min(3, Math.max(.2, Number(event.target.value) || .2)))} /></label>}
                      {selectedShortsZoneId === "current" && <label className={styles.zoneEnabledToggle}><span>오픈 카드 회전</span><input type="checkbox" checked={selectedDeckAppearance.cardFlip} onChange={(event) => updateDeckAppearance("cardFlip", event.target.checked)} /><span className={styles.toggleTrack} aria-hidden="true"><i /></span><output>{selectedDeckAppearance.cardFlip ? "On" : "Off"}</output></label>}
                      {(["x", "y", "width", "height", "zIndex"] as const).map((key) => <label key={key}>{{ x: "좌측 위치(%)", y: "상단 위치(%)", width: "카드 너비(%)", height: "카드 높이(%)", zIndex: "겹침 순서" }[key]}<input type="number" min={key === "width" ? 8 : key === "height" ? 3 : key === "zIndex" ? 1 : 0} max={key === "height" ? 70 : key === "y" ? 94 : key === "zIndex" ? 20 : 100} value={selectedShortsZoneSettings[key]} onChange={(event) => updateShortsZone(selectedShortsZoneId, key, Math.min(key === "height" ? 70 : key === "y" ? 94 : key === "zIndex" ? 20 : 100, Math.max(key === "width" ? 8 : key === "height" ? 3 : key === "zIndex" ? 1 : 0, Number(event.target.value) || 0)))} /></label>)}
                      <div className={`${styles.colorControlGrid} ${styles.wideFormField}`}>
                        {([ ["backgroundStart", "그라데이션 시작"], ["backgroundMiddle", "그라데이션 중간"], ["backgroundEnd", "그라데이션 끝"], ["titleStart", "제목 배경 시작"], ["titleEnd", "제목 배경 끝"], ["itemBackground", "항목 배경"], ["borderColor", "테두리·발광 색상"], ["titleColor", "제목 글자"], ["textColor", "본문·상품 글자"], ["nicknameColor", "닉네임 글자"], ["iconColor", "아이콘 색상"] ] as const).map(([key, label]) => <label key={key}>{label}<input type="color" value={selectedDeckAppearance[key]} onInput={(event) => updateDeckAppearance(key, event.currentTarget.value)} onChange={(event) => updateDeckAppearance(key, event.target.value)} /></label>)}
                        {selectedShortsZoneId === "current" && ([ ["badgeFirstColor", "첫주문 배지"], ["badgeRepeatColor", "신규 배지"], ["badgeVipColor", "VIP 배지"] ] as const).map(([key, label]) => <label key={key}>{label}<input type="color" value={selectedDeckAppearance[key]} onInput={(event) => updateDeckAppearance(key, event.currentTarget.value)} onChange={(event) => updateDeckAppearance(key, event.target.value)} /></label>)}
                      </div>
                    </>}
                    {overlayPreviewMode !== "new" && <div className={`${styles.colorControlGrid} ${styles.wideFormField}`}>
                      {overlayPreviewMode !== "animation" && <label>카드 배경<input type="color" value={selectedShortsZoneSettings.backgroundColor} onChange={(event) => updateShortsZone(selectedShortsZoneId, "backgroundColor", event.target.value)} /></label>}
                      <label>{overlayPreviewMode === "animation" ? "배지 글자" : "제목 색상"}<input type="color" value={selectedShortsZoneSettings.titleColor} onChange={(event) => updateShortsZone(selectedShortsZoneId, "titleColor", event.target.value)} /></label>
                      {overlayPreviewMode !== "animation" && <label>테두리 색상<input type="color" value={selectedShortsZoneSettings.borderColor} onChange={(event) => updateShortsZone(selectedShortsZoneId, "borderColor", event.target.value)} /></label>}
                      {overlayPreviewMode === "animation" && <label>닉네임 글자<input type="color" value={selectedShortsZoneSettings.nicknameColor} onChange={(event) => updateShortsZone(selectedShortsZoneId, "nicknameColor", event.target.value)} /></label>}
                      {overlayPreviewMode !== "animation" && selectedShortsZoneId === "current" && <label>닉네임 색상<input type="color" value={selectedShortsZoneSettings.nicknameColor} onChange={(event) => updateShortsZone(selectedShortsZoneId, "nicknameColor", event.target.value)} /></label>}
                      <label>{overlayPreviewMode === "animation" ? "배지 배경" : "제목 배경"}<input type="color" value={selectedShortsZoneSettings.titleBackgroundColor} onChange={(event) => updateShortsZone(selectedShortsZoneId, "titleBackgroundColor", event.target.value)} /></label>
                      <label>{overlayPreviewMode === "animation" ? "상품 글자" : selectedShortsZoneId === "current" ? "상품명 색상" : "본문 색상"}<input type="color" value={selectedShortsZoneSettings.textColor} onChange={(event) => updateShortsZone(selectedShortsZoneId, "textColor", event.target.value)} /></label>
                      {overlayPreviewMode === "animation" && <label>토스트 배경<input type="color" value={selectedShortsZoneSettings.textBackgroundColor} onChange={(event) => updateShortsZone(selectedShortsZoneId, "textBackgroundColor", event.target.value)} /></label>}
                    </div>}
                    {selectedShortsZoneId === "announcement" && <label className={styles.wideFormField}>모션<select value={selectedShortsZoneSettings.motion} onChange={(event) => updateShortsZone(selectedShortsZoneId, "motion", event.target.value as typeof selectedShortsZoneSettings.motion)}><option value="none">없음</option><option value="fade">페이드</option><option value="slide-up">아래에서 등장</option><option value="left-to-right">좌에서 우로 등장</option><option value="card-turn">카드 회전</option></select></label>}
                  </div>
                </fieldset>
                <p className={styles.templateHint}>{overlayPreviewMode === "animation" ? "토스트 위치는 하단 중앙으로 고정됩니다. 테두리 핸들로 조절한 크기는 모든 주문 유형에 통합 적용됩니다." : "위치와 크기는 미리보기 화면에서 드래그해 조절합니다."}</p>
              </div>
            )}
            <div className={styles.overlayPreviewCanvas}>
              <ShortsOverlayFrame
                settingsOverride={overlayPreviewMode === "new" ? { ...shortsSettings, openingEmptyTransparency: newOverlaySettings.openingEmptyTransparency ?? 40, shorts: newOverlaySettings } : shortsSettings}
                variant={overlayPreviewMode === "new" ? "deck" : "basic"}
                editing={editingOverlay}
                preview
                previewOpeningOrder={overlayPreviewMode === "new" ? opening : undefined}
                previewWaitingOrders={overlayPreviewMode === "new" ? waiting : undefined}
                zoneIds={overlayPreviewMode === "animation" ? ORDER_ANIMATION_ZONE_IDS : BASIC_SHORTS_ZONE_IDS}
                showAnimationPreview={overlayPreviewMode === "animation"}
                previewOrderKind={selectedNewOrderCopy}
                onZoneChange={(id, patch) => overlayPreviewMode === "new"
                  ? setNewOverlaySettings((current) => ({ ...current, zones: { ...current.zones, [id]: { ...current.zones[id], ...patch } } }))
                  : setShortsSettings((current) => overlayPreviewMode === "animation" && id === "announcement"
                  ? {
                    ...current,
                    shorts: {
                      ...current.shorts,
                      newOrder: {
                        first: { ...current.shorts.newOrder.first, zone: { ...current.shorts.newOrder.first.zone, width: patch.width ?? current.shorts.newOrder.first.zone.width, height: patch.height ?? current.shorts.newOrder.first.zone.height } },
                        repeat: { ...current.shorts.newOrder.repeat, zone: { ...current.shorts.newOrder.repeat.zone, width: patch.width ?? current.shorts.newOrder.repeat.zone.width, height: patch.height ?? current.shorts.newOrder.repeat.zone.height } },
                        vip: { ...current.shorts.newOrder.vip, zone: { ...current.shorts.newOrder.vip.zone, width: patch.width ?? current.shorts.newOrder.vip.zone.width, height: patch.height ?? current.shorts.newOrder.vip.zone.height } },
                      },
                    },
                  }
                  : {
                    ...current,
                    shorts: {
                      ...current.shorts,
                      zones: { ...current.shorts.zones, [id]: { ...current.shorts.zones[id], ...patch } },
                    },
                  })}
              />
            </div>
          </div>
        </section>
      )}
      </>
      )}
      {showHitHistory && (
        <div className={styles.modalOverlay} onClick={() => router.replace(ADMIN_ROUTES.history)}>
          <div className={`${styles.modalCard} ${styles.hitHistoryModal}`} onClick={(event) => event.stopPropagation()}>
            <div className={styles.modalTopBarWithTitle}>
              <h2 className={styles.modalTitle}>히트카드 이력</h2>
              <button className={styles.modalCloseBtn} onClick={() => router.replace(ADMIN_ROUTES.history)}>
                닫기 ✕
              </button>
            </div>
            <HitCardHistoryContent />
          </div>
        </div>
      )}
      {showRewardLedger && (
        <div className={styles.modalOverlay} onClick={() => router.replace(ADMIN_ROUTES.history)}>
          <div className={`${styles.modalCard} ${styles.rewardLedgerModal}`} onClick={(event) => event.stopPropagation()}>
            <div className={styles.modalTopBarWithTitle}>
              <h2 className={styles.modalTitle}>적립금 처리내역</h2>
              <button className={styles.modalCloseBtn} onClick={() => router.replace(ADMIN_ROUTES.history)}>
                닫기 ✕
              </button>
            </div>
            <RewardLedgerModal />
          </div>
        </div>
      )}
      {queueHistory && queueHistoryModal && (
        <div className={styles.modalOverlay} onClick={() => setQueueHistoryModal(null)}>
          <section
            className={`${styles.modalCard} ${styles.queueHistoryModal}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="queue-history-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className={styles.modalTopBarWithTitle}>
              <div>
                <h2 className={styles.modalTitle} id="queue-history-title">{queueHistory.title}</h2>
                <p className={styles.queueHistoryCount}>당일 {queueHistory.orders.length}건</p>
              </div>
              <button className={styles.modalCloseBtn} onClick={() => setQueueHistoryModal(null)}>
                닫기 ✕
              </button>
            </div>
            <div className={styles.queueHistoryList}>
              {queueHistory.orders.length === 0
                ? <p className={styles.queueHistoryEmpty}>{queueHistory.empty}</p>
                : queueHistory.orders.map((order) => renderQueueHistoryRow(order, queueHistoryModal))}
            </div>
          </section>
        </div>
      )}
      {showHitRegistration && (
        <div className={styles.modalOverlay} onClick={() => setShowHitRegistration(false)}>
          <section
            className={`${styles.modalCard} ${styles.hitRegistrationModal}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="hit-registration-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className={styles.modalTopBarWithTitle}>
              <h2 className={styles.modalTitle} id="hit-registration-title">HIT&amp;RGB {editingHitId === null ? "등록" : "수정"}</h2>
              <button className={styles.modalCloseBtn} onClick={() => setShowHitRegistration(false)}>
                닫기 ✕
              </button>
            </div>
            <form className={`${styles.form} ${styles.hitRegistrationForm}`} onSubmit={addHit}>
              <div className={styles.field}>
                <label className={styles.fieldLabel}>유튜브 닉네임</label>
                <input
                  placeholder="유튜브 닉네임 입력(선택)"
                  value={hitForm.youtubeNickname}
                  onChange={(event) => setHitForm({ ...hitForm, youtubeNickname: event.target.value })}
                />
              </div>
              <div className={styles.field}>
                <label className={styles.fieldLabel}>카드명</label>
                <input
                  autoFocus
                  placeholder="카드명 입력"
                  value={hitForm.card}
                  onChange={(event) => setHitForm({ ...hitForm, card: event.target.value })}
                />
              </div>
              <button type="submit" disabled={savingHit}>{savingHit ? "저장 중…" : editingHitId === null ? "등록" : "저장"}</button>
            </form>
          </section>
        </div>
      )}
      {showManualOrder && (
        <div className={`${styles.modalOverlay} ${styles.manualOrderOverlay}`} onClick={() => setShowManualOrder(false)}>
          <div className={`${styles.modalCard} ${styles.manualOrderModal}`} onClick={(event) => event.stopPropagation()}>
            <div className={styles.modalTopBarWithTitle}>
              <h2 className={styles.modalTitle}>주문 직접입력</h2>
              <button className={styles.modalCloseBtn} onClick={() => setShowManualOrder(false)}>
                닫기 ✕
              </button>
            </div>
            <form className={styles.form} onSubmit={addManualOrder}>
              <div className={styles.field}>
                <label className={styles.fieldLabel}>구매자</label>
                <input placeholder="구매자명 입력" value={form.userId} onChange={(e) => setForm({ ...form, userId: e.target.value })} />
              </div>
              <div className={styles.field}>
                <label className={styles.fieldLabel}>유튜브 닉네임</label>
                <input placeholder="유튜브 닉네임 입력(선택)" value={form.youtubeNickname} onChange={(e) => setForm({ ...form, youtubeNickname: e.target.value })} />
              </div>
              <div className={styles.field}>
                <label className={styles.fieldLabel}>상품명</label>
                <input placeholder="상품명 입력" value={form.product} onChange={(e) => setForm({ ...form, product: e.target.value })} />
              </div>
              <div className={styles.field}>
                <label className={styles.fieldLabel}>구매수량</label>
                <input type="number" min={1} placeholder="수량 입력" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: Number(e.target.value), finalPaymentAmount: "" })} />
              </div>
              <div className={styles.field}>
                <label className={styles.fieldLabel}>금액</label>
                <input type="number" min={0} placeholder="금액 입력" value={form.unitPrice} onChange={(e) => setForm({ ...form, unitPrice: Number(e.target.value), finalPaymentAmount: "" })} />
              </div>
              <div className={styles.field}>
                <label className={styles.fieldLabel}>등급</label>
                <input placeholder="등급 입력(선택)" value={form.tier} onChange={(e) => setForm({ ...form, tier: e.target.value })} />
              </div>
              <div className={styles.field}>
                <label className={styles.fieldLabel} htmlFor="manual-points-used">적립금 사용액</label>
                <input id="manual-points-used" type="number" min={0} step={1} value={form.pointsSpentAmount} onChange={(e) => setForm({ ...form, pointsSpentAmount: Number(e.target.value), finalPaymentAmount: "" })} />
              </div>
              <div className={styles.field}>
                <label className={styles.fieldLabel} htmlFor="manual-final-payment">최종결제액</label>
                <input id="manual-final-payment" type="number" min={0} step={1} value={form.finalPaymentAmount === "" ? form.unitPrice * form.quantity - form.pointsSpentAmount : form.finalPaymentAmount} onChange={(e) => setForm({ ...form, finalPaymentAmount: e.target.value })} />
              </div>
              <label className={styles.zoneEnabledToggle}>
                <input type="checkbox" checked={form.includeRevenue} onChange={(e) => setForm({ ...form, includeRevenue: e.target.checked })} />
                <span className={styles.toggleTrack} aria-hidden="true"><i /></span>
                매출 포함 <output>{form.includeRevenue ? "On" : "Off"}</output>
              </label>
              <button type="submit">추가</button>
            </form>
            <section className={styles.manualOrderHistory} aria-label="직접 입력 주문 이력">
              <div className={styles.manualOrderHistoryHeader}>
                <h3>직접 입력 이력</h3>
                <span>{manualOrders.length}건</span>
              </div>
              {manualOrders.length === 0 ? (
                <p className={styles.manualOrderHistoryEmpty}>직접 입력한 주문이 없습니다.</p>
              ) : (
                <ul className={styles.manualOrderHistoryList}>
                  {manualOrders.map((order) => (
                    <li key={order.id}>
                      <div>
                        <strong>{order.user_id}</strong>
                        <time dateTime={order.created_at}>{formatCompletedTime(order.created_at)}</time>
                      </div>
                      <span>{order.product} × {order.quantity}</span>
                      <b>{formatOrderAmount(order)}</b>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </div>
      )}
      {toasts.length > 0 && (
        <div className={styles.toastStack} role="status" aria-live="polite">
          {toasts.map((toast) => (
            <div key={toast.eventKey} className={styles.toast}>
              <strong>🔔 {toast.title}</strong>
              <span>{toast.userId} · {toast.product}</span>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
