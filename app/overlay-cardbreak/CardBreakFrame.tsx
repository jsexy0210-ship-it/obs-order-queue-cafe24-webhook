"use client";

import {
  useEffect,
  forwardRef,
  useImperativeHandle,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import styles from "./cardbreak.module.css";
import { useLiveCardBreak } from "@/app/useLiveCardBreak";
import type { OverlaySettings } from "@/lib/overlaySettings";

function useCountdown(startedAt: string | null, timerSeconds: number | null) {
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    if (!startedAt || !timerSeconds) {
      setRemaining(null);
      return;
    }

    // SQLite의 datetime('now')는 UTC 기준이라 'Z'를 붙여 명시적으로 파싱합니다.
    const startMs = new Date(`${startedAt.replace(" ", "T")}Z`).getTime();

    const tick = () => {
      const elapsed = Math.floor((Date.now() - startMs) / 1000);
      setRemaining(Math.max(timerSeconds - elapsed, 0));
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [startedAt, timerSeconds]);

  return remaining;
}

function formatTimer(seconds: number | null) {
  if (seconds === null) return "--:--";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function cancelLabel(reason: string | null) {
  return reason === "refunded" ? "환불됨" : "취소됨";
}

/**
 * 유튜브 닉네임이 있으면 "닉네임(구매자명)" 형식으로, 없으면 구매자명만 보여줍니다.
 */
function formatBuyer(userId: string, youtubeNickname: string | null | undefined) {
  return youtubeNickname ? `${youtubeNickname}(${userId})` : userId;
}

const cancelledBadgeStyle: CSSProperties = {
  display: "inline-block",
  marginBottom: 6,
  padding: "3px 8px",
  borderRadius: 6,
  background: "#ff4d5f",
  color: "#fff",
  fontSize: 11,
  fontWeight: 900,
  letterSpacing: "0.04em",
};

const DEFAULT_SCALE = 1;
const MIN_SCALE = 0.6;
const MAX_SCALE = 1.8;
const SCALE_STEP = 0.1;
const SCALE_STORAGE_KEY = "cardbreak-overlay-scale";
const POSITION_STORAGE_KEY = "cardbreak-overlay-position";
const ORDER_VISIBILITY_STORAGE_KEY = "cardbreak-order-visible";

type PanelPosition = {
  orderX: number;
  orderY: number;
  hitX: number;
  hitY: number;
  rightX: number;
  rightY: number;
};

type PanelSide = "order" | "hit" | "right";
type PanelScales = { order: number; hit: number; right: number };
type PanelWidths = { order: number; hit: number; right: number };

const DEFAULT_POSITION: PanelPosition = {
  orderX: 0,
  orderY: 0,
  hitX: 0,
  hitY: 0,
  rightX: 0,
  rightY: 0,
};

function clampScale(value: number) {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round(value * 10) / 10));
}

function clampPosition(position: PanelPosition): PanelPosition {
  const clamp = (value: number, min: number, max: number) =>
    Math.min(max, Math.max(min, Number.isFinite(value) ? value : 0));

  return {
    orderX: clamp(position.orderX, 0, 48),
    orderY: clamp(position.orderY, 0, 82),
    hitX: clamp(position.hitX, 0, 48),
    hitY: clamp(position.hitY, 0, 82),
    // 오른쪽 기준 패널은 양수 X 이동 시 즉시 화면 밖으로 밀립니다.
    rightX: clamp(position.rightX, -32, 0),
    rightY: clamp(position.rightY, 0, 82),
  };
}

function readInitialScales(): PanelScales {
  const params = new URLSearchParams(window.location.search);
  const commonScale = Number(params.get("scale"));
  const savedRaw = window.localStorage.getItem(SCALE_STORAGE_KEY);
  let saved: Partial<PanelScales> = {};
  try {
    saved = savedRaw?.startsWith("{") ? JSON.parse(savedRaw) : {};
  } catch {
    saved = {};
  }
  const legacyScale = Number(savedRaw);
  const legacyLeftScale = Number(params.get("ls"));
  const read = (key: "os" | "hs" | "rs", side: PanelSide) => {
    const own = Number(params.get(key));
    if (Number.isFinite(own) && own > 0) return clampScale(own);
    if (Number.isFinite(commonScale) && commonScale > 0) return clampScale(commonScale);
    if (side !== "right" && Number.isFinite(legacyLeftScale) && legacyLeftScale > 0) {
      return clampScale(legacyLeftScale);
    }
    const stored = Number(saved[side]);
    if (Number.isFinite(stored) && stored > 0) return clampScale(stored);
    return Number.isFinite(legacyScale) && legacyScale > 0 ? clampScale(legacyScale) : DEFAULT_SCALE;
  };
  return {
    order: read("os", "order"),
    hit: read("hs", "hit"),
    right: read("rs", "right"),
  };
}

function readInitialPosition(): PanelPosition {
  const params = new URLSearchParams(window.location.search);
  const saved = window.localStorage.getItem(POSITION_STORAGE_KEY);
  let stored: Partial<PanelPosition> = {};

  try {
    stored = saved ? (JSON.parse(saved) as Partial<PanelPosition>) : {};
  } catch {
    stored = {};
  }

  const readValue = (queryKey: string, storageKey: keyof PanelPosition) => {
    const queryValue = Number(params.get(queryKey));
    if (Number.isFinite(queryValue)) return queryValue;
    const storedValue = Number(stored[storageKey]);
    return Number.isFinite(storedValue) ? storedValue : 0;
  };

  return clampPosition({
    orderX: readValue("ox", "orderX") || readValue("lx", "orderX"),
    orderY: readValue("oy", "orderY") || readValue("ly", "orderY"),
    hitX: readValue("hx", "hitX") || readValue("lx", "hitX"),
    hitY: readValue("hy", "hitY") || readValue("ly", "hitY"),
    rightX: readValue("rx", "rightX"),
    rightY: readValue("ry", "rightY"),
  });
}

function readInitialOrderVisibility() {
  const queryValue = new URLSearchParams(window.location.search).get("order");
  if (queryValue === "0") return false;
  if (queryValue === "1") return true;
  return window.localStorage.getItem(ORDER_VISIBILITY_STORAGE_KEY) !== "0";
}

type CardBreakFrameProps = {
  showScaleControls?: boolean;
  onSaved?: () => void;
  onEditorStateChange?: (state: {
    orderVisible: boolean;
    saving: boolean;
    colors: OverlaySettings["colors"];
  }) => void;
};

export type CardBreakFrameHandle = {
  toggleOrderVisibility: () => void;
  saveSettings: () => Promise<void>;
  updateColor: (key: keyof OverlaySettings["colors"], value: string) => void;
};

const CardBreakFrame = forwardRef<CardBreakFrameHandle, CardBreakFrameProps>(function CardBreakFrame(
  { showScaleControls = false, onSaved, onEditorStateChange },
  ref
) {
  const { opening, waiting, hitCards, overlaySettings } = useLiveCardBreak();
  const remaining = useCountdown(opening?.started_at ?? null, opening?.timer_seconds ?? null);
  const [scales, setScales] = useState<PanelScales>({ order: DEFAULT_SCALE, hit: DEFAULT_SCALE, right: DEFAULT_SCALE });
  const scalesRef = useRef<PanelScales>({ order: DEFAULT_SCALE, hit: DEFAULT_SCALE, right: DEFAULT_SCALE });
  const [widths, setWidths] = useState<PanelWidths>(overlaySettings.widths);
  const widthsRef = useRef<PanelWidths>(overlaySettings.widths);
  const [position, setPosition] = useState<PanelPosition>(DEFAULT_POSITION);
  const positionRef = useRef<PanelPosition>(DEFAULT_POSITION);
  const [dragging, setDragging] = useState<PanelSide | null>(null);
  const [orderVisible, setOrderVisible] = useState(true);
  const [saving, setSaving] = useState(false);
  const [colors, setColors] = useState(overlaySettings.colors);
  const colorsRef = useRef(overlaySettings.colors);
  const dragRef = useRef<{
    side: PanelSide;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);
  const resizeRef = useRef<{
    side: PanelSide;
    startX: number;
    startY: number;
    originScale: number;
    width: number;
    height: number;
  } | null>(null);
  const widthResizeRef = useRef<{
    side: PanelSide;
    startX: number;
    originWidth: number;
  } | null>(null);

  useEffect(() => {
    const initialScales = readInitialScales();
    scalesRef.current = initialScales;
    setScales(initialScales);
    const initialPosition = readInitialPosition();
    positionRef.current = initialPosition;
    setPosition(initialPosition);
    setOrderVisible(readInitialOrderVisibility());
  }, []);

  useEffect(() => {
    const safePosition = clampPosition(overlaySettings.position);
    scalesRef.current = overlaySettings.scales;
    widthsRef.current = overlaySettings.widths;
    positionRef.current = safePosition;
    setScales(overlaySettings.scales);
    setWidths(overlaySettings.widths);
    setPosition(safePosition);
    setOrderVisible(overlaySettings.orderVisible);
    colorsRef.current = overlaySettings.colors;
    setColors(overlaySettings.colors);
  }, [overlaySettings]);

  async function saveSettings() {
    const settings: OverlaySettings = {
      orderVisible,
      scales: scalesRef.current,
      widths: widthsRef.current,
      position: positionRef.current,
      colors: colorsRef.current,
    };
    setSaving(true);
    try {
      const response = await fetch("/api/overlay-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      if (!response.ok) throw new Error("save failed");
      onSaved?.();
    } catch {
      window.alert("오버레이 설정 저장에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  }

  function updateColor(key: keyof OverlaySettings["colors"], value: string) {
    const nextColors = { ...colorsRef.current, [key]: value };
    colorsRef.current = nextColors;
    setColors(nextColors);
  }

  useImperativeHandle(ref, () => ({ toggleOrderVisibility, saveSettings, updateColor }));

  useEffect(() => {
    onEditorStateChange?.({ orderVisible, saving, colors });
  }, [colors, onEditorStateChange, orderVisible, saving]);

  function toggleOrderVisibility() {
    const nextVisible = !orderVisible;
    setOrderVisible(nextVisible);
    window.localStorage.setItem(ORDER_VISIBILITY_STORAGE_KEY, nextVisible ? "1" : "0");
    const url = new URL(window.location.href);
    url.searchParams.set("order", nextVisible ? "1" : "0");
    window.history.replaceState({}, "", url);
  }

  function persistScales(nextScales: PanelScales) {
    window.localStorage.setItem(SCALE_STORAGE_KEY, JSON.stringify(nextScales));

    const url = new URL(window.location.href);
    url.searchParams.delete("scale");
    url.searchParams.delete("ls");
    url.searchParams.set("os", nextScales.order.toFixed(1));
    url.searchParams.set("hs", nextScales.hit.toFixed(1));
    url.searchParams.set("rs", nextScales.right.toFixed(1));
    window.history.replaceState({}, "", url);
  }

  function updateScale(nextScale: number) {
    const normalized = clampScale(nextScale);
    const nextScales = { order: normalized, hit: normalized, right: normalized };
    scalesRef.current = nextScales;
    setScales(nextScales);
    persistScales(nextScales);
  }

  function startResizing(side: PanelSide, event: ReactPointerEvent<HTMLButtonElement>) {
    event.stopPropagation();
    const panel = event.currentTarget.parentElement;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    resizeRef.current = {
      side,
      startX: event.clientX,
      startY: event.clientY,
      originScale: scalesRef.current[side],
      width: rect.width,
      height: rect.height,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function resizePanel(event: ReactPointerEvent<HTMLButtonElement>) {
    const resize = resizeRef.current;
    if (!resize) return;
    const ratioDelta = Math.max(
      (event.clientX - resize.startX) / Math.max(resize.width, 1),
      (event.clientY - resize.startY) / Math.max(resize.height, 1)
    );
    const nextScale = clampScale(resize.originScale * (1 + ratioDelta));
    const nextScales = { ...scalesRef.current, [resize.side]: nextScale };
    scalesRef.current = nextScales;
    setScales(nextScales);
  }

  function stopResizing(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!resizeRef.current) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    resizeRef.current = null;
    persistScales(scalesRef.current);
  }

  function startWidthResizing(side: PanelSide, event: ReactPointerEvent<HTMLButtonElement>) {
    event.stopPropagation();
    widthResizeRef.current = {
      side,
      startX: event.clientX,
      originWidth: widthsRef.current[side],
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function resizePanelWidth(event: ReactPointerEvent<HTMLButtonElement>) {
    const resize = widthResizeRef.current;
    if (!resize) return;
    const delta = ((event.clientX - resize.startX) / Math.max(window.innerWidth, 1)) * 100;
    const direction = resize.side === "right" ? -1 : 1;
    const nextWidth = Math.min(90, Math.max(28, resize.originWidth + delta * direction));
    const nextWidths = { ...widthsRef.current, [resize.side]: nextWidth };
    widthsRef.current = nextWidths;
    setWidths(nextWidths);
  }

  function stopWidthResizing(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!widthResizeRef.current) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    widthResizeRef.current = null;
  }

  function persistPosition(nextPosition: PanelPosition) {
    const safePosition = clampPosition(nextPosition);
    positionRef.current = safePosition;
    setPosition(safePosition);
    window.localStorage.setItem(POSITION_STORAGE_KEY, JSON.stringify(safePosition));

    const url = new URL(window.location.href);
    url.searchParams.delete("lx");
    url.searchParams.delete("ly");
    url.searchParams.set("ox", safePosition.orderX.toFixed(2));
    url.searchParams.set("oy", safePosition.orderY.toFixed(2));
    url.searchParams.set("hx", safePosition.hitX.toFixed(2));
    url.searchParams.set("hy", safePosition.hitY.toFixed(2));
    url.searchParams.set("rx", safePosition.rightX.toFixed(2));
    url.searchParams.set("ry", safePosition.rightY.toFixed(2));
    window.history.replaceState({}, "", url);
  }

  function startDragging(side: PanelSide, event: ReactPointerEvent<HTMLElement>) {
    if (!showScaleControls || event.button !== 0) return;
    const originX = side === "order" ? position.orderX : side === "hit" ? position.hitX : position.rightX;
    const originY = side === "order" ? position.orderY : side === "hit" ? position.hitY : position.rightY;
    dragRef.current = {
      side,
      startX: event.clientX,
      startY: event.clientY,
      originX,
      originY,
    };
    setDragging(side);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function movePanel(event: ReactPointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    if (!drag) return;

    const nextX = drag.originX + ((event.clientX - drag.startX) / window.innerWidth) * 100;
    const nextY = drag.originY + ((event.clientY - drag.startY) / window.innerHeight) * 100;

    setPosition((current) => {
      const nextPosition =
      drag.side === "order"
        ? { ...current, orderX: nextX, orderY: nextY }
        : drag.side === "hit"
          ? { ...current, hitX: nextX, hitY: nextY }
          : { ...current, rightX: nextX, rightY: nextY };
      const safePosition = clampPosition(nextPosition);
      positionRef.current = safePosition;
      return safePosition;
    });
  }

  function stopDragging(event: ReactPointerEvent<HTMLElement>) {
    if (!dragRef.current) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    dragRef.current = null;
    setDragging(null);
    persistPosition(positionRef.current);
  }

  function resetPosition() {
    positionRef.current = DEFAULT_POSITION;
    setPosition(DEFAULT_POSITION);
    persistPosition(DEFAULT_POSITION);
  }

  const stageStyle = {
    "--order-scale": scales.order,
    "--hit-scale": scales.hit,
    "--right-scale": scales.right,
    "--order-width": `${widths.order}%`,
    "--hit-width": `${widths.hit}%`,
    "--right-width": `${widths.right}%`,
    "--order-x": `${position.orderX}vw`,
    "--order-y": `${position.orderY}vh`,
    "--hit-x": `${position.hitX}vw`,
    "--hit-y": `${position.hitY}vh`,
    "--right-x": `${position.rightX}vw`,
    "--right-y": `${position.rightY}vh`,
    "--order-accent": colors.orderAccent,
    "--hit-accent": colors.hitAccent,
    "--live-accent": colors.liveAccent,
    "--panel-background": colors.panelBackground,
    "--primary-text": colors.primaryText,
    "--order-text": colors.orderText,
    "--hit-header-text": colors.hitHeaderText,
    "--hit-buyer-text": colors.hitBuyerText,
    "--hit-card-text": colors.hitCardText,
    "--live-header-text": colors.liveHeaderText,
    "--live-buyer-text": colors.liveBuyerText,
    "--live-product-text": colors.liveProductText,
    "--queue-buyer-text": colors.queueBuyerText,
    "--queue-product-text": colors.queueProductText,
    "--quantity-text": colors.quantityText,
    "--timer-text": colors.timerText,
  } as CSSProperties;

  return (
    <div className={styles.stage} style={stageStyle}>
      {showScaleControls && (
        <div className={styles.scaleControls} aria-label="카드덱 크기 조절">
          <button
            type="button"
            onClick={() => updateScale(Math.min(scales.order, scales.hit, scales.right) - SCALE_STEP)}
            disabled={scales.order <= MIN_SCALE && scales.hit <= MIN_SCALE && scales.right <= MIN_SCALE}
            aria-label="카드덱 줄이기"
          >
            −
          </button>
          <button
            type="button"
            className={styles.scaleValue}
            onClick={() => updateScale(DEFAULT_SCALE)}
            aria-label="카드덱 크기 초기화"
            title="기본 크기로 초기화"
          >
            {scales.order === scales.hit && scales.hit === scales.right ? `${Math.round(scales.order * 100)}%` : "개별 크기"}
          </button>
          <button
            type="button"
            onClick={() => updateScale(Math.max(scales.order, scales.hit, scales.right) + SCALE_STEP)}
            disabled={scales.order >= MAX_SCALE && scales.hit >= MAX_SCALE && scales.right >= MAX_SCALE}
            aria-label="카드덱 늘리기"
          >
            +
          </button>
          <button
            type="button"
            className={styles.resetPosition}
            onClick={resetPosition}
            aria-label="카드덱 위치 초기화"
          >
            위치 초기화
          </button>
        </div>
      )}
      {orderVisible && <section
        className={`${styles.orderPanel} ${showScaleControls ? styles.movablePanel : ""} ${dragging === "order" ? styles.draggingPanel : ""}`}
        onPointerDown={(event) => startDragging("order", event)}
        onPointerMove={movePanel}
        onPointerUp={stopDragging}
        onPointerCancel={stopDragging}
      >
        {showScaleControls && (
          <>
            <button
              type="button"
              className={styles.resizeHandle}
              aria-label="주문 접수 카드 전체 크기 조절"
              onPointerDown={(event) => startResizing("order", event)}
              onPointerMove={resizePanel}
              onPointerUp={stopResizing}
              onPointerCancel={stopResizing}
            />
            <button
              type="button"
              className={styles.widthHandle}
              aria-label="주문 접수 카드 좌우 너비 조절"
              onPointerDown={(event) => startWidthResizing("order", event)}
              onPointerMove={resizePanelWidth}
              onPointerUp={stopWidthResizing}
              onPointerCancel={stopWidthResizing}
            />
          </>
        )}
        <div className={styles.orderLink}>
          <span className={styles.linkIcon}>◎</span>
          <span>주문 접수 · mangotcg.com</span>
        </div>
      </section>}

      <section
        className={`${styles.hitPanel} ${showScaleControls ? styles.movablePanel : ""} ${dragging === "hit" ? styles.draggingPanel : ""}`}
        onPointerDown={(event) => startDragging("hit", event)}
        onPointerMove={movePanel}
        onPointerUp={stopDragging}
        onPointerCancel={stopDragging}
      >
        {showScaleControls && (
          <>
            <button
              type="button"
              className={styles.resizeHandle}
              aria-label="오늘의 히트카드 전체 크기 조절"
              onPointerDown={(event) => startResizing("hit", event)}
              onPointerMove={resizePanel}
              onPointerUp={stopResizing}
              onPointerCancel={stopResizing}
            />
            <button
              type="button"
              className={styles.widthHandle}
              aria-label="오늘의 히트카드 좌우 너비 조절"
              onPointerDown={(event) => startWidthResizing("hit", event)}
              onPointerMove={resizePanelWidth}
              onPointerUp={stopWidthResizing}
              onPointerCancel={stopWidthResizing}
            />
          </>
        )}
        <div className={styles.panelBox}>
          <div className={styles.panelHeader}>
            <strong>오늘의 히트카드</strong>
          </div>

          <div className={styles.hitList}>
            {hitCards.length === 0 ? (
              <div className={styles.hitRow}>
                <span className={styles.rowIcon}>◆</span>
                <span style={{ opacity: 0.6 }}>등록된 히트카드 없음</span>
              </div>
            ) : (
              hitCards.map((item) => (
                <div className={styles.hitRow} key={item.id}>
                  <span className={styles.rowIcon}>◆</span>
                  <strong>{formatBuyer(item.user_id, item.youtube_nickname)}</strong>
                  <span>{item.card}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      <section
        className={`${styles.rightPanel} ${showScaleControls ? styles.movablePanel : ""} ${dragging === "right" ? styles.draggingPanel : ""}`}
        onPointerDown={(event) => startDragging("right", event)}
        onPointerMove={movePanel}
        onPointerUp={stopDragging}
        onPointerCancel={stopDragging}
      >
        {showScaleControls && (
          <>
            <button
              type="button"
              className={styles.resizeHandle}
              aria-label="오른쪽 카드덱 전체 크기 조절"
              onPointerDown={(event) => startResizing("right", event)}
              onPointerMove={resizePanel}
              onPointerUp={stopResizing}
              onPointerCancel={stopResizing}
            />
            <button
              type="button"
              className={styles.widthHandle}
              aria-label="오른쪽 카드덱 좌우 너비 조절"
              onPointerDown={(event) => startWidthResizing("right", event)}
              onPointerMove={resizePanelWidth}
              onPointerUp={stopWidthResizing}
              onPointerCancel={stopWidthResizing}
            />
          </>
        )}
        <div className={styles.nowBox}>
          <div className={styles.nowHeader}>
            <div>
              <strong>지금 오픈 중</strong>
            </div>
            <span className={styles.timer}>{formatTimer(remaining)}</span>
          </div>

          {opening ? (
            <div className={styles.heroCard}>
              {opening.status === "cancelled" && (
                <span style={cancelledBadgeStyle}>{cancelLabel(opening.cancel_reason)}</span>
              )}
              <div className={styles.heroMeta}>
                <span className={styles.gradeTag}>{opening.tier || "ORDER"}</span>
                <div className={styles.currentUser}>{formatBuyer(opening.user_id, opening.youtube_nickname)}</div>
              </div>

              <div className={styles.nowProduct}>
                <span className={styles.nowProductText}>{opening.product}</span>
                <b>x{opening.quantity}</b>
              </div>
            </div>
          ) : (
            <div className={styles.heroCard}>
              <div className={styles.emptyMessage}>
                대기 중인 주문 없음
              </div>
            </div>
          )}

          <div className={styles.queueList}>
            {waiting.map((order) => {
              const cancelled = order.status === "cancelled";

              return (
                <div
                  className={styles.queueRow}
                  key={order.id}
                  style={cancelled ? { opacity: 0.45 } : undefined}
                >
                  <span className={styles.gradeMini}>
                    {cancelled ? cancelLabel(order.cancel_reason) : order.tier || "-"}
                  </span>
                  <strong>{formatBuyer(order.user_id, order.youtube_nickname)}</strong>
                  <span className={styles.product}>{order.product}</span>
                  <b>x{order.quantity}</b>
                </div>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
});

export default CardBreakFrame;
