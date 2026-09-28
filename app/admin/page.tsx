"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useLiveCardBreak, type LiveOrder } from "@/app/useLiveCardBreak";
import OrderHistoryContent, { HitCardHistoryContent } from "@/app/order-history/OrderHistoryContent";
import CardBreakFrame, { type CardBreakFrameHandle } from "@/app/overlay-cardbreak/CardBreakFrame";
import { DEFAULT_OVERLAY_SETTINGS, type OverlaySettings } from "@/lib/overlaySettings";
import RewardSettingsPanel from "./RewardSettingsPanel";
import OrderDashboard from "./OrderDashboard";
import OrderRankingPanel from "./OrderRankingPanel";
import styles from "./admin.module.css";

const DEFAULT_TIMER_SECONDS = 60;
const WAITING_PAGE_SIZE = 5;
const HIT_PAGE_SIZE = 5;
const TOAST_DISPLAY_MS = 5000;
const ORDER_ALERT_NOTIFICATION_TITLE = "망고TCG 새 주문";

type Toast = { id: number; userId: string; product: string };

export default function AdminPage() {
  const { opening, waiting, hitCards, overlaySettings } = useLiveCardBreak();

  const [form, setForm] = useState({
    userId: "",
    product: "",
    quantity: 1,
    unitPrice: 15000,
    tier: "",
    youtubeNickname: "",
  });
  const [hitForm, setHitForm] = useState({ userId: "", card: "", youtubeNickname: "" });
  const [showHistory, setShowHistory] = useState(false);
  const [showRanking, setShowRanking] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [showHitHistory, setShowHitHistory] = useState(false);
  const [showOverlayPreview, setShowOverlayPreview] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [orderVisibleSetting, setOrderVisibleSetting] = useState(overlaySettings.orderVisible);
  const [savingOrderVisible, setSavingOrderVisible] = useState(false);
  const [editingOverlay, setEditingOverlay] = useState(false);
  const [overlayEditorState, setOverlayEditorState] = useState({
    orderVisible: true,
    panelBackgroundVisible: true,
    panelBackgroundTransparency: DEFAULT_OVERLAY_SETTINGS.panelBackgroundTransparency,
    saving: false,
    colors: DEFAULT_OVERLAY_SETTINGS.colors,
  });
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [orderAlertsEnabled, setOrderAlertsEnabled] = useState(false);
  const [notificationPermission, setNotificationPermission] = useState<
    NotificationPermission | "unsupported"
  >("default");
  const [waitingPage, setWaitingPage] = useState(1);
  const [hitPage, setHitPage] = useState(1);

  const waitingPageCount = Math.max(1, Math.ceil(waiting.length / WAITING_PAGE_SIZE));
  const hitPageCount = Math.max(1, Math.ceil(hitCards.length / HIT_PAGE_SIZE));
  const pagedWaiting = waiting.slice(
    (waitingPage - 1) * WAITING_PAGE_SIZE,
    waitingPage * WAITING_PAGE_SIZE
  );
  const pagedHitCards = hitCards.slice((hitPage - 1) * HIT_PAGE_SIZE, hitPage * HIT_PAGE_SIZE);

  const seenOrderIds = useRef<Set<number> | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const overlayEditorRef = useRef<CardBreakFrameHandle>(null);
  const handleOverlayEditorState = useCallback(
    (state: {
      orderVisible: boolean;
      panelBackgroundVisible: boolean;
      panelBackgroundTransparency: number;
      saving: boolean;
      colors: OverlaySettings["colors"];
    }) => setOverlayEditorState(state),
    []
  );

  useEffect(() => {
    setOrderVisibleSetting(overlaySettings.orderVisible);
  }, [overlaySettings.orderVisible]);

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

  // 신규 주문 토스트 알림: 처음 로드될 때 있던 주문은 알리지 않고,
  // 그 이후 새로 들어온 주문(대기열에 새 id)만 감지해서 알려줍니다.
  useEffect(() => {
    const currentIds = new Set(waiting.map((o) => o.id));

    if (seenOrderIds.current === null) {
      seenOrderIds.current = currentIds;
      return;
    }

    const newOrders = waiting.filter((o) => !seenOrderIds.current!.has(o.id));
    seenOrderIds.current = currentIds;

    if (newOrders.length === 0) return;

    setToasts((prev) => [
      ...prev,
      ...newOrders.map((o) => ({ id: o.id, userId: o.user_id, product: o.product })),
    ]);

    newOrders.forEach((o) => {
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== o.id));
      }, TOAST_DISPLAY_MS);
    });

    const cafe24Orders = newOrders.filter(
      (order) => order.source === "cafe24" && order.status === "waiting"
    );

    if (!orderAlertsEnabled || cafe24Orders.length === 0) return;

    playOrderChime();

    if (typeof window.Notification !== "undefined" && Notification.permission === "granted") {
      cafe24Orders.forEach((order) => {
        const totalPrice = order.unit_price * order.quantity;
        const notification = new Notification(ORDER_ALERT_NOTIFICATION_TITLE, {
          body: `${order.user_id} · ${order.product} × ${order.quantity} · ${totalPrice.toLocaleString(
            "ko-KR"
          )}원`,
          tag: `mangotcg-order-${order.external_order_id ?? order.id}`,
          requireInteraction: true,
          silent: true,
        });

        notification.onclick = () => {
          window.focus();
          const orderIndex = waiting.findIndex((item) => item.id === order.id);
          if (orderIndex >= 0) {
            setWaitingPage(Math.floor(orderIndex / WAITING_PAGE_SIZE) + 1);
          }
          requestAnimationFrame(() => {
            document.getElementById("waiting-orders")?.scrollIntoView({
              behavior: "smooth",
              block: "start",
            });
          });
          notification.close();
        };
      });
    }
  }, [waiting, orderAlertsEnabled, playOrderChime]);

  // 히트카드 이력 모달이 열려 있는 동안에는 뒤쪽 화면이 같이 스크롤되지 않도록 막습니다.
  useEffect(() => {
    document.body.style.overflow = showHitHistory ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [showHitHistory]);

  useEffect(() => {
    setWaitingPage((page) => Math.min(page, waitingPageCount));
  }, [waitingPageCount]);

  useEffect(() => {
    setHitPage((page) => Math.min(page, hitPageCount));
  }, [hitPageCount]);

  function closeOverlayPreview() {
    setEditingOverlay(false);
    setShowOverlayPreview(false);
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
  }

  async function addHit(e: FormEvent) {
    e.preventDefault();
    if (!hitForm.userId) {
      window.alert("구매자를 입력하세요.");
      return;
    }
    if (!hitForm.card) {
      window.alert("카드명을 입력하세요.");
      return;
    }

    await fetch("/api/hit-cards", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(hitForm),
    });

    setHitForm({ userId: "", card: "", youtubeNickname: "" });
  }

  async function removeHit(id: number) {
    if (!window.confirm("카드 목록을 삭제하시겠습니까?")) return;
    await fetch(`/api/hit-cards/${id}`, { method: "DELETE" });
  }

  async function logout() {
    if (!window.confirm("관리자 페이지에서 로그아웃하시겠습니까?")) return;

    await fetch("/api/admin/logout", { method: "POST" });
    window.location.href = "/admin/login";
  }

  function renderWaitingRow(order: LiveOrder) {
    const cancelled = order.status === "cancelled";
    return (
      <div className={styles.row} key={order.id} style={cancelled ? { opacity: 0.5 } : undefined}>
        <span>{order.user_id}</span>
        {order.youtube_nickname && (
          <span className={styles.ytBadge}>YT: {order.youtube_nickname}</span>
        )}
        <span className={styles.orderDescription}>
          {order.product} × {order.quantity}
        </span>
        {order.paid_at && <span className={styles.paidBadge}>입금완료</span>}
        <span className={styles.badge}>
          {cancelled
            ? order.cancel_reason === "refunded"
              ? "환불됨"
              : "취소됨"
            : order.source === "cafe24"
              ? "사이트"
              : "수동"}
        </span>
        {!cancelled && <button onClick={() => startOpening(order.id)}>오픈시작</button>}
        <button className={styles.danger} onClick={() => removeOrder(order.id)}>
          삭제
        </button>
      </div>
    );
  }

  return (
    <main className={styles.page} data-theme={theme}>
      <div className={`${styles.headerRow} ${showHistory || showRanking || showOverlayPreview ? styles.historyHeader : ""}`}>
        <div className={styles.headerBrand}>
          <span>LIVE OPERATIONS</span>
          <h1>망고TCG 관리자</h1>
        </div>
        <div className={styles.headerButtons}>
          {!showSettings && !showHistory && !showRanking && !showOverlayPreview && (
            <>
              <a
                className={styles.historyButton}
                href="https://dhdudals5555.cafe24.com/disp/admin/shop1/main/dashboard"
                target="_blank"
                rel="noopener noreferrer"
              >
                🏪 카페24 관리자
              </a>
              <button className={styles.historyButton} onClick={() => setShowOverlayPreview(true)}>
                📺 오버레이 미리보기
              </button>
              <button className={styles.historyButton} onClick={() => setShowRanking(true)}>
                🏆 주문랭킹 보기
              </button>
              <button className={styles.historyButton} onClick={() => setShowHistory(true)}>
                🗂️ 주문이력 보기
              </button>
            </>
          )}
          <button
            className={styles.historyButton}
            onClick={() => {
              if (showOverlayPreview) {
                closeOverlayPreview();
                return;
              }
              if (showSettings || showHistory || showRanking) {
                setShowSettings(false);
                setShowHistory(false);
                setShowRanking(false);
                setShowHitHistory(false);
                return;
              }
              setShowSettings(true);
            }}
            aria-pressed={showSettings}
          >
            {showSettings || showHistory || showRanking || showOverlayPreview ? "← 관리자 홈" : "⚙️ 설정"}
          </button>
          {showHistory && (
            <button className={styles.historyButton} onClick={() => setShowHitHistory(true)}>
              🃏 히트카드 이력
            </button>
          )}
          <button className={styles.logoutButton} onClick={logout}>
            로그아웃
          </button>
        </div>
      </div>
      {showSettings ? (
        <section className={styles.settingsPage} aria-labelledby="settings-title">
          <h2 id="settings-title">설정</h2>
          <div className={styles.settingRow}>
            <div>
              <h3>주문 알림</h3>
              <p>새 카페24 주문이 들어오면 소리와 Windows 알림을 표시합니다.</p>
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
          <RewardSettingsPanel />
        </section>
      ) : showHistory ? (
        <section className={styles.historyPage} aria-label="주문 이력">
          <OrderHistoryContent />
        </section>
      ) : showRanking ? (
        <OrderRankingPanel />
      ) : (
      <>
      {!showOverlayPreview && (
      <>
      <h2 className={styles.homeSectionTitle}>대시보드</h2>
      <OrderDashboard />

      <h2 className={styles.homeSectionTitle}>오버레이 설정</h2>
      <div className={styles.operationsGrid}>
      <section className={`${styles.block} ${styles.primaryBlock}`}>
        <h2>지금 오픈 중</h2>
        {opening ? (
          <div className={styles.row}>
            <span>{opening.user_id}</span>
            {opening.youtube_nickname && (
              <span className={styles.ytBadge}>YT: {opening.youtube_nickname}</span>
            )}
            <span className={styles.orderDescription}>
              {opening.product} × {opening.quantity}
            </span>
            {opening.paid_at && <span className={styles.paidBadge}>입금완료</span>}
            <button className={styles.completeButton} onClick={() => completeOrder(opening.id)}>
              오픈완료
            </button>
          </div>
        ) : (
          <p className={styles.empty}>없음</p>
        )}
      </section>

      <section className={styles.block} id="waiting-orders">
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
      </div>

      <div className={styles.toolsGrid}>
      <section className={styles.block}>
        <h2>히트 카드 등록</h2>
        <form className={styles.form} onSubmit={addHit}>
          <div className={styles.field}>
            <label className={styles.fieldLabel}>구매자</label>
            <input
              placeholder="구매자명 입력"
              value={hitForm.userId}
              onChange={(e) => setHitForm({ ...hitForm, userId: e.target.value })}
            />
          </div>
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
                {h.user_id}
                {h.youtube_nickname ? ` (YT: ${h.youtube_nickname})` : ""} — {h.card}
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

      <section className={styles.block}>
        <h2>주문 수동 추가</h2>
        <form className={styles.form} onSubmit={addManualOrder}>
          <div className={styles.field}>
            <label className={styles.fieldLabel}>구매자</label>
            <input
              placeholder="구매자명 입력"
              value={form.userId}
              onChange={(e) => setForm({ ...form, userId: e.target.value })}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.fieldLabel}>유튜브 닉네임</label>
            <input
              placeholder="유튜브 닉네임 입력(선택)"
              value={form.youtubeNickname}
              onChange={(e) => setForm({ ...form, youtubeNickname: e.target.value })}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.fieldLabel}>상품명</label>
            <input
              placeholder="상품명 입력"
              value={form.product}
              onChange={(e) => setForm({ ...form, product: e.target.value })}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.fieldLabel}>구매수량</label>
            <input
              type="number"
              min={1}
              placeholder="수량 입력"
              value={form.quantity}
              onChange={(e) => setForm({ ...form, quantity: Number(e.target.value) })}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.fieldLabel}>금액</label>
            <input
              type="number"
              min={0}
              placeholder="금액 입력"
              value={form.unitPrice}
              onChange={(e) => setForm({ ...form, unitPrice: Number(e.target.value) })}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.fieldLabel}>등급</label>
            <input
              placeholder="등급 입력(선택)"
              value={form.tier}
              onChange={(e) => setForm({ ...form, tier: e.target.value })}
            />
          </div>
          <button type="submit">추가</button>
        </form>
      </section>
      </div>

      {toasts.length > 0 && (
        <div className={styles.toastStack}>
          {toasts.map((t) => (
            <div key={t.id} className={styles.toast}>
              <strong>🔔 새 주문 접수</strong>
              <span>
                {t.userId} · {t.product}
              </span>
            </div>
          ))}
        </div>
      )}
      </>
      )}

      {showOverlayPreview && (
        <section className={styles.overlayPreviewPage} aria-labelledby="overlay-preview-title">
          <div className={`${styles.overlayEditorModal} ${styles.overlayEditorPage}`}>
            <div className={`${styles.modalTopBarWithTitle} ${styles.overlayModalHeader}`}>
              <div className={styles.overlayModalHero}>
                <h2 className={styles.modalTitle} id="overlay-preview-title">라이브 오버레이 미리보기</h2>
              </div>
              <div className={styles.overlayModalActions}>
                <button
                  className={`${styles.modalActionButton} ${editingOverlay ? styles.modalActionActive : ""}`}
                  onClick={() => setEditingOverlay((value) => !value)}
                >
                  {editingOverlay ? "편집 취소" : "편집"}
                </button>
                {editingOverlay && (
                  <>
                    <button
                      className={`${styles.modalActionButton} ${overlayEditorState.panelBackgroundVisible ? styles.orderActive : styles.orderInactive}`}
                      onClick={() => overlayEditorRef.current?.togglePanelBackgroundVisibility()}
                    >
                      카드 배경 {overlayEditorState.panelBackgroundVisible ? "ON" : "OFF"}
                    </button>
                    <button
                      className={`${styles.modalActionButton} ${styles.saveActionButton}`}
                      onClick={() => overlayEditorRef.current?.saveSettings()}
                      disabled={overlayEditorState.saving}
                    >
                      {overlayEditorState.saving ? "저장 중" : "저장"}
                    </button>
                  </>
                )}
              </div>
            </div>
            {editingOverlay && (
              <div className={styles.colorEditor} aria-label="오버레이 색상 설정">
                {([
                  ["orderAccent", "주문 접수"],
                  ["hitAccent", "히트카드"],
                  ["liveAccent", "진행 카드"],
                  ["panelBackground", "카드 배경"],
                  ["primaryText", "등급·기본"],
                  ["orderText", "주문 접수 글자"],
                  ["hitHeaderText", "히트 제목"],
                  ["hitBuyerText", "히트 구매자"],
                  ["hitCardText", "히트 카드명"],
                  ["liveHeaderText", "진행 제목"],
                  ["liveBuyerText", "진행 구매자"],
                  ["liveProductText", "진행 상품명"],
                  ["queueBuyerText", "대기 구매자"],
                  ["queueProductText", "대기 상품명"],
                  ["quantityText", "수량"],
                  ["timerText", "타이머"],
                ] as const).map(([key, label]) => (
                  <label className={styles.colorField} key={key}>
                    <span>{label}</span>
                    <input
                      type="color"
                      value={overlayEditorState.colors[key]}
                      onChange={(event) => overlayEditorRef.current?.updateColor(key, event.target.value)}
                    />
                    <code>{overlayEditorState.colors[key].toUpperCase()}</code>
                  </label>
                ))}
                <label className={styles.opacityField}>
                  <span>카드 배경 투명도</span>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={overlayEditorState.panelBackgroundTransparency}
                    onChange={(event) => overlayEditorRef.current?.updatePanelBackgroundTransparency(Number(event.target.value))}
                  />
                  <output>{overlayEditorState.panelBackgroundTransparency}%</output>
                </label>
              </div>
            )}
            <div className={styles.overlayPreviewCanvas}>
              <CardBreakFrame
                ref={overlayEditorRef}
                showScaleControls={editingOverlay}
                onSaved={() => setEditingOverlay(false)}
                onEditorStateChange={handleOverlayEditorState}
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
      <button className={styles.themeFab} onClick={toggleTheme} aria-label={`${theme === "dark" ? "라이트" : "다크"} 모드로 전환`}>
        {theme === "dark" ? "☀ 라이트" : "◐ 다크"}
      </button>
    </main>
  );
}
