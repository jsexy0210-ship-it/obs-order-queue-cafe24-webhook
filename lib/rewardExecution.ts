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
  if (!canExecuteCafe24RewardChanges()) {
    throw new Error("카페24 적립금 기능이 테스트 모드이므로 실제 지급·회수를 실행할 수 없습니다.");
  }
}
