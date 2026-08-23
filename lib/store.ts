import { db } from "./db";
import { broadcastUpdate } from "./events";

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
};

// 취소/환불된 주문을 화면에 보여주는 시간(초). 이 시간이 지나면 자동으로 목록에서 삭제됩니다.
const CANCEL_DISPLAY_SECONDS = 8;

export function getLiveState(): LiveState {
  const opening = db
    .prepare(
      `SELECT * FROM orders
       WHERE status = 'opening' OR (status = 'cancelled' AND prev_status = 'opening')
       ORDER BY started_at DESC LIMIT 1`
    )
    .get() as OrderRow | undefined;

  const waiting = db
    .prepare(
      `SELECT * FROM orders
       WHERE status = 'waiting' OR (status = 'cancelled' AND prev_status = 'waiting')
       ORDER BY id ASC`
    )
    .all() as OrderRow[];

  const hitCards = db
    .prepare("SELECT * FROM hit_cards ORDER BY id DESC LIMIT 20")
    .all() as HitCardRow[];

  return { opening: opening ?? null, waiting, hitCards };
}

/**
 * 카페24 주문 이력 화면용: 상태와 무관하게 최근 주문을 순서대로 보여줍니다.
 * (취소/환불된 주문은 8초 뒤 DB에서 실제로 삭제되므로, 그 이후에는 이력에서도 사라집니다.)
 */
export function getOrderHistory(limit = 30): OrderRow[] {
  return db
    .prepare("SELECT * FROM orders ORDER BY id DESC LIMIT ?")
    .all(limit) as OrderRow[];
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
}) {
  const stmt = db.prepare(`
    INSERT INTO orders (source, external_order_id, user_id, product, quantity, unit_price, tier, youtube_nickname, payment_method, status)
    VALUES (@source, @externalOrderId, @userId, @product, @quantity, @unitPrice, @tier, @youtubeNickname, @paymentMethod, 'waiting')
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
  return true;
}

/**
 * 카페24 입금완료(입금상태 변경) 웹훅이 들어왔을 때 호출합니다.
 * 이미 입금완료 처리됐거나 큐에 없는 주문이면 false를 반환합니다.
 */
export function markOrderPaid(externalOrderId: string): boolean {
  const order = db
    .prepare("SELECT * FROM orders WHERE external_order_id = ?")
    .get(externalOrderId) as OrderRow | undefined;
  if (!order) return false;
  if (order.paid_at) return false;
  db.prepare("UPDATE orders SET paid_at = datetime('now') WHERE id = ?").run(order.id);
  broadcastUpdate();
  return true;
}

function cleanupExpiredCancellations() {
  const result = db
    .prepare(
      `DELETE FROM orders
       WHERE status = 'cancelled'
         AND cancelled_at IS NOT NULL
         AND datetime(cancelled_at, '+${CANCEL_DISPLAY_SECONDS} seconds') <= datetime('now')`
    )
    .run();

  if (result.changes > 0) broadcastUpdate();
}

declare global {
  // eslint-disable-next-line no-var
  var __cardbreakCleanupTimer: ReturnType<typeof setInterval> | undefined;
}

// 3초마다 만료된 취소/환불 주문을 정리합니다. (Next.js dev HMR로 중복 등록되지 않도록 global에 캐싱)
if (!global.__cardbreakCleanupTimer) {
  global.__cardbreakCleanupTimer = setInterval(cleanupExpiredCancellations, 3000);
}
