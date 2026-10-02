import {
  getCafe24OrderForReward,
  isCafe24OrderPaid,
  listCafe24Orders,
  type Cafe24RewardOrder,
} from "./cafe24Admin";
import { extractCafe24YoutubeNickname } from "./cafe24";
import { db } from "./db";
import { broadcastUpdate } from "./events";

type ReconciliationInput = {
  startDate: string;
  endDate: string;
};

export type Cafe24ReconciliationResult = {
  rangeStart: string;
  rangeEnd: string;
  checkedCount: number;
  insertedCount: number;
  updatedCount: number;
  cancelledCount: number;
  skippedHiddenCount: number;
  skippedConflictCount: number;
  failedCount: number;
};

type ReconciliationOrder = {
  externalOrderId: string;
  userId: string;
  memberId: string | null;
  product: string;
  quantity: number;
  unitPrice: number;
  actualAmount: number;
  youtubeNickname: string | null;
  paymentMethod: string | null;
  paidAt: string | null;
  createdAt: string;
  cancelledAt: string | null;
  cancelled: boolean;
  paid: boolean;
};

function sqliteUtc(value: string | null | undefined, fallback: string | null = null) {
  const time = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(time)
    ? new Date(time).toISOString().slice(0, 19).replace("T", " ")
    : fallback;
}

function paymentMethod(order: Cafe24RewardOrder) {
  return Array.isArray(order.payment_method)
    ? order.payment_method.filter(Boolean).join(",") || null
    : order.payment_method?.trim() || null;
}

function actualAmount(order: Cafe24RewardOrder) {
  if (order.canceled === "T") return 0;
  const value = isCafe24OrderPaid(order)
    ? order.payment_amount
    : order.actual_order_amount?.total_amount_due
      ?? order.actual_order_amount?.order_price_amount
      ?? order.initial_order_amount?.payment_amount;
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? Math.round(amount) : 0;
}

function orderFromCafe24(order: Cafe24RewardOrder): ReconciliationOrder | null {
  const externalOrderId = order.order_id?.trim();
  if (!externalOrderId) return null;

  const items = order.items ?? [];
  const product = items.map((item) => item.product_name?.trim()).filter((name): name is string => Boolean(name)).join(" · ")
    || "카페24 주문";
  const quantity = items.reduce((total, item) => {
    const value = Number(item.quantity ?? 0);
    return total + (Number.isFinite(value) && value > 0 ? value : 0);
  }, 0) || 1;
  const amount = actualAmount(order);
  const itemAmount = items.reduce((total, item) => {
    const value = Number(item.payment_amount ?? 0);
    return total + (Number.isFinite(value) && value > 0 ? value : 0);
  }, 0);
  const unitPrice = itemAmount > 0
    ? Math.round(itemAmount / quantity)
    : amount > 0
      ? Math.round(amount / quantity)
      : 0;
  const paid = isCafe24OrderPaid(order) && order.canceled !== "T";

  return {
    externalOrderId,
    userId: order.billing_name?.trim() || "구매자 확인 불가",
    memberId: order.member_id?.trim() || null,
    product,
    quantity,
    unitPrice,
    actualAmount: amount,
    youtubeNickname: extractCafe24YoutubeNickname(order.additional_order_info_list),
    paymentMethod: paymentMethod(order),
    paidAt: paid ? sqliteUtc(order.payment_date) : null,
    createdAt: sqliteUtc(order.order_date, new Date().toISOString().slice(0, 19).replace("T", " "))!,
    cancelledAt: order.canceled === "T" ? sqliteUtc(order.cancel_date) : null,
    cancelled: order.canceled === "T",
    paid,
  };
}

async function mapConcurrent<T, R>(items: T[], limit: number, mapper: (item: T) => Promise<R>) {
  const results: R[] = [];
  for (let index = 0; index < items.length; index += limit) {
    results.push(...await Promise.all(items.slice(index, index + limit).map(mapper)));
  }
  return results;
}

/**
 * 카페24를 원본으로 최근 주문을 보정합니다. 적립금 원장은 변경하지 않고,
 * 운영자가 숨긴 주문은 계속 숨긴 채로 둡니다.
 */
export async function reconcileCafe24Orders(input: ReconciliationInput): Promise<Cafe24ReconciliationResult> {
  const run = db.prepare(
    "INSERT INTO cafe24_reconciliation_runs (range_start, range_end) VALUES (?, ?)"
  ).run(input.startDate, input.endDate);
  const runId = Number(run.lastInsertRowid);
  const result: Cafe24ReconciliationResult = {
    rangeStart: input.startDate,
    rangeEnd: input.endDate,
    checkedCount: 0,
    insertedCount: 0,
    updatedCount: 0,
    cancelledCount: 0,
    skippedHiddenCount: 0,
    skippedConflictCount: 0,
    failedCount: 0,
  };

  try {
    const listed = await listCafe24Orders(input.startDate, input.endDate);
    const unique = Array.from(new Map(listed.flatMap((order) => order.order_id
      ? [[order.order_id, order] as const] : [])).values());
    const details = await mapConcurrent(unique, 5, async (order) => {
      try {
        return await getCafe24OrderForReward(order.order_id!);
      } catch {
        // 일부 취소·오래된 주문은 상세 조회가 제한될 수 있습니다. 목록 원본으로도
        // 금액·결제·상태 보정은 가능하므로 해당 주문을 누락시키지 않습니다.
        return order;
      }
    });
    const orders = details.flatMap((order) => {
      if (!order) return [];
      const normalized = orderFromCafe24(order);
      if (!normalized) {
        result.failedCount += 1;
        return [];
      }
      return [normalized];
    });
    result.checkedCount = orders.length;

    const hidden = new Set((db.prepare("SELECT external_order_id FROM hidden_order_history").all() as Array<{ external_order_id: string }>)
      .map((row) => row.external_order_id));
    const existing = new Map((db.prepare(
      "SELECT external_order_id, source FROM orders WHERE external_order_id IS NOT NULL"
    ).all() as Array<{ external_order_id: string; source: string }>).map((row) => [row.external_order_id, row.source]));

    const update = db.prepare(`
      UPDATE orders SET
        user_id = @userId,
        member_id = COALESCE(@memberId, member_id),
        product = @product,
        quantity = @quantity,
        unit_price = @unitPrice,
        actual_amount = @actualAmount,
        youtube_nickname = COALESCE(@youtubeNickname, youtube_nickname),
        payment_method = COALESCE(@paymentMethod, payment_method),
        paid_at = @paidAt,
        created_at = @createdAt,
        status = CASE
          WHEN @cancelled = 1 THEN 'cancelled'
          WHEN @paid = 0 AND status IN ('opening', 'done') THEN 'waiting'
          ELSE status
        END,
        prev_status = CASE WHEN @cancelled = 1 AND status <> 'cancelled' THEN status ELSE prev_status END,
        cancel_reason = CASE WHEN @cancelled = 1 THEN 'cancelled' ELSE cancel_reason END,
        cancelled_at = CASE WHEN @cancelled = 1 THEN @cancelledAt ELSE cancelled_at END
      WHERE source = 'cafe24' AND external_order_id = @externalOrderId
    `);
    const insert = db.prepare(`
      INSERT INTO orders (
        source, external_order_id, user_id, member_id, product, quantity, unit_price, actual_amount,
        youtube_nickname, payment_method, paid_at, status, cancel_reason, cancelled_at, created_at
      ) VALUES (
        'cafe24', @externalOrderId, @userId, @memberId, @product, @quantity, @unitPrice, @actualAmount,
        @youtubeNickname, @paymentMethod, @paidAt, @status, @cancelReason, @cancelledAt, @createdAt
      )
    `);

    db.transaction(() => {
      for (const order of orders) {
        if (hidden.has(order.externalOrderId)) {
          result.skippedHiddenCount += 1;
          continue;
        }
        const source = existing.get(order.externalOrderId);
        if (source && source !== "cafe24") {
          result.skippedConflictCount += 1;
          continue;
        }
        if (source === "cafe24") {
          update.run({ ...order, cancelled: Number(order.cancelled), paid: Number(order.paid) });
          result.updatedCount += 1;
          if (order.cancelled) result.cancelledCount += 1;
          continue;
        }
        insert.run({
          ...order,
          status: order.cancelled ? "cancelled" : order.paid ? "done" : "waiting",
          cancelReason: order.cancelled ? "cancelled" : null,
        });
        result.insertedCount += 1;
        if (order.cancelled) result.cancelledCount += 1;
      }
    })();

    db.prepare(`
      UPDATE cafe24_reconciliation_runs SET
        completed_at = datetime('now'), checked_count = ?, inserted_count = ?, updated_count = ?,
        cancelled_count = ?, skipped_hidden_count = ?, skipped_conflict_count = ?, failed_count = ?, status = ?
      WHERE id = ?
    `).run(
      result.checkedCount, result.insertedCount, result.updatedCount, result.cancelledCount,
      result.skippedHiddenCount, result.skippedConflictCount, result.failedCount,
      result.failedCount ? "partial" : "succeeded", runId
    );
    if (result.insertedCount || result.updatedCount) broadcastUpdate();
    return result;
  } catch (error) {
    db.prepare("UPDATE cafe24_reconciliation_runs SET completed_at = datetime('now'), status = 'failed' WHERE id = ?")
      .run(runId);
    throw error;
  }
}
