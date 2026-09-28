import { db } from "./db";
import { changeCafe24Points, getCafe24CustomerGroups, getCafe24OrderForReward, type Cafe24RewardOrder } from "./cafe24Admin";
import { canExecuteCafe24RewardChanges } from "./rewardExecution";
import { isAfterRewardStart } from "./rewardCutoff";
import { getRewardSettings } from "./rewardStore";

type LedgerAction = "issue" | "recover";
type LedgerStatus = "pending" | "succeeded" | "failed";
type RewardLedger = {
  id: number;
  external_order_id: string;
  member_id: string;
  grade_id: string;
  action: LedgerAction;
  amount: number;
  card_rate: number;
  bank_rate: number;
  applied_rate: number;
  processing_mode: "automatic" | "manual";
  status: LedgerStatus;
};

export type RewardLedgerRow = Pick<
  RewardLedger,
  "id" | "external_order_id" | "grade_id" | "action" | "amount" | "processing_mode" | "status"
> & { created_at: string; processed_at: string | null; error_message: string | null };

export function listRewardLedger(limit = 30): RewardLedgerRow[] {
  return db.prepare(
    `SELECT id, external_order_id, grade_id, action, amount, processing_mode, status, created_at, processed_at, error_message
     FROM reward_ledger ORDER BY id DESC LIMIT ?`
  ).all(limit) as RewardLedgerRow[];
}

export function getDashboardRewardEntries(sinceUtc: string): Array<Pick<RewardLedgerRow, "amount" | "grade_id" | "processed_at">> {
  return db.prepare(
    `SELECT amount, grade_id, processed_at FROM reward_ledger
     WHERE action = 'issue' AND status = 'succeeded' AND processed_at >= ?`
  ).all(sinceUtc) as Array<Pick<RewardLedgerRow, "amount" | "grade_id" | "processed_at">>;
}

export type RewardOrderSummary = {
  issue?: Pick<RewardLedgerRow, "amount" | "status" | "grade_id">;
  recover?: Pick<RewardLedgerRow, "amount" | "status" | "grade_id">;
};

/** 주문이력 화면용으로 지급/회수 상태를 주문번호별로 묶습니다. */
export function getRewardSummaries(orderIds: string[]): Record<string, RewardOrderSummary> {
  if (orderIds.length === 0) return {};
  const placeholders = orderIds.map(() => "?").join(", ");
  const rows = db.prepare(
    `SELECT external_order_id, grade_id, action, amount, status
     FROM reward_ledger WHERE external_order_id IN (${placeholders}) ORDER BY id ASC`
  ).all(...orderIds) as Array<{
    external_order_id: string;
    grade_id: string;
    action: LedgerAction;
    amount: number;
    status: LedgerStatus;
  }>;
  return rows.reduce<Record<string, RewardOrderSummary>>((result, row) => {
    const summary = result[row.external_order_id] ?? {};
    summary[row.action] = { amount: row.amount, status: row.status, grade_id: row.grade_id };
    result[row.external_order_id] = summary;
    return result;
  }, {});
}

function getLedger(orderId: string, action: LedgerAction) {
  return db.prepare("SELECT * FROM reward_ledger WHERE external_order_id = ? AND action = ?")
    .get(orderId, action) as RewardLedger | undefined;
}

function markLedger(id: number, status: LedgerStatus, error?: unknown) {
  db.prepare(
    `UPDATE reward_ledger
     SET status = ?, error_message = ?, processed_at = CASE WHEN ? = 'succeeded' THEN datetime('now') ELSE NULL END
     WHERE id = ?`
  ).run(status, error instanceof Error ? error.message.slice(0, 500) : error ? String(error).slice(0, 500) : null, status, id);
}

function netProductAmount(order: Cafe24RewardOrder) {
  const items = Array.isArray(order.items) ? order.items : [];
  if (items.length === 0) return null;
  let total = 0;
  for (const item of items) {
    const amount = Number(item.payment_amount);
    const quantity = Number(item.quantity ?? 1);
    if (!Number.isFinite(amount) || amount < 0 || !Number.isFinite(quantity) || quantity <= 0) return null;
    total += amount * quantity;
  }
  return Math.floor(total);
}

function isFullyCancelled(order: Cafe24RewardOrder) {
  const items = Array.isArray(order.items) ? order.items : [];
  return items.length > 0 && items.every((item) =>
    ["C1", "C2", "C3", "CANCELLED", "RETURNED"].includes(String(item.status_code ?? item.order_status).toUpperCase())
  );
}

function isPaymentConfirmed(order: Cafe24RewardOrder) {
  const value = order.paid ?? order.payment_confirmation;
  return value === true || value === 1 || String(value).toUpperCase() === "T";
}

function findGrade(
  settings: ReturnType<typeof getRewardSettings>,
  groupNo: string | number | undefined
) {
  if (!settings.enabled || groupNo === undefined || groupNo === null) return null;
  return settings.grades.find((grade) => grade.enabled && grade.cafe24GroupNo === String(groupNo)) ?? null;
}

/**
 * 결제완료 또는 배송완료 웹훅에서 호출합니다.
 * 저장된 망고TCG 적립 시점과 일치하는 이벤트만 통과시켜, 두 시점이 함께 지급될 수 없게 합니다.
 */
export async function issueRewardForOrder(orderId: string, trigger: "paid" | "delivered") {
  if (!canExecuteCafe24RewardChanges()) return { outcome: "blocked" as const };
  const settings = getRewardSettings();
  if (!settings.enabled || settings.issueTrigger !== trigger) return { outcome: "skipped" as const };
  // 성공, 처리 중, 불확실한 실패를 포함해 기존 원장이 있으면 자동 재시도하지 않습니다.
  // 네트워크 오류 뒤 카페24가 이미 반영했을 가능성까지 막기 위한 이중 지급 방지 장치입니다.
  if (getLedger(orderId, "issue")) return { outcome: "duplicate" as const };

  const order = await getCafe24OrderForReward(orderId, { includeBuyerGroup: true });
  // 웹훅 URL의 event=paid만 신뢰하지 않고 카페24 주문 원본에서 결제를 다시 확인합니다.
  if (!isPaymentConfirmed(order) || isFullyCancelled(order)) return { outcome: "skipped" as const };
  if (!isAfterRewardStart(order)) return { outcome: "before_reward_start" as const };
  const memberId = order.member_id?.trim();
  const groupNo = order.member_group_no ?? order.group_no;
  const grade = findGrade(settings, groupNo);
  const baseAmount = netProductAmount(order);
  if (!memberId || !grade || baseAmount === null) return { outcome: "skipped" as const };

  // 카페24 자체 등급별 적립이 남아 있으면 망고TCG 지급과 중복될 수 있으므로 실패 안전으로 차단합니다.
  const groups = await getCafe24CustomerGroups();
  const cafe24Group = groups.find((group) => String(group.group_no) === String(groupNo));
  if (!cafe24Group || !["F", "D"].includes(cafe24Group.buy_benefits ?? "")) {
    return { outcome: "native_reward_active" as const };
  }
  if (process.env.CAFE24_NATIVE_REWARDS_DISABLED !== "true") {
    return { outcome: "native_reward_unverified" as const };
  }

  const paymentMethods = Array.isArray(order.payment_method)
    ? order.payment_method
    : [order.payment_method];
  const isBankDeposit = paymentMethods.some((method) => method?.toLowerCase() === "cash");
  const appliedRate = isBankDeposit ? grade.bankRate : grade.cardRate;
  const amount = Math.floor(baseAmount * appliedRate / 100);
  if (amount <= 0) return { outcome: "skipped" as const };

  // UNIQUE(external_order_id, action)를 INSERT OR IGNORE로 선점합니다.
  // 동시에 같은 웹훅이 들어와도 선점에 성공한 한 요청만 카페24 API를 호출합니다.
  const reservation = db.prepare(
    `INSERT OR IGNORE INTO reward_ledger (
      external_order_id, member_id, grade_id, action, amount, card_rate, bank_rate, applied_rate, processing_mode, status
    ) VALUES (?, ?, ?, 'issue', ?, ?, ?, ?, 'automatic', 'pending')`
  ).run(orderId, memberId, grade.id, amount, grade.cardRate, grade.bankRate, appliedRate);
  if (reservation.changes !== 1) return { outcome: "duplicate" as const };
  const ledgerId = Number(reservation.lastInsertRowid);

  try {
    await changeCafe24Points({
      memberId,
      orderId,
      amount,
      type: "increase",
      reason: `망고TCG ${grade.name} 구매 적립`,
    });
    markLedger(ledgerId, "succeeded");
    return { outcome: "issued" as const, amount };
  } catch (error) {
    markLedger(ledgerId, "failed", error);
    throw error;
  }
}

/** 전체 취소·환불만 자동 회수합니다. 부분 취소/환불은 과회수를 막기 위해 수동 회수 대상으로 남깁니다. */
export async function recoverRewardForOrder(orderId: string, mode: "automatic" | "manual") {
  if (!canExecuteCafe24RewardChanges()) return { outcome: "blocked" as const };
  const issue = getLedger(orderId, "issue");
  if (!issue || issue.status !== "succeeded") return { outcome: "skipped" as const };
  // 회수도 실패/처리 중 원장을 자동 재시도하지 않습니다. 외부 잔액이 이미 변경된
  // 불확실한 상태에서 재호출해 과회수하는 일을 막습니다.
  if (getLedger(orderId, "recover")) return { outcome: "duplicate" as const };

  if (mode === "automatic") {
    const grade = getRewardSettings().grades.find((item) => item.id === issue.grade_id);
    if (!grade || grade.recoveryMode !== "automatic") return { outcome: "manual_required" as const };
    const order = await getCafe24OrderForReward(orderId);
    if (!isFullyCancelled(order)) return { outcome: "manual_required" as const };
  }

  const reservation = db.prepare(
    `INSERT OR IGNORE INTO reward_ledger (
      external_order_id, member_id, grade_id, action, amount, card_rate, bank_rate, applied_rate, processing_mode, status
    ) VALUES (?, ?, ?, 'recover', ?, ?, ?, ?, ?, 'pending')`
  ).run(orderId, issue.member_id, issue.grade_id, issue.amount, issue.card_rate, issue.bank_rate, issue.applied_rate, mode);
  if (reservation.changes !== 1) return { outcome: "duplicate" as const };
  const ledgerId = Number(reservation.lastInsertRowid);

  try {
    await changeCafe24Points({
      memberId: issue.member_id,
      orderId,
      amount: issue.amount,
      type: "decrease",
      reason: "망고TCG 취소·환불 적립금 회수",
    });
    markLedger(ledgerId, "succeeded");
    return { outcome: "recovered" as const, amount: issue.amount };
  } catch (error) {
    markLedger(ledgerId, "failed", error);
    throw error;
  }
}
