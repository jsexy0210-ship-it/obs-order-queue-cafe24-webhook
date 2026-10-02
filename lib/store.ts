import { db } from "./db";
import { broadcastUpdate } from "./events";
import { DEFAULT_OVERLAY_SETTINGS, type OverlaySettings } from "./overlaySettings";

export type OrderStatus = "waiting" | "opening" | "done" | "cancelled";

export type OrderRow = {
  id: number;
  source: string;
  external_order_id: string | null;
  user_id: string;
  member_id: string | null;
  product: string;
  product_image_url: string | null;
  quantity: number;
  unit_price: number;
  actual_amount: number | null;
  tier: string;
  status: OrderStatus;
  prev_status: string | null;
  cancel_reason: string | null;
  cancelled_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  paid_at: string | null;
  payment_method: string | null;
  payment_gateway_name: string | null;
  easypay_name: string | null;
  youtube_nickname: string | null;
  timer_seconds: number | null;
  created_at: string;
  is_first_order?: boolean;
  order_count?: number;
  ranking_rank?: number | null;
};

export type HitCardRow = {
  id: number;
  user_id: string;
  card: string;
  youtube_nickname: string | null;
  created_at: string;
};

export type LiveState = {
  opening: OrderRow | null;
  completed: OrderRow | null;
  waiting: OrderRow[];
  /** 카페24 무통장 주문 중 아직 입금완료 웹훅을 받지 않은 주문입니다. */
  pendingPayments: OrderRow[];
  /** 카페24에서 실제 취소·환불 처리된 주문입니다. 대기열에는 포함하지 않습니다. */
  cancelledOrders: OrderRow[];
  hitCards: HitCardRow[];
  overlaySettings: OverlaySettings;
};

export function getOverlaySettings(): OverlaySettings {
  const row = db.prepare("SELECT value FROM overlay_settings WHERE id = 1").get() as
    | { value: string }
    | undefined;
  if (!row) return DEFAULT_OVERLAY_SETTINGS;
  try {
    const saved = JSON.parse(row.value) as Partial<OverlaySettings>;
    // 이전 기본 문구는 새 표기법으로 읽어 화면과 편집값을 함께 맞춥니다.
    const savedRankingZone = saved.shorts?.zones?.ranking;
    const normalizedRankingZone = ["랭킹 TOP5", "Top 5"].includes(savedRankingZone?.title ?? "")
      ? { ...savedRankingZone!, title: "VIP" }
      : savedRankingZone;
    // 이전 편집기의 최소 높이 6%로 저장된 VIP는 요청한 축소 규격 3.6%로 읽습니다.
    // 관리 화면에서 다음 저장 시에도 3.6%가 그대로 유지됩니다.
    const rankingZone = Number(normalizedRankingZone?.height) === 6
      ? { ...normalizedRankingZone, height: 3.6 }
      : normalizedRankingZone;
    const savedHitZone = saved.shorts?.zones?.hit;
    const hitZone = savedHitZone?.accent === "#ff9214" && savedHitZone.titleColor === "#ffcf63"
      ? {
        ...savedHitZone,
        accent: DEFAULT_OVERLAY_SETTINGS.shorts.zones.hit.accent,
        titleColor: DEFAULT_OVERLAY_SETTINGS.shorts.zones.hit.titleColor,
        textColor: DEFAULT_OVERLAY_SETTINGS.shorts.zones.hit.textColor,
        titleBackgroundColor: DEFAULT_OVERLAY_SETTINGS.shorts.zones.hit.titleBackgroundColor,
        textBackgroundColor: DEFAULT_OVERLAY_SETTINGS.shorts.zones.hit.textBackgroundColor,
        borderColor: DEFAULT_OVERLAY_SETTINGS.shorts.zones.hit.borderColor,
        backgroundOpacity: DEFAULT_OVERLAY_SETTINGS.shorts.zones.hit.backgroundOpacity,
        backgroundColor: DEFAULT_OVERLAY_SETTINGS.shorts.zones.hit.backgroundColor,
        tickerDurationSeconds: DEFAULT_OVERLAY_SETTINGS.shorts.zones.hit.tickerDurationSeconds,
        template: savedHitZone.template === "·" ? "" : savedHitZone.template,
      }
      : savedHitZone?.template === "·"
        ? { ...savedHitZone, template: "" }
        : savedHitZone;
    const savedCurrentZone = saved.shorts?.zones?.current;
    const currentZone = savedCurrentZone?.accent === "#ed8e07" && savedCurrentZone.titleColor === "#ffca72"
      ? {
        ...savedCurrentZone,
        accent: DEFAULT_OVERLAY_SETTINGS.shorts.zones.current.accent,
        titleColor: DEFAULT_OVERLAY_SETTINGS.shorts.zones.current.titleColor,
        textColor: DEFAULT_OVERLAY_SETTINGS.shorts.zones.current.textColor,
        titleBackgroundColor: DEFAULT_OVERLAY_SETTINGS.shorts.zones.current.titleBackgroundColor,
        textBackgroundColor: DEFAULT_OVERLAY_SETTINGS.shorts.zones.current.textBackgroundColor,
        borderColor: DEFAULT_OVERLAY_SETTINGS.shorts.zones.current.borderColor,
        backgroundOpacity: DEFAULT_OVERLAY_SETTINGS.shorts.zones.current.backgroundOpacity,
        backgroundColor: DEFAULT_OVERLAY_SETTINGS.shorts.zones.current.backgroundColor,
        tickerDurationSeconds: DEFAULT_OVERLAY_SETTINGS.shorts.zones.current.tickerDurationSeconds,
        zIndex: savedCurrentZone.zIndex === 4 ? 3 : savedCurrentZone.zIndex,
      }
      : savedCurrentZone?.zIndex === 4
        ? { ...savedCurrentZone, zIndex: 3 }
        : savedCurrentZone;
    const savedAnnouncementZone = saved.shorts?.zones?.announcement;
    const announcementZone = savedAnnouncementZone?.accent === "#a855f7" && savedAnnouncementZone.titleColor === "#e5beff"
      ? {
        ...savedAnnouncementZone,
        accent: DEFAULT_OVERLAY_SETTINGS.shorts.zones.announcement.accent,
        titleColor: DEFAULT_OVERLAY_SETTINGS.shorts.zones.announcement.titleColor,
        textColor: DEFAULT_OVERLAY_SETTINGS.shorts.zones.announcement.textColor,
        titleBackgroundColor: DEFAULT_OVERLAY_SETTINGS.shorts.zones.announcement.titleBackgroundColor,
        textBackgroundColor: DEFAULT_OVERLAY_SETTINGS.shorts.zones.announcement.textBackgroundColor,
        borderColor: DEFAULT_OVERLAY_SETTINGS.shorts.zones.announcement.borderColor,
        backgroundOpacity: DEFAULT_OVERLAY_SETTINGS.shorts.zones.announcement.backgroundOpacity,
        backgroundColor: DEFAULT_OVERLAY_SETTINGS.shorts.zones.announcement.backgroundColor,
        tickerDurationSeconds: DEFAULT_OVERLAY_SETTINGS.shorts.zones.announcement.tickerDurationSeconds,
      }
      : savedAnnouncementZone;
    // 이전 카드형 신규 주문 설정은 하단 토스트 규격으로 읽어 전환합니다.
    const savedNewOrder = saved.shorts?.newOrder as Partial<OverlaySettings["shorts"]["newOrder"]> | undefined;
    const asToastZone = (zone: OverlaySettings["shorts"]["newOrder"]["first"]["zone"] | undefined) => {
      const isLegacyCard = ["첫 주문", "신규 주문", "VIP 주문"].includes(zone?.title ?? "");
      return isLegacyCard
        ? {
          ...zone,
          title: "N",
          template: "",
          x: 5,
          y: 64,
          width: 90,
          height: 7,
          motion: "slide-up" as const,
        }
        : zone;
    };
    const firstNewOrderZone = asToastZone(savedNewOrder?.first?.zone);
    const repeatNewOrderZone = asToastZone(savedNewOrder?.repeat?.zone);
    const vipNewOrderZone = asToastZone(savedNewOrder?.vip?.zone);
    const newOrder = {
      first: {
        durationSeconds: savedNewOrder?.first?.durationSeconds ?? DEFAULT_OVERLAY_SETTINGS.shorts.newOrder.first.durationSeconds,
        zone: {
          ...DEFAULT_OVERLAY_SETTINGS.shorts.newOrder.first.zone,
          ...firstNewOrderZone,
          title: firstNewOrderZone?.title ?? DEFAULT_OVERLAY_SETTINGS.shorts.newOrder.first.zone.title,
        },
      },
      repeat: {
        durationSeconds: savedNewOrder?.repeat?.durationSeconds ?? DEFAULT_OVERLAY_SETTINGS.shorts.newOrder.repeat.durationSeconds,
        zone: {
          ...DEFAULT_OVERLAY_SETTINGS.shorts.newOrder.repeat.zone,
          ...repeatNewOrderZone,
          title: repeatNewOrderZone?.title ?? DEFAULT_OVERLAY_SETTINGS.shorts.newOrder.repeat.zone.title,
        },
      },
      vip: {
        durationSeconds: savedNewOrder?.vip?.durationSeconds ?? DEFAULT_OVERLAY_SETTINGS.shorts.newOrder.vip.durationSeconds,
        zone: {
          ...DEFAULT_OVERLAY_SETTINGS.shorts.newOrder.vip.zone,
          ...vipNewOrderZone,
          title: vipNewOrderZone?.title ?? DEFAULT_OVERLAY_SETTINGS.shorts.newOrder.vip.zone.title,
        },
      },
    };
    return {
      ...DEFAULT_OVERLAY_SETTINGS,
      ...saved,
      scales: { ...DEFAULT_OVERLAY_SETTINGS.scales, ...saved.scales },
      widths: { ...DEFAULT_OVERLAY_SETTINGS.widths, ...saved.widths },
      position: { ...DEFAULT_OVERLAY_SETTINGS.position, ...saved.position },
      colors: { ...DEFAULT_OVERLAY_SETTINGS.colors, ...saved.colors },
      shorts: {
        ...DEFAULT_OVERLAY_SETTINGS.shorts,
        ...saved.shorts,
        newOrder,
        zones: {
          ...DEFAULT_OVERLAY_SETTINGS.shorts.zones,
          hit: { ...DEFAULT_OVERLAY_SETTINGS.shorts.zones.hit, ...hitZone },
          ranking: { ...DEFAULT_OVERLAY_SETTINGS.shorts.zones.ranking, ...rankingZone },
          current: { ...DEFAULT_OVERLAY_SETTINGS.shorts.zones.current, ...currentZone },
          announcement: { ...DEFAULT_OVERLAY_SETTINGS.shorts.zones.announcement, ...announcementZone },
        },
      },
    } as OverlaySettings;
  } catch {
    return DEFAULT_OVERLAY_SETTINGS;
  }
}

export function saveOverlaySettings(settings: OverlaySettings) {
  db.prepare(
    `INSERT INTO overlay_settings (id, value, updated_at) VALUES (1, ?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
  ).run(JSON.stringify(settings));
  broadcastUpdate();
}

export function getLiveState(): LiveState {
  const opening = db
    .prepare(
      `SELECT * FROM orders
       WHERE status = 'opening'
       ORDER BY started_at DESC LIMIT 1`
    )
    .get() as OrderRow | undefined;

  const waiting = db
    .prepare(
      `SELECT * FROM orders
       WHERE status = 'waiting' AND (source <> 'cafe24' OR paid_at IS NOT NULL)
       ORDER BY id ASC`
    )
    .all() as OrderRow[];

  // 무통장 주문은 입금완료 전에는 오버레이 대기열에 섞지 않습니다.
  // 카페24 입금완료 웹훅이 paid_at을 채우면 위 waiting 조회에 즉시 포함됩니다.
  const pendingPayments = db
    .prepare(
      `SELECT * FROM orders
       WHERE status = 'waiting'
         AND source = 'cafe24'
         AND paid_at IS NULL
         AND (
           lower(COALESCE(payment_method, '')) LIKE '%cash%'
           OR lower(COALESCE(payment_method, '')) LIKE '%bank%'
           OR lower(COALESCE(payment_method, '')) LIKE '%deposit%'
           OR payment_method LIKE '%무통%'
         )
       ORDER BY id ASC`
    )
    .all() as OrderRow[];

  // 취소·환불 주문은 대기열과 분리해 실제 카페24 주문만 최신 처리순으로 표시합니다.
  const cancelledOrders = db
    .prepare(
      `SELECT * FROM orders
       WHERE source = 'cafe24' AND status = 'cancelled'
       ORDER BY cancelled_at DESC, id DESC
       LIMIT 50`
    )
    .all() as OrderRow[];

  const hitCards = db
    .prepare("SELECT * FROM hit_cards ORDER BY id DESC LIMIT 20")
    .all() as HitCardRow[];

  return {
    opening: opening ?? null,
    // 완료 이력은 오버레이의 현재 주문으로 노출하지 않습니다.
    completed: null,
    waiting,
    pendingPayments,
    cancelledOrders,
    hitCards,
    overlaySettings: getOverlaySettings(),
  };
}

/** 관리자 홈의 당일 최종 오픈 이력입니다. 한국 시간 자정을 경계로 완료된 주문만 반환합니다. */
export function getTodayCompletedOrders(): OrderRow[] {
  return db
    .prepare(
      `SELECT * FROM orders
       WHERE status = 'done'
         AND completed_at IS NOT NULL
         AND completed_at >= datetime('now', '+9 hours', 'start of day', '-9 hours')
         AND completed_at < datetime('now', '+9 hours', 'start of day', '+15 hours')
       ORDER BY completed_at DESC, id DESC`
    )
    .all() as OrderRow[];
}

/** 관리자에서 직접 입력한 주문을 최신 입력순으로 반환합니다. */
export function getManualOrderHistory(limit = 50): OrderRow[] {
  return db
    .prepare(
      `SELECT * FROM orders
       WHERE source = 'manual'
       ORDER BY id DESC
       LIMIT ?`
    )
    .all(limit) as OrderRow[];
}

/**
 * 주문 이력 화면용: 상태와 무관하게 누적 주문을 최신순으로 반환합니다.
 * 연/월을 전달하면 한국 시간(UTC+9) 기준 해당 월만 반환합니다.
 */
export function getOrderHistory(filters?: { year?: number; month?: number }): OrderRow[] {
  const year = filters?.year;
  const month = filters?.month;

  if (year && month) {
    const start = `${year}-${String(month).padStart(2, "0")}-01 00:00:00`;
    const nextMonth = new Date(Date.UTC(year, month, 1));
    const end = `${nextMonth.getUTCFullYear()}-${String(nextMonth.getUTCMonth() + 1).padStart(2, "0")}-01 00:00:00`;

    return db
      .prepare(
        `SELECT * FROM orders
         WHERE created_at >= datetime(?, '-9 hours')
           AND created_at < datetime(?, '-9 hours')
         ORDER BY id DESC`
      )
      .all(start, end) as OrderRow[];
  }

  return db
    .prepare(
      `SELECT * FROM orders
       ORDER BY id DESC`
    )
    .all() as OrderRow[];
}

/** 주문 이력 필터에 표시할 연도 목록입니다. */
export function getOrderHistoryYears(): number[] {
  const rows = db
    .prepare(
      `SELECT DISTINCT strftime('%Y', datetime(created_at, '+9 hours')) AS year
       FROM orders
       ORDER BY year DESC`
    )
    .all() as { year: string }[];

  const years = rows
    .map((row) => Number(row.year))
    .filter((year) => Number.isInteger(year) && year >= 2000 && year <= 9999);
  const currentYear = new Date().getFullYear();
  return Array.from(new Set([currentYear, ...years])).sort((a, b) => b - a);
}

/** 카페24 원격 주문을 주문 이력 화면에서만 제외하기 위한 목록입니다. */
export function getHiddenOrderHistoryIds(): Set<string> {
  const rows = db.prepare("SELECT external_order_id FROM hidden_order_history").all() as Array<{ external_order_id: string }>;
  return new Set(rows.map((row) => row.external_order_id));
}

/**
 * 히트카드 등록 이력 화면용: 최근 등록순으로 반환합니다.
 */
export function getHitCardHistory(limit = 30): HitCardRow[] {
  return db
    .prepare("SELECT * FROM hit_cards ORDER BY id DESC LIMIT ?")
    .all(limit) as HitCardRow[];
}

export function insertOrder(input: {
  source: "cafe24" | "manual";
  externalOrderId?: string | null;
  userId: string;
  memberId?: string | null;
  product: string;
  productImageUrl?: string | null;
  quantity: number;
  unitPrice?: number;
  actualAmount?: number | null;
  tier?: string;
  youtubeNickname?: string | null;
  paymentMethod?: string | null;
  paymentGatewayName?: string | null;
  easypayName?: string | null;
  paid?: boolean;
  paymentDate?: string | null;
}) {
  const stmt = db.prepare(`
    INSERT INTO orders (
      source, external_order_id, user_id, member_id, product, product_image_url, quantity, unit_price, tier,
      actual_amount, youtube_nickname, payment_method, payment_gateway_name, easypay_name, paid_at, status
    ) VALUES (
      @source, @externalOrderId, @userId, @memberId, @product, @productImageUrl, @quantity, @unitPrice, @tier,
      @actualAmount, @youtubeNickname, @paymentMethod, @paymentGatewayName, @easypayName, @paidAt, 'waiting'
    )
  `);

  try {
    stmt.run({
      source: input.source,
      externalOrderId: input.externalOrderId ?? null,
      userId: input.userId,
      memberId: input.memberId?.trim() || null,
      product: input.product,
      productImageUrl: input.productImageUrl?.trim() || null,
      quantity: input.quantity,
      unitPrice: input.unitPrice ?? 15000,
      tier: input.tier ?? "",
      actualAmount: input.actualAmount ?? null,
      youtubeNickname: input.youtubeNickname ?? null,
      paymentMethod: input.paymentMethod ?? null,
      paymentGatewayName: input.paymentGatewayName ?? null,
      easypayName: input.easypayName ?? null,
      paidAt: input.paid ? toSqliteUtc(input.paymentDate) : null,
    });
  } catch (err) {
    // external_order_id UNIQUE 충돌 = 카페24가 같은 웹훅을 재전송한 경우 → 조용히 무시
    const message = err instanceof Error ? err.message : String(err);
    if (!message.includes("UNIQUE")) throw err;
    return;
  }

  broadcastUpdate();
}

/** Cafe24 품목 추가 이벤트에서 기존 주문 요약을 원본 주문 기준으로 갱신합니다. */
export function updateCafe24Order(input: {
  externalOrderId: string;
  userId: string;
  memberId?: string | null;
  product: string;
  productImageUrl?: string | null;
  quantity: number;
  unitPrice: number;
  actualAmount?: number | null;
  youtubeNickname?: string | null;
  paymentMethod?: string | null;
  paymentGatewayName?: string | null;
  easypayName?: string | null;
}): boolean {
  const result = db.prepare(
    `UPDATE orders SET
       user_id = ?, member_id = COALESCE(?, member_id), product = ?, product_image_url = COALESCE(?, product_image_url), quantity = ?, unit_price = ?,
       actual_amount = COALESCE(?, actual_amount),
       youtube_nickname = COALESCE(?, youtube_nickname),
       payment_method = COALESCE(?, payment_method),
       payment_gateway_name = COALESCE(?, payment_gateway_name),
       easypay_name = COALESCE(?, easypay_name)
     WHERE source = 'cafe24' AND external_order_id = ?`
  ).run(
    input.userId,
    input.memberId?.trim() || null,
    input.product,
    input.productImageUrl?.trim() || null,
    input.quantity,
    input.unitPrice,
    input.actualAmount ?? null,
    input.youtubeNickname ?? null,
    input.paymentMethod ?? null,
    input.paymentGatewayName ?? null,
    input.easypayName ?? null,
    input.externalOrderId
  );
  if (result.changes > 0) broadcastUpdate();
  return result.changes > 0;
}

export function setOpening(id: number, timerSeconds = 60) {
  const tx = db.transaction(() => {
    db.prepare(
      "UPDATE orders SET status = 'done', completed_at = COALESCE(completed_at, datetime('now')) WHERE status = 'opening'"
    ).run();
    db.prepare(
      "UPDATE orders SET status = 'opening', started_at = datetime('now'), timer_seconds = ? WHERE id = ?"
    ).run(timerSeconds, id);
  });
  tx();
  broadcastUpdate();
}

/** 카페24 주문의 실제 회원 ID와 구매자명을 주문 원장에 영구 저장합니다. */
export function saveCafe24OrderIdentity(
  externalOrderId: string,
  identity: { memberId?: string | null; buyerName?: string | null }
) {
  const memberId = identity.memberId?.trim() || null;
  const buyerName = identity.buyerName?.trim() || null;
  if (!memberId && !buyerName) return false;
  const result = db.prepare(
    `UPDATE orders
        SET member_id = COALESCE(?, member_id),
            user_id = COALESCE(?, user_id)
      WHERE external_order_id = ? AND source = 'cafe24'`
  ).run(memberId, buyerName, externalOrderId);
  if (result.changes) broadcastUpdate();
  return result.changes > 0;
}

export function completeOpening(id: number) {
  db.prepare("UPDATE orders SET status = 'done', completed_at = datetime('now') WHERE id = ?").run(id);
  broadcastUpdate();
}

export function deleteOrder(id: number): boolean {
  const order = db.prepare(
    "SELECT external_order_id FROM orders WHERE id = ?"
  ).get(id) as { external_order_id: string | null } | undefined;
  if (!order) return false;

  const tx = db.transaction(() => {
    // 카페24 주문은 원격 동기화 때 다시 표시될 수 있으므로 화면 숨김 상태를 보존합니다.
    if (order.external_order_id) {
      db.prepare(
        `INSERT INTO hidden_order_history (external_order_id, hidden_at) VALUES (?, datetime('now'))
         ON CONFLICT(external_order_id) DO UPDATE SET hidden_at = excluded.hidden_at`
      ).run(order.external_order_id);
    }
    db.prepare("DELETE FROM orders WHERE id = ?").run(id);
  });
  tx();
  broadcastUpdate();
  return true;
}

/** 카페24 원격 주문처럼 로컬 행이 없는 주문도 주문 이력 화면에서만 숨깁니다. */
export function hideOrderHistory(externalOrderId: string): boolean {
  const orderId = externalOrderId.trim();
  if (!orderId) return false;

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO hidden_order_history (external_order_id, hidden_at) VALUES (?, datetime('now'))
       ON CONFLICT(external_order_id) DO UPDATE SET hidden_at = excluded.hidden_at`
    ).run(orderId);
    db.prepare("DELETE FROM orders WHERE external_order_id = ?").run(orderId);
  });
  tx();
  broadcastUpdate();
  return true;
}

export function addHitCard(userId: string, card: string, youtubeNickname?: string | null) {
  db.prepare("INSERT INTO hit_cards (user_id, card, youtube_nickname) VALUES (?, ?, ?)").run(
    userId,
    card,
    youtubeNickname ?? null
  );
  broadcastUpdate();
}

export function deleteHitCard(id: number) {
  db.prepare("DELETE FROM hit_cards WHERE id = ?").run(id);
  broadcastUpdate();
}

/**
 * 주문 이력 + 히트카드 등록 이력을 전부 지웁니다. 되돌릴 수 없습니다.
 */
export function resetAllHistory() {
  db.exec("DELETE FROM orders");
  db.exec("DELETE FROM hit_cards");
  broadcastUpdate();
}

/**
 * 카페24 취소/환불 웹훅이 들어왔을 때 호출합니다.
 * 큐에 해당 external_order_id를 가진 주문이 없으면(이미 처리됐거나 매칭 실패) false를 반환합니다.
 */
export function cancelOrder(
  externalOrderId: string,
  reason: "cancelled" | "refunded"
): boolean {
  const order = db
    .prepare("SELECT * FROM orders WHERE external_order_id = ?")
    .get(externalOrderId) as OrderRow | undefined;

  if (!order || order.status === "cancelled") return false;

  db.prepare(
    `UPDATE orders
     SET status = 'cancelled', prev_status = ?, cancel_reason = ?, cancelled_at = datetime('now')
     WHERE id = ?`
  ).run(order.status, reason, order.id);

  broadcastUpdate();
  return true;
}

/**
 * 카페24 입금완료(입금상태 변경) 웹훅이 들어왔을 때 호출합니다.
 * 이미 입금완료 처리됐거나 큐에 없는 주문이면 false를 반환합니다.
 */
export function markOrderPaid(
  externalOrderId: string,
  payment?: {
    paymentMethod?: string | null;
    paymentGatewayName?: string | null;
    easypayName?: string | null;
    paymentDate?: string | null;
  }
): boolean {
  const order = db
    .prepare("SELECT * FROM orders WHERE external_order_id = ?")
    .get(externalOrderId) as OrderRow | undefined;
  if (!order) return false;
  db.prepare(
    `UPDATE orders
     SET paid_at = COALESCE(paid_at, ?),
         payment_method = COALESCE(?, payment_method),
         payment_gateway_name = COALESCE(?, payment_gateway_name),
         easypay_name = COALESCE(?, easypay_name)
     WHERE id = ?`
  ).run(
    toSqliteUtc(payment?.paymentDate),
    payment?.paymentMethod ?? null,
    payment?.paymentGatewayName ?? null,
    payment?.easypayName ?? null,
    order.id
  );
  broadcastUpdate();
  return true;
}

/** 관리자 수동 입금확인 전에 로컬 주문을 안전하게 대조합니다. */
export function getOrderById(id: number): OrderRow | null {
  const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(id) as OrderRow | undefined;
  return order ?? null;
}

function toSqliteUtc(value?: string | null): string {
  if (value) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 19).replace("T", " ");
  }
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

declare global {
  var __cardbreakCleanupTimer: ReturnType<typeof setInterval> | undefined;
  // 이전 버전의 3개월 보관 정리 타이머를 해제하기 위한 레거시 핸들입니다.
  var __orderRetentionCleanupTimer: ReturnType<typeof setInterval> | undefined;
}

// 이전 개발 서버 HMR 세션에서 8초 후 취소 주문을 실제 삭제하던 타이머가 남아 있으면 제거합니다.
if (global.__cardbreakCleanupTimer) {
  clearInterval(global.__cardbreakCleanupTimer);
  global.__cardbreakCleanupTimer = undefined;
}

// 이전 서버 코드가 만든 3개월 보관 타이머가 남아 있다면 즉시 해제합니다.
if (global.__orderRetentionCleanupTimer) {
  clearInterval(global.__orderRetentionCleanupTimer);
  global.__orderRetentionCleanupTimer = undefined;
}
