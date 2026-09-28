import { getCafe24OAuthStatus } from "./cafe24OAuth";

export type RewardExecutionMode = "test" | "live";

export function isCafe24RewardIntegrationConfigured() {
  const status = getCafe24OAuthStatus();
  return status.configured && status.connected &&
    ["mall.read_order", "mall.write_mileage"].every((scope) => status.scopes.includes(scope));
}

/**
 * 실제 카페24 적립금 변경은 이 명시적인 운영 플래그가 true일 때만 허용합니다.
 * 인증정보가 존재하는 것만으로는 절대 실지급/실회수를 실행하지 않습니다.
 */
export function getRewardExecutionMode(): RewardExecutionMode {
  return process.env.CAFE24_REWARD_LIVE_ENABLED === "true" ? "live" : "test";
}

export function canExecuteCafe24RewardChanges() {
  return isCafe24RewardIntegrationConfigured() && getRewardExecutionMode() === "live";
}

export function assertCafe24RewardExecutionAllowed() {
  if (getRewardExecutionMode() !== "live") {
    throw new Error("운영 적립금 지급이 아직 활성화되지 않았습니다. 카페24 연결과 중복 지급 설정을 확인하세요.");
  }
  if (!isCafe24RewardIntegrationConfigured()) {
    throw new Error("카페24 OAuth 연결과 주문 조회·적립금 수정 권한이 필요합니다.");
  }
}

/** 관리자 확인을 거친 수동 보너스는 주문 자동 적립 플래그와 분리합니다. */
export function assertCafe24BonusExecutionAllowed() {
  if (!isCafe24RewardIntegrationConfigured()) {
    throw new Error("카페24 OAuth 연결과 주문 조회·적립금 수정 권한이 필요합니다.");
  }
}
