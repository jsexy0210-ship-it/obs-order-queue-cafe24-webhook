"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { type LiveOrder } from "@/app/useLiveCardBreak";
import { useAdminLiveCardBreak } from "./useAdminLiveCardBreak";
import GlobalLoadingOverlay from "@/app/GlobalLoadingOverlay";
import OrderHistoryContent, { HitCardHistoryContent } from "@/app/order-history/OrderHistoryContent";
import ShortsOverlayFrame from "@/app/overlay-shorts/ShortsOverlayFrame";
import { DEFAULT_OVERLAY_SETTINGS, type OverlaySettings, type ShortsZoneId } from "@/lib/overlaySettings";
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

export default function AdminPage() {
  const router = useRouter();
  const { opening, waiting, pendingPayments, cancelledOrders, hitCards, overlaySettings, loading: liveLoading } = useAdminLiveCardBreak();

  const [form, setForm] = useState({
    userId: "",
    product: "",
    quantity: 1,
    unitPrice: 15000,
    tier: "",
    youtubeNickname: "",
  });
  const [hitForm, setHitForm] = useState({ card: "", youtubeNickname: "" });
  const [showHistory, setShowHistory] = useState(false);
  const [showRanking, setShowRanking] = useState(false);
  const [showManualOrder, setShowManualOrder] = useState(false);
  const [dashboardRange, setDashboardRange] = useState<DashboardRange>("day");
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [showHitHistory, setShowHitHistory] = useState(false);
  const [showRewardLedger, setShowRewardLedger] = useState(false);
  const [showOverlayPreview, setShowOverlayPreview] = useState(false);
  const [showLegacyOverlayMenu, setShowLegacyOverlayMenu] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [siteMenuOpen, setSiteMenuOpen] = useState(false);
  const [orderVisibleSetting, setOrderVisibleSetting] = useState(overlaySettings.orderVisible);
  const [savingOrderVisible, setSavingOrderVisible] = useState(false);
  const [editingOverlay, setEditingOverlay] = useState(false);
  const [overlayPreviewMode, setOverlayPreviewMode] = useState<"basic" | "animation">("basic");
  const [selectedShortsZone, setSelectedShortsZone] = useState<ShortsZoneId>("hit");
  const [selectedNewOrderCopy, setSelectedNewOrderCopy] = useState<"first" | "repeat" | "vip">("first");
  const [shortsSettings, setShortsSettings] = useState<OverlaySettings>(DEFAULT_OVERLAY_SETTINGS);
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
  const editableShortsZoneIds = overlayPreviewMode === "basic" ? BASIC_SHORTS_ZONE_IDS : ORDER_ANIMATION_ZONE_IDS;
  const selectedShortsZoneId = editableShortsZoneIds.includes(selectedShortsZone)
    ? selectedShortsZone
    : editableShortsZoneIds[0];
  const selectedNewOrderSettings = shortsSettings.shorts.newOrder[selectedNewOrderCopy];
  const selectedShortsZoneSettings = overlayPreviewMode === "animation"
    ? selectedNewOrderSettings.zone
    : shortsSettings.shorts.zones[selectedShortsZoneId];

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
    const savedTheme = window.localStorage.getItem("mangotcg-admin-theme");
    if (savedTheme === "light" || savedTheme === "dark") setTheme(savedTheme);
  }, []);

  // 로그인 화면이 브라우저 기록에 남아 있어도, 대시보드에서 뒤로가기를 누르면
  // 로그인 화면으로 이동시키지 않고 명시적인 로그아웃 확인을 거치게 합니다.
  useEffect(() => {
    const historyKey = "mangotcg-admin-back-guard";
    if (!window.history.state?.[historyKey]) {
      window.history.pushState({ ...window.history.state, [historyKey]: true }, "", window.location.href);
    }

    const handleBrowserBack = () => {
      window.history.pushState({ ...window.history.state, [historyKey]: true }, "", window.location.href);
      if (!window.confirm("로그아웃하시겠습니까?")) return;
      void fetch("/api/admin/logout", { method: "POST" }).finally(() => {
        window.location.replace("/admin/login");
      });
    };

    window.addEventListener("popstate", handleBrowserBack);
    return () => window.removeEventListener("popstate", handleBrowserBack);
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
    document.body.style.overflow = showHitHistory || showRewardLedger || showManualOrder ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [showHitHistory, showRewardLedger, showManualOrder]);

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
    setOverlayPreviewMode("basic");
    setShowLegacyOverlayMenu(false);
    setShowOverlayPreview(false);
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

  function goToDashboard() {
    setMobileMenuOpen(false);
    setSiteMenuOpen(false);
    setShowSettings(false);
    setShowHistory(false);
    setShowRanking(false);
    setShowHitHistory(false);
    setShowRewardLedger(false);
    closeOverlayPreview();
    router.replace("/admin");
    router.refresh();
  }

  async function startOpening(id: number) {
    if (!window.confirm("지금 카드를 오픈하시겠습니까?")) return;

    await fetch(`/api/orders/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "opening", timerSeconds: DEFAULT_TIMER_SECONDS }),
    });
  }

  async function completeOrder(id: number) {
    if (!window.confirm("오픈 완료 처리하시겠습니까?")) return;

    await fetch(`/api/orders/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "done" }),
    });
  }

  async function removeOrder(id: number) {
    if (!window.confirm("대기 중인 주문을 삭제하시겠습니까?")) return;
    await fetch(`/api/orders/${id}`, { method: "DELETE" });
  }

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

    await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });

    setForm({ userId: "", product: "", quantity: 1, unitPrice: 15000, tier: "", youtubeNickname: "" });
    setShowManualOrder(false);
  }

  async function addHit(e: FormEvent) {
    e.preventDefault();
    if (!hitForm.card) {
      window.alert("카드명을 입력하세요.");
      return;
    }

    await fetch("/api/hit-cards", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...hitForm, userId: "" }),
    });

    setHitForm({ card: "", youtubeNickname: "" });
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

  function renderWaitingRow(order: LiveOrder) {
    const payment = getPaymentBadge(order);
    return (
      <div className={`${styles.row} ${styles.queueOrderRow}`} key={order.id}>
        <div className={styles.orderIdentity}>
          <div className={styles.orderIdentityMain}>
            <strong>{order.user_id || "구매자 미확인"}</strong>
            <span className={styles.memberGradeBadge}>{order.tier || "등급 미확인"}</span>
          </div>
          {order.youtube_nickname && <span className={styles.ytBadge}>YT: {order.youtube_nickname}</span>}
        </div>
        <div className={styles.orderProductLine}>
          <span className={styles.orderDescription}>{order.product} × {order.quantity}</span>
          <span className={styles.orderAmount}>{formatOrderAmount(order)}</span>
        </div>
        <div className={styles.orderRowFooter}>
          <span className={styles.paymentBadge} data-kind={payment.kind}>{payment.label}</span>
          {payment.kind.startsWith("bank") && order.paid_at && <span className={styles.paidBadge}>입금 후</span>}
          <div className={styles.rowActions}>
            <button onClick={() => startOpening(order.id)}>오픈시작</button>
            <button className={styles.danger} onClick={() => removeOrder(order.id)}>삭제</button>
          </div>
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
          {order.youtube_nickname && <span className={styles.ytBadge}>YT: {order.youtube_nickname}</span>}
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
          {order.youtube_nickname && <span className={styles.ytBadge}>YT: {order.youtube_nickname}</span>}
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
                setShowOverlayPreview(true);
              }}>
                📺 오버레이
              </button>
              <button className={styles.historyButton} onClick={() => {
                setMobileMenuOpen(false);
                setShowRanking(true);
              }}>
                🏆 주문랭킹
              </button>
              <button className={styles.historyButton} onClick={() => {
                setMobileMenuOpen(false);
                setShowHistory(true);
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
              if (showOverlayPreview) {
                closeOverlayPreview();
                return;
              }
              if (showSettings || showHistory || showRanking) {
                setShowSettings(false);
                setShowHistory(false);
                setShowRanking(false);
                setShowHitHistory(false);
                setShowRewardLedger(false);
                return;
              }
              setShowSettings(true);
            }}
            aria-pressed={showSettings}
          >
            {showSettings || showHistory || showRanking || showOverlayPreview ? "← 관리자 홈" : "⚙️ 설정"}
          </button>
          {showHistory && (
            <button className={styles.historyButton} onClick={() => {
              setMobileMenuOpen(false);
              setShowRewardLedger(true);
            }}>
              💰 적립금 원장
            </button>
          )}
          {showHistory && (
            <button className={styles.historyButton} onClick={() => {
              setMobileMenuOpen(false);
              setShowHitHistory(true);
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
            <button className={styles.pageBackButton} onClick={() => setShowSettings(false)} aria-label="뒤로가기" title="뒤로가기">←</button>
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
          <OrderHistoryContent onBack={() => setShowHistory(false)} />
        </section>
      ) : showRanking ? (
        <OrderRankingPanel onBack={() => setShowRanking(false)} />
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
          주문 수동 추가
        </button>
      </div>
      <div className={styles.operationsGrid}>
      <section className={`${styles.block} ${styles.primaryBlock}`}>
        <h2>지금 오픈 중 <span className={styles.sectionCount}>{opening ? "1건" : "0건"}</span></h2>
        {opening ? (
          <div className={styles.openingHero}>
            <div className={styles.openingIdentity}>
              <div className={styles.openingBuyerLine}>
                <strong>{opening.user_id || "구매자 미확인"}</strong>
                <span className={styles.memberGradeBadge}>{opening.tier || "등급 미확인"}</span>
              </div>
              {opening.youtube_nickname && <span className={styles.ytBadge}>YT: {opening.youtube_nickname}</span>}
            </div>
            <div className={styles.openingProduct}>
              <span className={styles.openingProductName}>
                {opening.product} <strong>× {opening.quantity}</strong>
              </span>
              <b className={styles.orderAmount}>{formatOrderAmount(opening)}</b>
            </div>
            <div className={styles.openingActions}>
              {opening.paid_at && <span className={styles.paidBadge}>입금완료</span>}
              <button className={styles.completeButton} onClick={() => completeOrder(opening.id)}>오픈완료</button>
            </div>
          </div>
        ) : (
          <p className={styles.openingEmpty}>현재 진행 중인 오픈이 없습니다.</p>
        )}
      </section>

      <section className={`${styles.block} ${styles.waitingOrdersBlock} ${styles.queueBlock}`} id="waiting-orders">
        <h2>대기 주문 ({waiting.length})</h2>
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
        <h2>무통장 입금 전 ({pendingPayments.length})</h2>
        <p className={styles.blockHint}>카페24 입금완료가 확인되면 대기 주문으로 자동 이동합니다.</p>
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
        <h2>히트 카드 등록</h2>
        <form className={styles.form} onSubmit={addHit}>
          <div className={styles.field}>
            <label className={styles.fieldLabel}>유튜브 닉네임</label>
            <input
              placeholder="유튜브 닉네임 입력(선택)"
              value={hitForm.youtubeNickname}
              onChange={(e) => setHitForm({ ...hitForm, youtubeNickname: e.target.value })}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.fieldLabel}>카드명</label>
            <input
              placeholder="카드명 입력"
              value={hitForm.card}
              onChange={(e) => setHitForm({ ...hitForm, card: e.target.value })}
            />
          </div>
          <button type="submit">등록</button>
        </form>
        <ul className={styles.hitList}>
          {pagedHitCards.map((h) => (
            <li key={h.id} className={styles.hitItem}>
              <span>
                {h.user_id ? `${h.user_id}${h.youtube_nickname ? ` (YT: ${h.youtube_nickname})` : ""}` : h.youtube_nickname || "구매자 미등록"} — {h.card}
              </span>
              <button className={styles.hitDelete} onClick={() => removeHit(h.id)}>
                삭제
              </button>
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
                    className={`${styles.overlayPreviewModeButton} ${overlayPreviewMode === "basic" ? styles.overlayPreviewModeActive : ""}`}
                    type="button"
                    role="tab"
                    aria-selected={overlayPreviewMode === "basic"}
                    onClick={() => {
                      setOverlayPreviewMode("basic");
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
                      setOverlayPreviewMode("animation");
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
                {overlayPreviewMode === "basic" && (
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
                        {shortsSettings.shorts.zones[id].title || id}
                      </button>
                    ))}
                  </div>
                )}
                <fieldset className={styles.shortsZoneControl}>
                  <legend>{overlayPreviewMode === "animation" ? "주문알림 설정" : `${selectedShortsZoneSettings.title || selectedShortsZoneId} 설정`}</legend>
                  <label className={styles.zoneEnabledToggle}>
                    <span>사용여부</span>
                    <input type="checkbox" checked={selectedShortsZoneSettings.visible} onChange={(event) => updateShortsZone(selectedShortsZoneId, "visible", event.target.checked)} />
                    <span className={styles.toggleTrack} aria-hidden="true"><i /></span>
                    <output>{selectedShortsZoneSettings.visible ? "On" : "Off"}</output>
                  </label>
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
                    {overlayPreviewMode === "basic" && <label>제목<input value={selectedShortsZoneSettings.title} onChange={(event) => updateShortsZone(selectedShortsZoneId, "title", event.target.value)} /></label>}
                    {selectedShortsZoneId === "current" && <p className={`${styles.zoneAutoCopy} ${styles.wideFormField}`}>제목 색상은 진행현황·오픈·대기·건수에 함께 적용됩니다. 닉네임과 상품명은 각각 공통 색상으로 설정합니다.</p>}
                    {selectedShortsZoneId === "ranking" && <p className={`${styles.zoneAutoCopy} ${styles.wideFormField}`}>순위, 유튜브 닉네임, 총 주문 건수가 자동으로 표시됩니다.</p>}
                    {selectedShortsZoneId === "announcement" && <p className={`${styles.zoneAutoCopy} ${styles.wideFormField}`}>첫주문, 신규 주문, VIP 주문의 노출 시간·위치·크기·색상·모션을 각각 설정할 수 있습니다.</p>}
                    {(selectedShortsZoneId === "ranking" || selectedShortsZoneId === "hit") && <label className={styles.wideFormField}>{selectedShortsZoneId === "hit" ? "HIT 흐름 속도(초)" : "VIP 흐름 속도(초)"}<input type="number" min="5" max="60" value={selectedShortsZoneSettings.tickerDurationSeconds} onChange={(event) => updateShortsZone(selectedShortsZoneId, "tickerDurationSeconds", Number(event.target.value))} /><small>작을수록 빠르게 흐릅니다.</small></label>}
                    {selectedShortsZoneId === "hit" && overlayPreviewMode === "basic" && <>
                      <label>항목 간격(px)<input type="number" min="0" max="32" value={shortsSettings.shorts.hitItemGap} onChange={(event) => setShortsSettings((current) => ({ ...current, shorts: { ...current.shorts, hitItemGap: Math.min(32, Math.max(0, Number(event.target.value) || 0)) } }))} /></label>
                      <label>항목 높이(px)<input type="number" min="0" max="80" value={shortsSettings.shorts.hitItemHeight} onChange={(event) => setShortsSettings((current) => ({ ...current, shorts: { ...current.shorts, hitItemHeight: Math.min(80, Math.max(0, Number(event.target.value) || 0)) } }))} /><small>0은 내용에 맞춤</small></label>
                    </>}
                    <label className={`${styles.opacityControl} ${styles.wideFormField}`}>{overlayPreviewMode === "animation" ? "토스트 배경 불투명도" : "카드 배경 불투명도"}
                      <span><input type="range" min="0" max="100" value={selectedShortsZoneSettings.backgroundOpacity} onChange={(event) => updateShortsZone(selectedShortsZoneId, "backgroundOpacity", Number(event.target.value))} /><output>{selectedShortsZoneSettings.backgroundOpacity}%</output></span>
                    </label>
                    {overlayPreviewMode === "basic" && <label className={`${styles.opacityControl} ${styles.wideFormField}`}>제목 배경 불투명도
                      <span><input type="range" min="0" max="100" value={selectedShortsZoneSettings.titleBackgroundOpacity} onChange={(event) => updateShortsZone(selectedShortsZoneId, "titleBackgroundOpacity", Number(event.target.value))} /><output>{selectedShortsZoneSettings.titleBackgroundOpacity}%</output></span>
                    </label>}
                    <div className={`${styles.colorControlGrid} ${styles.wideFormField}`}>
                      {overlayPreviewMode === "basic" && <label>카드 배경<input type="color" value={selectedShortsZoneSettings.backgroundColor} onChange={(event) => updateShortsZone(selectedShortsZoneId, "backgroundColor", event.target.value)} /></label>}
                      <label>{overlayPreviewMode === "animation" ? "배지 글자" : "제목 색상"}<input type="color" value={selectedShortsZoneSettings.titleColor} onChange={(event) => updateShortsZone(selectedShortsZoneId, "titleColor", event.target.value)} /></label>
                      {overlayPreviewMode === "basic" && <label>테두리 색상<input type="color" value={selectedShortsZoneSettings.borderColor} onChange={(event) => updateShortsZone(selectedShortsZoneId, "borderColor", event.target.value)} /></label>}
                      {overlayPreviewMode === "animation" && <label>닉네임 글자<input type="color" value={selectedShortsZoneSettings.nicknameColor} onChange={(event) => updateShortsZone(selectedShortsZoneId, "nicknameColor", event.target.value)} /></label>}
                      {overlayPreviewMode === "basic" && selectedShortsZoneId === "current" && <label>닉네임 색상<input type="color" value={selectedShortsZoneSettings.nicknameColor} onChange={(event) => updateShortsZone(selectedShortsZoneId, "nicknameColor", event.target.value)} /></label>}
                      <label>{overlayPreviewMode === "animation" ? "배지 배경" : "제목 배경"}<input type="color" value={selectedShortsZoneSettings.titleBackgroundColor} onChange={(event) => updateShortsZone(selectedShortsZoneId, "titleBackgroundColor", event.target.value)} /></label>
                      <label>{overlayPreviewMode === "animation" ? "상품 글자" : selectedShortsZoneId === "current" ? "상품명 색상" : "본문 색상"}<input type="color" value={selectedShortsZoneSettings.textColor} onChange={(event) => updateShortsZone(selectedShortsZoneId, "textColor", event.target.value)} /></label>
                      {overlayPreviewMode === "animation" && <label>토스트 배경<input type="color" value={selectedShortsZoneSettings.textBackgroundColor} onChange={(event) => updateShortsZone(selectedShortsZoneId, "textBackgroundColor", event.target.value)} /></label>}
                    </div>
                    {selectedShortsZoneId === "announcement" && <label className={styles.wideFormField}>모션<select value={selectedShortsZoneSettings.motion} onChange={(event) => updateShortsZone(selectedShortsZoneId, "motion", event.target.value as typeof selectedShortsZoneSettings.motion)}><option value="none">없음</option><option value="fade">페이드</option><option value="slide-up">아래에서 등장</option><option value="left-to-right">좌에서 우로 등장</option><option value="card-turn">카드 회전</option></select></label>}
                  </div>
                </fieldset>
                <p className={styles.templateHint}>{overlayPreviewMode === "animation" ? "토스트 위치는 하단 중앙으로 고정됩니다. 테두리 핸들로 조절한 크기는 모든 주문 유형에 통합 적용됩니다." : "위치와 크기는 미리보기 화면에서 드래그해 조절합니다."}</p>
              </div>
            )}
            <div className={styles.overlayPreviewCanvas}>
              <ShortsOverlayFrame
                settingsOverride={shortsSettings}
                editing={editingOverlay}
                preview
                zoneIds={overlayPreviewMode === "basic" ? BASIC_SHORTS_ZONE_IDS : ORDER_ANIMATION_ZONE_IDS}
                showAnimationPreview={overlayPreviewMode === "animation"}
                previewOrderKind={selectedNewOrderCopy}
                onZoneChange={(id, patch) => setShortsSettings((current) => overlayPreviewMode === "animation" && id === "announcement"
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
        <div className={styles.modalOverlay} onClick={() => setShowHitHistory(false)}>
          <div className={`${styles.modalCard} ${styles.hitHistoryModal}`} onClick={(event) => event.stopPropagation()}>
            <div className={styles.modalTopBarWithTitle}>
              <h2 className={styles.modalTitle}>히트카드 이력</h2>
              <button className={styles.modalCloseBtn} onClick={() => setShowHitHistory(false)}>
                닫기 ✕
              </button>
            </div>
            <HitCardHistoryContent />
          </div>
        </div>
      )}
      {showRewardLedger && (
        <div className={styles.modalOverlay} onClick={() => setShowRewardLedger(false)}>
          <div className={`${styles.modalCard} ${styles.rewardLedgerModal}`} onClick={(event) => event.stopPropagation()}>
            <div className={styles.modalTopBarWithTitle}>
              <h2 className={styles.modalTitle}>적립금 처리내역</h2>
              <button className={styles.modalCloseBtn} onClick={() => setShowRewardLedger(false)}>
                닫기 ✕
              </button>
            </div>
            <RewardLedgerModal />
          </div>
        </div>
      )}
      {showManualOrder && (
        <div className={`${styles.modalOverlay} ${styles.manualOrderOverlay}`} onClick={() => setShowManualOrder(false)}>
          <div className={`${styles.modalCard} ${styles.manualOrderModal}`} onClick={(event) => event.stopPropagation()}>
            <div className={styles.modalTopBarWithTitle}>
              <h2 className={styles.modalTitle}>주문 수동 추가</h2>
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
                <input type="number" min={1} placeholder="수량 입력" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: Number(e.target.value) })} />
              </div>
              <div className={styles.field}>
                <label className={styles.fieldLabel}>금액</label>
                <input type="number" min={0} placeholder="금액 입력" value={form.unitPrice} onChange={(e) => setForm({ ...form, unitPrice: Number(e.target.value) })} />
              </div>
              <div className={styles.field}>
                <label className={styles.fieldLabel}>등급</label>
                <input placeholder="등급 입력(선택)" value={form.tier} onChange={(e) => setForm({ ...form, tier: e.target.value })} />
              </div>
              <button type="submit">추가</button>
            </form>
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
