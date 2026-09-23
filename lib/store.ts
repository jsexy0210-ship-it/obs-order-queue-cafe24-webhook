import { db } from "./db";
import { broadcastUpdate } from "./events";
import { DEFAULT_OVERLAY_SETTINGS, type OverlaySettings } from "./overlaySettings";

export type OrderStatus = "waiting" | "opening" | "done" | "cancelled";

export type OrderRow = {
  id: number;
  source: string;
  external_order_id: string | null;
  user_id: string;
  product: string;
  quantity: number;
  unit_price: number;
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
  waiting: OrderRow[];
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
    return {
      ...DEFAULT_OVERLAY_SETTINGS,
      ...saved,
      scales: { ...DEFAULT_OVERLAY_SETTINGS.scales, ...saved.scales },
      widths: { ...DEFAULT_OVERLAY_SETTINGS.widths, ...saved.widths },
      position: { ...DEFAULT_OVERLAY_SETTINGS.position, ...saved.position },
      colors: { ...DEFAULT_OVERLAY_SETTINGS.colors, ...saved.colors },
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

// 취소/환불된 주문은 라이브 화면에서만 잠깐 보여주고, 주문 이력 DB에는 3개월 보관합니다.
const CANCEL_DISPLAY_SECONDS = 8;
const ORDER_HISTORY_RETENTION_MODIFIER = "-3 months";
const ORDER_HISTORY_CLEANUP_MS = 60 * 60 * 1000;

export function getLiveState(): LiveState {
  const opening = db
    .prepare(
      `SELECT * FROM orders
       WHERE status = 'opening'
          OR (
            status = 'cancelled'
            AND prev_status = 'opening'
            AND cancelled_at IS NOT NULL
            AND datetime(cancelled_at, ?) > datetime('now')
          )
       ORDER BY started_at DESC LIMIT 1`
    )
    .get(`+${CANCEL_DISPLAY_SECONDS} seconds`) as OrderRow | undefined;

  const waiting = db
    .prepare(
      `SELECT * FROM orders
       WHERE status = 'waiting'
          OR (
            status = 'cancelled'
            AND prev_status = 'waiting'
            AND cancelled_at IS NOT NULL
            AND datetime(cancelled_at, ?) > datetime('now')
          )
       ORDER BY id ASC`
    )
    .all(`+${CANCEL_DISPLAY_SECONDS} seconds`) as OrderRow[];

  const hitCards = db
    .prepare("SELECT * FROM hit_cards ORDER BY id DESC LIMIT 20")
    .all() as HitCardRow[];

  return { opening: opening ?? null, waiting, hitCards, overlaySettings: getOverlaySettings() };
}

/**
 * 주문 이력 화면용: 상태와 무관하게 최근 3개월 주문을 최신순으로 반환합니다.
 * 취소/환불 주문도 동일하게 3개월 보관됩니다.
 */
export function getOrderHistory(): OrderRow[] {
  return db
    .prepare(
      `SELECT * FROM orders
       WHERE created_at >= datetime('now', ?)
       ORDER BY id DESC`
    )
    .all(ORDER_HISTORY_RETENTION_MODIFIER) as OrderRow[];
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
  product: string;
  quantity: number;
  unitPrice?: number;
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
      source, external_order_id, user_id, product, quantity, unit_price, tier,
      youtube_nickname, payment_method, payment_gateway_name, easypay_name, paid_at, status
    ) VALUES (
      @source, @externalOrderId, @userId, @product, @quantity, @unitPrice, @tier,
      @youtubeNickname, @paymentMethod, @paymentGatewayName, @easypayName, @paidAt, 'waiting'
    )
  `);

  try {
    stmt.run({
      source: input.source,
      externalOrderId: input.externalOrderId ?? null,
      userId: input.userId,
      product: input.product,
      quantity: input.quantity,
      unitPrice: input.unitPrice ?? 15000,
      tier: input.tier ?? "",
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

export function setOpening(id: number, timerSeconds = 60) {
  const tx = db.transaction(() => {
    db.prepare("UPDATE orders SET status = 'done' WHERE status = 'opening'").run();
    db.prepare(
      "UPDATE orders SET status = 'opening', started_at = datetime('now'), timer_seconds = ? WHERE id = ?"
    ).run(timerSeconds, id);
  });
  tx();
  broadcastUpdate();
}

export function completeOpening(id: number) {
  db.prepare("UPDATE orders SET status = 'done', completed_at = datetime('now') WHERE id = ?").run(id);
  broadcastUpdate();
}

export function deleteOrder(id: number) {
  db.prepare("DELETE FROM orders WHERE id = ?").run(id);
  broadcastUpdate();
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

  if (!order) return false;
  if (order.status === "cancelled" || order.status === "done") return false;

  db.prepare(
    `UPDATE orders
     SET status = 'cancelled', prev_status = ?, cancel_reason = ?, cancelled_at = datetime('now')
     WHERE id = ?`
  ).run(order.status, reason, order.id);

  broadcastUpdate();

  // 취소/환불 배지는 라이브 화면에서 8초만 유지합니다.
  // DB 행은 삭제하지 않고 주문 이력으로 3개월 보관합니다.
  setTimeout(() => broadcastUpdate(), CANCEL_DISPLAY_SECONDS * 1000 + 100);
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

function toSqliteUtc(value?: string | null): string {
  if (value) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 19).replace("T", " ");
  }
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

function cleanupExpiredOrderHistory() {
  const result = db
    .prepare("DELETE FROM orders WHERE created_at < datetime('now', ?)")
    .run(ORDER_HISTORY_RETENTION_MODIFIER);

  if (result.changes > 0) broadcastUpdate();
}

declare global {
  // eslint-disable-next-line no-var
  var __cardbreakCleanupTimer: ReturnType<typeof setInterval> | undefined;
  // eslint-disable-next-line no-var
  var __orderRetentionCleanupTimer: ReturnType<typeof setInterval> | undefined;
}

// 이전 개발 서버 HMR 세션에서 8초 후 취소 주문을 실제 삭제하던 타이머가 남아 있으면 제거합니다.
if (global.__cardbreakCleanupTimer) {
  clearInterval(global.__cardbreakCleanupTimer);
  global.__cardbreakCleanupTimer = undefined;
}

// 서버 시작 시 한 번, 이후 1시간마다 3개월이 지난 주문 이력을 정리합니다.
cleanupExpiredOrderHistory();
if (!global.__orderRetentionCleanupTimer) {
  global.__orderRetentionCleanupTimer = setInterval(
    cleanupExpiredOrderHistory,
    ORDER_HISTORY_CLEANUP_MS
  );
}
