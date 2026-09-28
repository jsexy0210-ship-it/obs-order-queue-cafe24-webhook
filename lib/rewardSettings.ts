export const REWARD_GRADE_IDS = [
  "starter",
  "trainer",
  "collector",
  "elite_collector",
  "master_collector",
  "champion",
  "legend",
  "legend_vip",
] as const;

export type RewardGradeId = (typeof REWARD_GRADE_IDS)[number];
export type RewardRecoveryMode = "automatic" | "manual";

export type RewardGradeSetting = {
  id: RewardGradeId;
  name: string;
  minimumPurchaseAmount: number | null;
  enabled: boolean;
  cardRate: number;
  bankRate: number;
  recoveryMode: RewardRecoveryMode;
  cafe24GroupNo: string | null;
};

export type RewardSettings = {
  enabled: boolean;
  calculationBase: "net_product_amount";
  issueTrigger: "paid" | "delivered";
  grades: RewardGradeSetting[];
};

// 새 설치에서는 실수로 적립금이 지급되지 않도록 전체 기능을 OFF로 시작합니다.
// 등급별 기본값은 망고TCG가 확정한 정책이며, 관리자가 설정 화면에서 변경할 수 있습니다.
export const DEFAULT_REWARD_SETTINGS: RewardSettings = {
  enabled: false,
  calculationBase: "net_product_amount",
  // 망고TCG 운영 정책의 기본 적립 시점은 결제완료 즉시입니다.
  issueTrigger: "paid",
  grades: [
    {
      id: "starter",
      name: "Starter",
      minimumPurchaseAmount: 0,
      enabled: true,
      cardRate: 0.5,
      bankRate: 2.5,
      recoveryMode: "manual",
      cafe24GroupNo: null,
    },
    {
      id: "trainer",
      name: "Trainer",
      minimumPurchaseAmount: 1_000_000,
      enabled: true,
      cardRate: 0.75,
      bankRate: 2.75,
      recoveryMode: "manual",
      cafe24GroupNo: null,
    },
    {
      id: "collector",
      name: "Collector",
      minimumPurchaseAmount: 3_000_000,
      enabled: true,
      cardRate: 1,
      bankRate: 3,
      recoveryMode: "manual",
      cafe24GroupNo: null,
    },
    {
      id: "elite_collector",
      name: "Elite Collector",
      minimumPurchaseAmount: 7_000_000,
      enabled: true,
      cardRate: 1.5,
      bankRate: 3.5,
      recoveryMode: "manual",
      cafe24GroupNo: null,
    },
    {
      id: "master_collector",
      name: "Master Collector",
      minimumPurchaseAmount: 15_000_000,
      enabled: true,
      cardRate: 2,
      bankRate: 4,
      recoveryMode: "manual",
      cafe24GroupNo: null,
    },
    {
      id: "champion",
      name: "Champion",
      minimumPurchaseAmount: 30_000_000,
      enabled: true,
      cardRate: 2.5,
      bankRate: 4.5,
      recoveryMode: "manual",
      cafe24GroupNo: null,
    },
    {
      id: "legend",
      name: "Legend",
      minimumPurchaseAmount: 60_000_000,
      enabled: true,
      cardRate: 3,
      bankRate: 5,
      recoveryMode: "manual",
      cafe24GroupNo: null,
    },
    {
      id: "legend_vip",
      name: "Legend VIP",
      minimumPurchaseAmount: 0,
      enabled: true,
      cardRate: 4,
      bankRate: 6,
      recoveryMode: "manual",
      cafe24GroupNo: null,
    },
  ],
};

function toRate(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.round(Math.min(20, Math.max(0, parsed)) * 100) / 100;
}

function toGroupNo(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized.slice(0, 30) : null;
}

function toGradeName(value: unknown, fallback: string): string {
  const normalized = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  return normalized.length > 0 ? normalized.slice(0, 20) : fallback;
}

function toMinimumPurchaseAmount(value: unknown, fallback: number | null): number | null {
  if (value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.floor(parsed);
}

/**
 * 저장 데이터가 일부 누락되거나 예전 형식이어도 현재 기본 등급을 기준으로 안전하게 복구합니다.
 * 등급 id/이름/누적 기준은 망고TCG 정책값을 사용하고 운영 설정만 사용자 입력을 반영합니다.
 */
export function normalizeRewardSettings(value: unknown): RewardSettings {
  const input = value && typeof value === "object" ? value as Partial<RewardSettings> : {};
  const inputGrades = Array.isArray(input.grades) ? input.grades : [];

  return {
    enabled: input.enabled === true,
    calculationBase: "net_product_amount",
    issueTrigger: input.issueTrigger === "delivered" ? "delivered" : "paid",
    grades: DEFAULT_REWARD_SETTINGS.grades.map((fallback) => {
      const saved = inputGrades.find((grade) => grade?.id === fallback.id);
      return {
        ...fallback,
        name: toGradeName(saved?.name, fallback.name),
        minimumPurchaseAmount: toMinimumPurchaseAmount(saved?.minimumPurchaseAmount, fallback.minimumPurchaseAmount),
        enabled: saved?.enabled !== false,
        cardRate: toRate(saved?.cardRate, fallback.cardRate),
        bankRate: toRate(saved?.bankRate, fallback.bankRate),
        recoveryMode: saved?.recoveryMode === "automatic" ? "automatic" : "manual",
        cafe24GroupNo: toGroupNo(saved?.cafe24GroupNo),
      };
    }),
  };
}
