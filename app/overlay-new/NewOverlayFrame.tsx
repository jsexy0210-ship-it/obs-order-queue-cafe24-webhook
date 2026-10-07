"use client";

import { useEffect, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { useLiveCardBreak } from "@/app/useLiveCardBreak";
import { type NewOverlayPanelId, type NewOverlayPanelSettings, type OverlaySettings } from "@/lib/overlaySettings";
import styles from "./new-overlay.module.css";

type Props = {
  preview?: boolean;
  settingsOverride?: OverlaySettings;
  editing?: boolean;
  onPanelChange?: (id: NewOverlayPanelId, patch: Partial<NewOverlayPanelSettings>) => void;
};

type RankingRow = { rank: number; youtubeNickname: string | null; orderCount: number };
type Interaction = { id: NewOverlayPanelId; mode: "move" | "resize"; startX: number; startY: number; panel: NewOverlayPanelSettings };

function nickname(value: string | null | undefined) {
  return (value ?? "-").replace(/\([^)]*\)/g, "").trim() || "-";
}

function nowLabel(value: Date) {
  return new Intl.DateTimeFormat("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Seoul" })
    .format(value).replace(/\. /g, ".").replace(/\.$/, "");
}

export default function NewOverlayFrame({ preview = false, settingsOverride, editing = false, onPanelChange }: Props) {
  const live = useLiveCardBreak();
  const settings = settingsOverride ?? live.overlaySettings;
  const [ranking, setRanking] = useState<RankingRow[]>([]);
  const [now, setNow] = useState(() => new Date());
  const [interaction, setInteraction] = useState<Interaction | null>(null);
  const activeOrder = live.opening ?? live.waiting[0] ?? null;
  const nextOrder = live.waiting[0] ?? null;
  const champion = ranking[0] ?? null;
  const challengers = ranking.slice(1);

  useEffect(() => {
    let cancelled = false;
    const loadRanking = () => {
      fetch("/api/overlay-ranking", { cache: "no-store" })
        .then((response) => response.ok ? response.json() : Promise.reject(new Error("ranking failed")))
        .then((data: { ranking?: RankingRow[] }) => { if (!cancelled) setRanking((data.ranking ?? []).slice(0, 5)); })
        .catch(() => { if (!cancelled) setRanking([]); });
    };
    loadRanking();
    const timer = window.setInterval(loadRanking, 30_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
  const panelStyle = (id: NewOverlayPanelId) => {
    const panel = settings.newOverlay.panels[id];
    return {
      left: `${panel.x}%`, top: `${panel.y}%`, width: `${panel.width}%`, height: `${panel.height}%`,
      "--panel-background-color": panel.backgroundColor,
      "--panel-background-opacity": String(panel.backgroundOpacity / 100),
      "--panel-title-background-color": panel.titleBackgroundColor,
      "--panel-border-color": panel.borderColor,
      "--panel-title-color": panel.titleColor,
      "--panel-text-color": panel.textColor,
      "--border-effect-duration": `${panel.effectDurationSeconds}s`,
      "--text-effect-duration": `${panel.effectDurationSeconds}s`,
      "--ranking-flow-duration": `${settings.newOverlay.rankingFlowSeconds}s`,
    } as CSSProperties;
  };

  const panelClassName = (id: NewOverlayPanelId, panelClass: string) => {
    const panel = settings.newOverlay.panels[id];
    const borderEffectClass = panel.borderEffect === "shine" ? styles.borderEffectShine : panel.borderEffect === "pulse" ? styles.borderEffectPulse : styles.borderEffectNone;
    const textEffectClass = panel.textEffect === "glow" ? styles.textEffectGlow : panel.textEffect === "pulse" ? styles.textEffectPulse : panel.textEffect === "flow" ? styles.textEffectFlow : styles.textEffectNone;
    return `${styles.panel} ${panelClass} ${borderEffectClass} ${textEffectClass} ${editing ? styles.editablePanel : ""}`;
  };

  function startInteraction(id: NewOverlayPanelId, mode: Interaction["mode"], event: ReactPointerEvent<HTMLElement>) {
    if (!editing || !onPanelChange) return;
    event.preventDefault();
    event.stopPropagation();
    setInteraction({ id, mode, startX: event.clientX, startY: event.clientY, panel: { ...settings.newOverlay.panels[id] } });
    const panelElement = event.currentTarget.closest("section");
    if (panelElement instanceof HTMLElement) panelElement.setPointerCapture(event.pointerId);
  }

  function moveInteraction(event: ReactPointerEvent<HTMLElement>) {
    const stage = event.currentTarget.parentElement?.getBoundingClientRect();
    if (!interaction || !stage || !onPanelChange) return;
    const dx = ((event.clientX - interaction.startX) / stage.width) * 100;
    const dy = ((event.clientY - interaction.startY) / stage.height) * 100;
    let { x, y, width, height } = interaction.panel;
    if (interaction.mode === "move") { x += dx; y += dy; } else { width += dx; height += dy; }
    width = clamp(width, 18, 96);
    height = clamp(height, 8, 60);
    x = clamp(x, 0, 100 - width);
    y = clamp(y, 0, 94 - height);
    onPanelChange(interaction.id, { x, y, width, height });
  }

  function endInteraction(event: ReactPointerEvent<HTMLElement>) {
    if (!interaction) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setInteraction(null);
  }

  const editHandle = (id: NewOverlayPanelId) => editing && <span className={styles.resizeHandle} aria-label={`${id} 카드 크기 조절`} onPointerDown={(event) => startInteraction(id, "resize", event)} />;
  const panelEvents = (id: NewOverlayPanelId) => ({
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => startInteraction(id, "move", event),
    onPointerMove: moveInteraction,
    onPointerUp: endInteraction,
    onPointerCancel: endInteraction,
  });

  return (
    <main className={`${styles.shell} ${preview ? styles.previewShell : styles.liveShell}`} aria-label="망고TCG 신규 라이브 오버레이">
      {settings.newOverlay.panels.ranking.visible && <section className={panelClassName("ranking", styles.rankingPanel)} style={panelStyle("ranking")} {...panelEvents("ranking")}>
          <header className={styles.panelHeader}><span className={styles.crown}>♛</span><div><small>XP 받기</small><strong>{settings.newOverlay.panels.ranking.title}</strong></div><b>TOP 5</b></header>
          <div className={styles.rankingList}>
            {champion ? <div className={`${styles.rankingRow} ${styles.rankOne}`}><em>1</em><span>{nickname(champion.youtubeNickname)}</span><b>{champion.orderCount}건</b></div> : <div className={styles.emptyRow}>명예의 전당 집계 중</div>}
            {challengers.length > 0 && <div className={styles.rankingFlowViewport} aria-label="명예의 전당 2위 이하 순위"><div className={`${styles.rankingFlowTrack} ${challengers.length > 1 ? styles.rankingFlowActive : ""}`}>{(challengers.length > 1 ? [false, true] : [false]).map((copy) => <div className={styles.rankingFlowGroup} key={copy ? "next-cycle" : "current-cycle"} aria-hidden={copy || undefined}>{challengers.map((row) => <div className={styles.rankingRow} key={`${row.rank}-${copy ? "next" : "current"}`}><em>{row.rank}</em><span>{nickname(row.youtubeNickname)}</span><b>{row.orderCount}건</b></div>)}</div>)}</div></div>}
          </div>
          {editHandle("ranking")}
        </section>}

      {settings.newOverlay.panels.live.visible && <section className={panelClassName("live", styles.livePanel)} style={panelStyle("live")} {...panelEvents("live")}>
          <header className={styles.liveHeader}><span className={styles.liveDot} /><small>{settings.newOverlay.panels.live.title}</small><strong>실시간 카드브레이크 진행</strong></header>
          <div className={styles.liveShine} aria-hidden="true" /><p>오늘의 카드 오픈 현황을 실시간으로 보여드립니다</p>{editHandle("live")}
        </section>}

      {settings.newOverlay.panels.schedule.visible && <section className={panelClassName("schedule", styles.schedulePanel)} style={panelStyle("schedule")} {...panelEvents("schedule")}>
          <small>LIVE NOW</small><strong>{settings.newOverlay.panels.schedule.title}</strong><time>{nowLabel(now)}</time>{editHandle("schedule")}
        </section>}

      {settings.newOverlay.panels.current.visible && <section className={panelClassName("current", styles.currentPanel)} style={panelStyle("current")} {...panelEvents("current")}>
          <header className={styles.currentHeader}><span>{settings.newOverlay.panels.current.title}</span><b>{live.opening ? "오픈" : "대기"}</b></header>
          {activeOrder ? <div className={styles.currentBody}><div className={styles.nicknameTicker}><strong>{nickname(activeOrder.youtube_nickname) === "-" ? activeOrder.user_id : nickname(activeOrder.youtube_nickname)}</strong></div><b>{activeOrder.product}</b><span>× {activeOrder.quantity}</span></div> : <p className={styles.currentEmpty}>대기 중</p>}
          <div className={styles.hitLine}><span>HIT</span><b>{live.hitCards[0] ? `◆ ${nickname(live.hitCards[0].youtube_nickname)} · ${live.hitCards[0].card}` : "오늘의 히트카드를 기다리는 중"}</b></div>
          <div className={styles.waitingLine}><span>주문 대기</span><b>{nextOrder ? `${nickname(nextOrder.youtube_nickname) === "-" ? nextOrder.user_id : nickname(nextOrder.youtube_nickname)} · ${nextOrder.product}` : "대기 주문 없음"}</b><em>{live.waiting.length}건</em></div>
          {editHandle("current")}
        </section>}
    </main>
  );
}
