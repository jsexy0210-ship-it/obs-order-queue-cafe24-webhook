import { getCafe24OrdersForMonths, currentOrderView } from "./cafe24OrderView";
import { db } from "./db";
import { getOrderHistory } from "./store";

export type ProfitBriefingType = "daily" | "weekly" | "monthly";

export type ProfitBriefing = {
  id: number;
  period_type: ProfitBriefingType;
  period_key: string;
  period_label: string;
  period_start_at: string;
  period_end_at: string;
  scheduled_at: string;
  total_purchase_amount: number;
  margin_rate: number;
  net_margin_amount: number;
  source_order_count: number;
  generated_at: string;
};

type Schedule = {
  periodType: ProfitBriefingType;
  periodKey: string;
  periodLabel: string;
  periodStartMs: number;
  scheduledMs: number;
};

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
export const PROFIT_MARGIN_RATE = 0.25;

function datePartsAtKst(timeMs: number) {
  const date = new Date(timeMs + KST_OFFSET_MS);
  return {
    year: date.getUTCFullYear(),
    monthIndex: date.getUTCMonth(),
    day: date.getUTCDate(),
    weekday: date.getUTCDay(),
  };
}

function kstTimeMs(year: number, monthIndex: number, day: number, hour = 0, minute = 0) {
  return Date.UTC(year, monthIndex, day, hour, minute) - KST_OFFSET_MS;
}

function dateKey(year: number, monthIndex: number, day: number) {
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function dailySchedule(nowMs: number): Schedule {
  const now = datePartsAtKst(nowMs);
  let scheduledMs = kstTimeMs(now.year, now.monthIndex, now.day, 9);
  if (scheduledMs > nowMs) scheduledMs -= DAY_MS;
  const scheduled = datePartsAtKst(scheduledMs);
  const key = dateKey(scheduled.year, scheduled.monthIndex, scheduled.day);
  return {
    periodType: "daily",
    periodKey: key,
    periodLabel: `${scheduled.year}년 ${scheduled.monthIndex + 1}월 ${scheduled.day}일`,
    periodStartMs: kstTimeMs(scheduled.year, scheduled.monthIndex, scheduled.day),
    scheduledMs,
  };
}

function weeklySchedule(nowMs: number): Schedule {
  const now = datePartsAtKst(nowMs);
  const daysSinceMonday = (now.weekday + 6) % 7;
  let mondayMidnightMs = kstTimeMs(now.year, now.monthIndex, now.day) - daysSinceMonday * DAY_MS;
  let scheduledMs = mondayMidnightMs + 9 * 60 * 60 * 1000 + 10 * 60 * 1000;
  if (scheduledMs > nowMs) {
    mondayMidnightMs -= 7 * DAY_MS;
    scheduledMs -= 7 * DAY_MS;
  }
  const monday = datePartsAtKst(mondayMidnightMs);
  const key = dateKey(monday.year, monday.monthIndex, monday.day);
  return {
    periodType: "weekly",
    periodKey: key,
    periodLabel: `${monday.year}년 ${monday.monthIndex + 1}월 ${monday.day}일 시작 주`,
    periodStartMs: mondayMidnightMs,
    scheduledMs,
  };
}

function monthlySchedule(nowMs: number): Schedule {
  const now = datePartsAtKst(nowMs);
  const lastDay = new Date(Date.UTC(now.year, now.monthIndex + 1, 0)).getUTCDate();
  const currentScheduledMs = kstTimeMs(now.year, now.monthIndex, lastDay, 9);
  const target = currentScheduledMs <= nowMs
    ? { year: now.year, monthIndex: now.monthIndex }
    : now.monthIndex === 0
      ? { year: now.year - 1, monthIndex: 11 }
      : { year: now.year, monthIndex: now.monthIndex - 1 };
  const targetLastDay = new Date(Date.UTC(target.year, target.monthIndex + 1, 0)).getUTCDate();
  return {
    periodType: "monthly",
    periodKey: `${target.year}-${String(target.monthIndex + 1).padStart(2, "0")}`,
    periodLabel: `${target.year}년 ${target.monthIndex + 1}월`,
    periodStartMs: kstTimeMs(target.year, target.monthIndex, 1),
    scheduledMs: kstTimeMs(target.year, target.monthIndex, targetLastDay, 9),
  };
}

export function getLatestDueProfitBriefingSchedules(nowMs = Date.now()): Schedule[] {
  return [dailySchedule(nowMs), weeklySchedule(nowMs), monthlySchedule(nowMs)];
}

function sqliteUtc(timeMs: number) {
  return new Date(timeMs).toISOString().slice(0, 19).replace("T", " ");
}

function parseSqliteUtc(value: string) {
  return new Date(`${value.replace(" ", "T")}Z`).getTime();
}

function isStored(schedule: Schedule) {
  return Boolean(db.prepare(
    "SELECT 1 FROM profit_briefings WHERE period_type = ? AND period_key = ?"
  ).get(schedule.periodType, schedule.periodKey));
}

function monthsInRange(startMs: number, endMs: number) {
  const results = new Map<number, number[]>();
  const start = datePartsAtKst(startMs);
  const end = datePartsAtKst(Math.max(startMs, endMs - 1));
  let year = start.year;
  let monthIndex = start.monthIndex;
  while (year < end.year || (year === end.year && monthIndex <= end.monthIndex)) {
    results.set(year, [...(results.get(year) ?? []), monthIndex + 1]);
    monthIndex += 1;
    if (monthIndex === 12) {
      monthIndex = 0;
      year += 1;
    }
  }
  return results;
}

export async function generateDueProfitBriefings(nowMs = Date.now()) {
  const schedules = getLatestDueProfitBriefingSchedules(nowMs).filter((schedule) => !isStored(schedule));
  if (schedules.length === 0) return [];

  const requestedMonths = new Map<number, Set<number>>();
  schedules.forEach((schedule) => {
    monthsInRange(schedule.periodStartMs, schedule.scheduledMs).forEach((months, year) => {
      const existing = requestedMonths.get(year) ?? new Set<number>();
      months.forEach((month) => existing.add(month));
      requestedMonths.set(year, existing);
    });
  });
  const cafe24OrderGroups = await Promise.all(
    Array.from(requestedMonths).map(([year, months]) =>
      getCafe24OrdersForMonths(year, Array.from(months).sort((a, b) => a - b), { fresh: true })
    )
  );
  const currentOrders = await currentOrderView(getOrderHistory(), cafe24OrderGroups.flat());
  const insert = db.prepare(
    `INSERT OR IGNORE INTO profit_briefings (
       period_type, period_key, period_label, period_start_at, period_end_at, scheduled_at,
       total_purchase_amount, margin_rate, net_margin_amount, source_order_count
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const generated: string[] = [];
  for (const schedule of schedules) {
    const paidOrders = currentOrders.filter((order) => {
      const createdAt = parseSqliteUtc(order.created_at);
      return order.status !== "cancelled"
        && Boolean(order.paid_at)
        && createdAt >= schedule.periodStartMs
        && createdAt < schedule.scheduledMs;
    });
    const totalPurchaseAmount = paidOrders.reduce(
      (total, order) => total + Math.max(0, Math.round(order.actual_amount)), 0
    );
    const result = insert.run(
      schedule.periodType,
      schedule.periodKey,
      schedule.periodLabel,
      sqliteUtc(schedule.periodStartMs),
      sqliteUtc(schedule.scheduledMs),
      sqliteUtc(schedule.scheduledMs),
      totalPurchaseAmount,
      PROFIT_MARGIN_RATE,
      Math.round(totalPurchaseAmount * PROFIT_MARGIN_RATE),
      paidOrders.length
    );
    if (result.changes > 0) generated.push(`${schedule.periodType}:${schedule.periodKey}`);
  }
  return generated;
}

export function listProfitBriefings(limit = 30): ProfitBriefing[] {
  const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
  return db.prepare(
    `SELECT * FROM profit_briefings
     ORDER BY scheduled_at DESC,
       CASE period_type WHEN 'daily' THEN 1 WHEN 'weekly' THEN 2 ELSE 3 END
     LIMIT ?`
  ).all(safeLimit) as ProfitBriefing[];
}
