import { db } from "./db";
import {
  changeCafe24Points,
  getCafe24CustomerGroup,
  getCafe24CustomerGroups,
  getCafe24CustomerPointBalance,
  getCafe24OrderForReward,
  type Cafe24RewardOrder,
} from "./cafe24Admin";
import { getCurrentCustomerGroupNo } from "./buyerNames";
import { canExecuteCafe24RewardChanges } from "./rewardExecution";
import { isAfterRewardStart } from "./rewardCutoff";
import { getRewardSettings } from "./rewardStore";
import { calculateRewardAmount, collapsePartialRecoveryRows, isExcludedRewardItem } from "./rewardCalculation";

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
  const rows = db.prepare(
    `SELECT id, external_order_id, grade_id, action, amount, processing_mode, status, created_at, processed_at, error_message
     FROM reward_ledger ORDER BY id DESC LIMIT ?`
  ).all(limit * 2) as RewardLedgerRow[];
  return collapsePartialRecoveryRows(rows, limit);
}

export type DashboardRewardEntry = Pick<
  RewardLedgerRow,
  "external_order_id" | "action" | "amount" | "grade_id" | "processed_at"
> & { payment_kind: "card" | "bank" | "unknown" };

export function getDashboardRewardEntries(sinceUtc: string): DashboardRewardEntry[] {
  return db.prepare(
    `SELECT l.external_order_id, l.action, l.amount, l.grade_id, l.processed_at,
       CASE
         -- 지급 당시 원장에 저장한 적용률로 결제수단을 판별한다. 주문 이력이 정리돼도
         -- 카드/무통장 적립금 분류가 사라지지 않도록 orders 테이블에 의존하지 않는다.
         WHEN l.applied_rate = l.bank_rate AND l.applied_rate <> l.card_rate THEN 'bank'
         WHEN l.applied_rate = l.card_rate THEN 'card'
         ELSE 'unknown'
       END AS payment_kind
       FROM reward_ledger l
      WHERE l.status = 'succeeded' AND l.processed_at >= ?`
  ).all(sinceUtc) as DashboardRewardEntry[];
}

export function getDashboardCumulativeRewardBalance() {
  const snapshot = db.prepare(
    `SELECT COUNT(*) AS member_count, COALESCE(SUM(balance), 0) AS amount
       FROM cafe24_member_point_balance_snapshots`
  ).get() as { member_count: number; amount: number };
  if (Number(snapshot.member_count) > 0) {
    return { amount: Number(snapshot.amount ?? 0), source: "cafe24" as const };
  }

  const ledger = db.prepare(
    `SELECT COALESCE(SUM(CASE
       WHEN l.action = 'issue' THEN l.amount
       WHEN l.action = 'recover' THEN -l.amount
       ELSE 0
     END), 0) AS amount
       FROM reward_ledger l
       JOIN orders o ON o.external_order_id = l.external_order_id
      WHERE l.status = 'succeeded'
        AND o.source = 'cafe24'
        AND o.paid_at IS NOT NULL
        AND o.status <> 'cancelled'`
  ).get() as { amount: number };
  return { amount: Number(ledger.amount ?? 0), source: "ledger" as const };
}

export type DashboardRewardBalanceByGrade = {
  source: "cafe24" | "ledger";
  amounts: Record<string, number>;
  unassignedMemberCount: number;
};

async function getDashboardRewardBalanceByGradeFromSnapshots(
  snapshots: Array<{ member_id: string; balance: number }>
): Promise<DashboardRewardBalanceByGrade> {
  if (snapshots.length === 0) {
    return { source: "ledger", amounts: {}, unassignedMemberCount: 0 };
  }

  const settings = getRewardSettings();
  const gradeIdByCafe24GroupNo = new Map(
    settings.grades.flatMap((grade) => grade.cafe24GroupNo
      ? [[grade.cafe24GroupNo, grade.id] as const]
      : [])
  );
  const amounts = Object.fromEntries(settings.grades.map((grade) => [grade.id, 0])) as Record<string, number>;
  let unassignedMemberCount = 0;

  // 현재 등급은 1분 캐시된 카페24 조회값을 사용해, 잔액이 등급 이동 후에도
  // 이전 등급에 남지 않도록 합니다.
  for (let offset = 0; offset < snapshots.length; offset += 5) {
    const results = await Promise.all(snapshots.slice(offset, offset + 5).map(async (snapshot) => {
      const groupNo = await getCurrentCustomerGroupNo(snapshot.member_id);
      return {
        balance: Number(snapshot.balance ?? 0),
        gradeId: groupNo ? gradeIdByCafe24GroupNo.get(groupNo) : undefined,
      };
    }));
    for (const result of results) {
      if (!result.gradeId) {
        unassignedMemberCount += 1;
        continue;
      }
      amounts[result.gradeId] += result.balance;
    }
  }

  return { source: "cafe24", amounts, unassignedMemberCount };
}

/**
 * 카페24 회원별 실제 보유 적립금 잔액을 현재 회원등급에 따라 합산합니다.
 * 망고TCG 지급·회수 성공 직후에는 해당 회원 스냅샷을 즉시 다시 읽기 때문에,
 * 회수된 금액은 카페24가 반환한 현재 잔액에 이미 반영됩니다.
 */
export async function getDashboardRewardBalanceByGrade(): Promise<DashboardRewardBalanceByGrade> {
  const snapshots = db.prepare(
    `SELECT member_id, balance FROM cafe24_member_point_balance_snapshots`
  ).all() as Array<{ member_id: string; balance: number }>;
  return getDashboardRewardBalanceByGradeFromSnapshots(snapshots);
}

/**
 * 초기 이관된 기존 잔액은 주문별 결제수단 정보가 없으므로, 카드 지급 원장과
 * 중복시키지 않고 무통장 합계에만 합산해 표시합니다.
 */
export async function getDashboardLegacyRewardBalanceByGrade(): Promise<DashboardRewardBalanceByGrade> {
  const snapshots = db.prepare(
    `SELECT member_id, balance FROM cafe24_member_point_balance_snapshots
      WHERE source_file <> 'live-cafe24'`
  ).all() as Array<{ member_id: string; balance: number }>;
  return getDashboardRewardBalanceByGradeFromSnapshots(snapshots);
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
  const summaries = rows.reduce<Record<string, RewardOrderSummary>>((result, row) => {
    const summary = result[row.external_order_id] ?? {};
    summary[row.action] = { amount: row.amount, status: row.status, grade_id: row.grade_id };
    result[row.external_order_id] = summary;
    return result;
  }, {});
  for (const summary of Object.values(summaries)) {
    if (summary.issue?.status === "succeeded" && summary.recover?.status === "succeeded" &&
      summary.recover.amount > 0 && summary.recover.amount < summary.issue.amount) {
      summary.issue.amount -= summary.recover.amount;
      delete summary.recover;
    }
  }
  return summaries;
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

/**
 * 실지급/회수 성공 직후 카페24의 실제 잔액을 다시 읽어 대시보드 등급별 합계도 갱신합니다.
 * 잔액 조회 실패는 이미 완료된 카페24 지급을 실패로 되돌리거나 재시도하지 않습니다.
 */
async function refreshCafe24PointBalanceSnapshot(memberId: string, buyerName?: string | null) {
  try {
    const customer = await getCafe24CustomerPointBalance(memberId);
    db.prepare(
      `INSERT INTO cafe24_member_point_balance_snapshots
        (member_id, buyer_name, balance, source_file, source_date, imported_at)
       VALUES (?, ?, ?, 'live-cafe24', date('now'), datetime('now'))
       ON CONFLICT(member_id) DO UPDATE SET
         buyer_name = excluded.buyer_name,
         balance = excluded.balance,
         source_file = excluded.source_file,
         source_date = excluded.source_date,
         imported_at = excluded.imported_at`
    ).run(customer.memberId, buyerName?.trim() || customer.memberId, customer.balance);
  } catch (error) {
    console.error("[cafe24 reward] point balance snapshot refresh failed", {
      memberId,
      message: error instanceof Error ? error.message : "unknown error",
    });
  }
}

function isFullyCancelled(order: Cafe24RewardOrder) {
  const items = Array.isArray(order.items) ? order.items : [];
  return items.length > 0 && items.every(isExcludedRewardItem);
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

function hasPositiveCafe24PointRate(values: Record<string, string | number | null> | undefined) {
  return Object.values(values ?? {}).some((value) => {
    const amount = Number(value);
    return Number.isFinite(amount) && amount > 0;
  });
}

/** 카페24 자체 적립금이 실제로 발생하는지 확인한다. 조회 실패는 이중 지급 방지를 위해 활성으로 취급한다. */
async function hasActiveCafe24NativeReward(groupNo: string | number, buyBenefits: string | undefined) {
  // F: 혜택 없음, D: 구매금액 할인만 적용. 둘은 카페24 적립금을 생성하지 않는다.
  if (["F", "D"].includes(buyBenefits ?? "")) return false;

  try {
    const group = await getCafe24CustomerGroup(groupNo);
    if (!group) return true;
    return hasPositiveCafe24PointRate(group.points_information) ||
      hasPositiveCafe24PointRate(group.mobile_points_information);
  } catch {
    return true;
  }
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
  if (!memberId || groupNo === undefined || groupNo === null || !grade) {
    return { outcome: "skipped" as const };
  }

  // 카페24 자체 등급별 적립이 남아 있으면 망고TCG 지급과 중복될 수 있으므로 실패 안전으로 차단합니다.
  const groups = await getCafe24CustomerGroups();
  const cafe24Group = groups.find((group) => String(group.group_no) === String(groupNo));
  if (!cafe24Group || await hasActiveCafe24NativeReward(groupNo, cafe24Group.buy_benefits)) {
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
  const calculation = calculateRewardAmount(order, appliedRate);
  if (!calculation) return { outcome: "amount_unavailable" as const };
  const amount = calculation.amount;
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
    await refreshCafe24PointBalanceSnapshot(memberId, order.billing_name);
    return { outcome: "issued" as const, amount };
  } catch (error) {
    markLedger(ledgerId, "failed", error);
    throw error;
  }
}

/** 자동 회수는 카페24의 현재 정상 품목 금액을 다시 계산해 전액·부분 취소 모두 정확한 차액만 회수합니다. */
export async function recoverRewardForOrder(orderId: string, mode: "automatic" | "manual") {
  if (!canExecuteCafe24RewardChanges()) return { outcome: "blocked" as const };
  const issue = getLedger(orderId, "issue");
  if (!issue || issue.status !== "succeeded") return { outcome: "skipped" as const };

  let targetRecoveryAmount = issue.amount;
  if (mode === "automatic") {
    const grade = getRewardSettings().grades.find((item) => item.id === issue.grade_id);
    if (!grade || grade.recoveryMode !== "automatic") return { outcome: "manual_required" as const };
    const order = await getCafe24OrderForReward(orderId);
    const target = isFullyCancelled(order) ? { amount: 0 } : calculateRewardAmount(order, issue.applied_rate);
    if (!target) return { outcome: "amount_unavailable" as const };
    targetRecoveryAmount = Math.max(0, issue.amount - target.amount);
  }

  const existingRecovery = getLedger(orderId, "recover");
  const alreadyRecovered = existingRecovery?.amount ?? 0;
  if (targetRecoveryAmount <= alreadyRecovered) return { outcome: "duplicate" as const };
  let amountToRecover = targetRecoveryAmount;
  let ledgerId: number;
  if (existingRecovery) {
    // A prior overpayment correction may have recovered only the excess. If the order
    // is later cancelled, recover the remaining net payout and keep one cumulative row.
    if (existingRecovery.status !== "succeeded" || existingRecovery.amount >= issue.amount) {
      return { outcome: "duplicate" as const };
    }
    amountToRecover = targetRecoveryAmount - existingRecovery.amount;
    const reservation = db.prepare(
      `UPDATE reward_ledger
          SET amount = ?, processing_mode = ?, status = 'pending', error_message = NULL, processed_at = NULL
        WHERE id = ? AND status = 'succeeded' AND amount = ?`
    ).run(targetRecoveryAmount, mode, existingRecovery.id, existingRecovery.amount);
    if (reservation.changes !== 1) return { outcome: "duplicate" as const };
    ledgerId = existingRecovery.id;
  } else {
    const reservation = db.prepare(
      `INSERT OR IGNORE INTO reward_ledger (
        external_order_id, member_id, grade_id, action, amount, card_rate, bank_rate, applied_rate, processing_mode, status
      ) VALUES (?, ?, ?, 'recover', ?, ?, ?, ?, ?, 'pending')`
    ).run(orderId, issue.member_id, issue.grade_id, targetRecoveryAmount, issue.card_rate, issue.bank_rate, issue.applied_rate, mode);
    if (reservation.changes !== 1) return { outcome: "duplicate" as const };
    ledgerId = Number(reservation.lastInsertRowid);
  }

  try {
    await changeCafe24Points({
      memberId: issue.member_id,
      orderId,
      amount: amountToRecover,
      type: "decrease",
      reason: "망고TCG 취소·환불 적립금 회수",
    });
    markLedger(ledgerId, "succeeded");
    await refreshCafe24PointBalanceSnapshot(issue.member_id);
    return { outcome: "recovered" as const, amount: amountToRecover };
  } catch (error) {
    markLedger(ledgerId, "failed", error);
    throw error;
  }
}

/** 주문 품목의 실제 결제금액으로 과지급분만 회수해 정상 지급액을 잔액에 남깁니다. */
export async function correctOverIssuedReward(orderId: string) {
  if (!canExecuteCafe24RewardChanges()) return { outcome: "blocked" as const };
  const issue = getLedger(orderId, "issue");
  if (!issue || issue.status !== "succeeded") return { outcome: "skipped" as const };
  if (getLedger(orderId, "recover")) return { outcome: "duplicate" as const };

  const order = await getCafe24OrderForReward(orderId, { includeBuyerGroup: true });
  if (!isPaymentConfirmed(order) || isFullyCancelled(order)) return { outcome: "skipped" as const };
  if (order.member_id && order.member_id !== issue.member_id) return { outcome: "member_mismatch" as const };
  const calculation = calculateRewardAmount(order, issue.applied_rate);
  if (!calculation) return { outcome: "amount_unavailable" as const };
  const correctAmount = calculation.amount;
  if (correctAmount >= issue.amount) return { outcome: "not_overpaid" as const };
  const excessAmount = issue.amount - correctAmount;
  const reservation = db.prepare(
    `INSERT OR IGNORE INTO reward_ledger (
      external_order_id, member_id, grade_id, action, amount, card_rate, bank_rate, applied_rate, processing_mode, status
    ) VALUES (?, ?, ?, 'recover', ?, ?, ?, ?, 'manual', 'pending')`
  ).run(orderId, issue.member_id, issue.grade_id, excessAmount, issue.card_rate, issue.bank_rate, issue.applied_rate);
  if (reservation.changes !== 1) return { outcome: "duplicate" as const };
  const ledgerId = Number(reservation.lastInsertRowid);

  try {
    await changeCafe24Points({
      memberId: issue.member_id,
      orderId,
      amount: excessAmount,
      type: "decrease",
      reason: "망고TCG 적립금 과다 지급 정정 회수",
    });
    markLedger(ledgerId, "succeeded");
    await refreshCafe24PointBalanceSnapshot(issue.member_id, order.billing_name);
    return { outcome: "corrected" as const, recoveredAmount: excessAmount, remainingAmount: correctAmount };
  } catch (error) {
    markLedger(ledgerId, "failed", error);
    throw error;
  }
}
