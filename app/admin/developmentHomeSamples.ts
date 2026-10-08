import type { ShortsOverlaySettings } from "@/lib/overlaySettings";
import type { LiveHitCard, LiveOrder } from "@/app/useLiveCardBreak";

/**
 * 개발 서버의 관리자 홈을 점검하기 위한 화면 전용 예시입니다.
 * 데이터베이스에 기록하지 않으며, production 빌드에서는 호출되지 않습니다.
 */
export const DEVELOPMENT_HOME_SAMPLES_ENABLED = process.env.NODE_ENV === "development";

function timestamp(hoursAgo: number) {
  return new Date(Date.now() - hoursAgo * 60 * 60 * 1000).toISOString();
}

function sampleOrder(id: number, partial: Partial<LiveOrder>): LiveOrder {
  const createdAt = partial.created_at ?? timestamp(3);
  return {
    id,
    source: "development-sample",
    external_order_id: `DEV-${Math.abs(id)}`,
    user_id: "샘플 구매자",
    product: "[샘플] 포켓몬 카드 컬렉션 팩",
    product_image_url: null,
    quantity: 1,
    unit_price: 29_900,
    actual_amount: 29_900,
    tier: "Collector",
    status: "waiting",
    prev_status: null,
    cancel_reason: null,
    cancelled_at: null,
    started_at: null,
    completed_at: null,
    timer_seconds: 60,
    youtube_nickname: "샘플채널",
    paid_at: timestamp(2),
    payment_method: "card",
    payment_gateway_name: null,
    easypay_name: null,
    created_at: createdAt,
    ...partial,
  };
}

export function getDevelopmentHomeSamples() {
  const opening = sampleOrder(-101, {
    user_id: "오픈샘플",
    product: "[샘플] 메가 드림 ex 2PACK",
    quantity: 2,
    actual_amount: 59_800,
    tier: "Legend",
    status: "opening",
    started_at: timestamp(0.25),
    youtube_nickname: "MangoLive",
  });
  const waiting = [
    sampleOrder(-102, { user_id: "카드샘플", product: "[샘플] 블랙 볼트 1PACK", payment_method: "card" }),
    sampleOrder(-103, { user_id: "적립금샘플", product: "[샘플] 화이트 플레어 1PACK", payment_method: "card,point", actual_amount: 24_000 }),
    sampleOrder(-104, { user_id: "입금완료샘플", product: "[샘플] 스페셜 덱 세트", payment_method: "cash", paid_at: timestamp(1), actual_amount: 45_000 }),
  ];
  const pendingPayments = [
    sampleOrder(-105, { user_id: "무통장샘플", product: "[샘플] 테라스탈 페스티벌", payment_method: "cash", paid_at: null, actual_amount: 38_000 }),
    sampleOrder(-106, { user_id: "적립금입금샘플", product: "[샘플] 카드 프로텍터", payment_method: "cash,point", paid_at: null, actual_amount: 12_000 }),
  ];
  const cancelledOrders = [
    sampleOrder(-107, { user_id: "취소샘플", product: "[샘플] 트레이너 카드", status: "cancelled", cancel_reason: "cancelled", cancelled_at: timestamp(4), actual_amount: 18_000 }),
    sampleOrder(-108, { user_id: "환불샘플", product: "[샘플] 프리미엄 팩", status: "cancelled", cancel_reason: "refunded", cancelled_at: timestamp(6), actual_amount: 32_000 }),
  ];
  const completedToday = [
    sampleOrder(-109, { user_id: "완료샘플", product: "[샘플] 메가 드림 ex 2PACK", status: "done", completed_at: timestamp(1), actual_amount: 59_800 }),
    sampleOrder(-110, { user_id: "최종오픈샘플", product: "[샘플] 하이클래스 팩", status: "done", completed_at: timestamp(2), actual_amount: 49_000 }),
  ];
  const hitCards: LiveHitCard[] = [
    "리자몽 ex SAR", "피카츄 프로모", "뮤츠 AR", "이브이 컬렉션", "루기아 V", "가디안 ex"
  ].map((card, index) => ({
    id: -201 - index,
    user_id: "",
    card: `[샘플] ${card}`,
    youtube_nickname: `샘플${index + 1}`,
    created_at: timestamp(index + 1),
  }));

  return { opening, waiting, pendingPayments, cancelledOrders, completedToday, hitCards };
}

export function getDevelopmentDashboardSamples() {
  const orders = [
    { created_at: timestamp(0.5), actual_amount: 59_800, payment_method: "card", paid_at: timestamp(0.5), status: "done" },
    { created_at: timestamp(1.5), actual_amount: 45_000, payment_method: "cash", paid_at: timestamp(1.25), status: "done" },
    { created_at: timestamp(3), actual_amount: 24_000, payment_method: "card,point", paid_at: timestamp(3), status: "done" },
    { created_at: timestamp(5), actual_amount: 38_000, payment_method: "cash", paid_at: timestamp(4.5), status: "done" },
    { created_at: timestamp(8), actual_amount: 32_000, payment_method: "card", paid_at: timestamp(8), status: "done" },
  ];
  const rewardEntries = [
    { amount: 2_990, grade_id: "starter", payment_kind: "card" as const, order_created_at: timestamp(0.5) },
    { amount: 2_250, grade_id: "collector", payment_kind: "bank" as const, order_created_at: timestamp(1.5) },
    { amount: 1_200, grade_id: "trainer", payment_kind: "card" as const, order_created_at: timestamp(3) },
    { amount: 1_900, grade_id: "legend", payment_kind: "bank" as const, order_created_at: timestamp(5) },
    { amount: 1_600, grade_id: "elite_collector", payment_kind: "card" as const, order_created_at: timestamp(8) },
  ];
  return { orders, rewardEntries };
}

/** 2026-10-08 라이브 캡처의 화면 배치. 개발 미리보기에만 사용하며 저장하지 않습니다. */
export function getDevelopmentLiveOverlayReference(profile: ShortsOverlaySettings): ShortsOverlaySettings {
  if (!DEVELOPMENT_HOME_SAMPLES_ENABLED) return profile;
  return {
    ...profile,
    zones: {
      ...profile.zones,
      ranking: { ...profile.zones.ranking, x: 0, y: 0, width: 49.6495, height: 13.585 },
      hit: { ...profile.zones.hit, x: .350515, y: 13.585, width: 49.6495, height: 13.357 },
      current: { ...profile.zones.current, x: 49.6495, y: 21.5379, width: 50.3505, height: 15.1351 },
    },
  };
}
