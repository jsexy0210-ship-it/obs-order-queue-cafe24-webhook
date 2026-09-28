type Cafe24Normalized = {
  externalOrderId: string;
  userId: string;
  product: string;
  quantity: number;
  unitPrice: number;
  youtubeNickname: string | null;
  paymentMethod: string | null;
  paymentGatewayName: string | null;
  easypayName: string | null;
  paid: boolean;
  paymentDate: string | null;
};

export type Cafe24PaymentInfo = Pick<
  Cafe24Normalized,
  "paymentMethod" | "paymentGatewayName" | "easypayName" | "paid" | "paymentDate"
>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function pick(obj: any, keys: string[]): unknown {
  if (!obj) return undefined;
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null && obj[key] !== "") {
      return obj[key];
    }
  }
  return undefined;
}

/**
 * 카페24 "주문서 추가 입력 항목"(additional_order_info_list)은
 * "필드명  = 값" 형태의 문자열로 옵니다. 여러 항목이면 줄바꿈으로 구분됩니다.
 * 예: "유튜브 닉네임  = 재호"
 */
function parseAdditionalOrderInfo(raw: unknown): Record<string, string> {
  if (typeof raw !== "string" || raw.length === 0) return {};

  const result: Record<string, string> = {};
  const lines = raw.split(/\r?\n/);

  for (const line of lines) {
    const idx = line.indexOf("=");
    if (idx === -1) continue;
    const label = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (label) result[label] = value;
  }

  return result;
}

/**
 * additional_order_info_list 안에서 "유튜브 닉네임" 항목의 값을 찾습니다.
 * 라벨은 쇼핑몰 설정에 따라 문구가 조금 달라질 수 있어 "유튜브"/"youtube"가 들어간 라벨을 폭넓게 찾습니다.
 */
function extractYoutubeNickname(raw: unknown): string | null {
  const info = parseAdditionalOrderInfo(raw);
  for (const [label, value] of Object.entries(info)) {
    if (label.includes("유튜브") || label.toLowerCase().includes("youtube")) {
      return value || null;
    }
  }
  return null;
}

/**
 * 카페24 웹훅 페이로드를 오버레이 주문 큐 형식으로 변환합니다.
 *
 * ⚠️ 중요: 카페24 웹훅의 정확한 필드명은 이벤트 종류(주문접수 / 입금완료 등)와
 * 앱 설정에 따라 달라질 수 있어, 공개 문서만으로는 100% 확정할 수 없습니다.
 * 아래 매핑은 "일반적으로 쓰이는 필드명"을 가정한 1차 추정치입니다.
 *
 * 연동 순서:
 *   1. 카페24 개발자센터 앱 설정에서 WebHook URL을
 *      https://<ngrok-주소>/api/webhooks/cafe24?token=<CAFE24_WEBHOOK_TOKEN> 로 등록
 *   2. 테스트 주문을 한 건 발생시켜 실제 웹훅을 받아봄
 *   3. app/api/webhooks/cafe24/route.ts 의 console.log로 찍히는 원본 payload를 확인
 *   4. 아래 pick() 목록에 실제 필드명을 맞게 추가/수정
 *
 * 이 함수가 null을 반환하면 주문이 큐에 추가되지 않고 콘솔에 경고만 남습니다.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normalizeCafe24Order(payload: any): Cafe24Normalized | null {
  const resource = payload?.resource ?? payload?.order ?? payload;
  if (!resource) return null;

  const orderId = pick(resource, ["order_id", "order_no", "orderId", "orderNo"]);
  const buyerName = pick(resource, [
    "billing_name",
    "buyer_name",
    "orderer_name",
    "member_id",
    "name",
  ]);

  const items = resource.extra_info ?? resource.items ?? resource.order_items ?? resource.order_products ?? [];
  const firstItem = Array.isArray(items) && items.length > 0 ? items[0] : undefined;

  const productName =
    pick(firstItem ?? {}, ["product_name", "productName", "item_name"]) ??
    pick(resource, ["ordering_product_name", "product_name", "order_name"]) ??
    "미확인 상품";

  const quantityRaw =
    pick(firstItem ?? {}, ["quantity", "order_quantity"]) ?? pick(resource, ["quantity"]) ?? 1;

  const unitPriceRaw =
    pick(firstItem ?? {}, ["product_price", "price", "unit_price"]) ?? 15000;

  // additional_order_info_list는 extra_info(품목) 안이 아니라 주문(resource) 최상위에 있습니다.
  const additionalInfoRaw = pick(resource, ["additional_order_info_list"]);
  const youtubeNickname = extractYoutubeNickname(additionalInfoRaw);

  const paymentMethodRaw = pick(resource, ["payment_method", "payment_method_name"]);
  const paymentMethod = paymentMethodRaw ? String(paymentMethodRaw) : null;
  const paymentInfo = extractCafe24PaymentInfo(payload);

  if (!orderId || !buyerName) {
    return null;
  }

  const quantity = Number(quantityRaw);
  const unitPrice = Number(unitPriceRaw);

  return {
    externalOrderId: String(orderId),
    userId: String(buyerName).trim(),
    product: String(productName),
    quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
    unitPrice: Number.isFinite(unitPrice) && unitPrice > 0 ? unitPrice : 15000,
    youtubeNickname,
    paymentMethod,
    paymentGatewayName: paymentInfo.paymentGatewayName,
    easypayName: paymentInfo.easypayName,
    paid: paymentInfo.paid,
    paymentDate: paymentInfo.paymentDate,
  };
}

// 주문생성/입금완료 웹훅 모두에서 결제 정보를 동일한 규칙으로 읽습니다.
// 카드처럼 주문생성 시 이미 paid=T인 결제도 즉시 결제완료로 기록할 수 있습니다.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function extractCafe24PaymentInfo(payload: any): Cafe24PaymentInfo {
  const resource = payload?.resource ?? payload?.order ?? payload ?? {};
  const paymentMethodRaw = pick(resource, ["payment_method", "first_payment_method", "payment_method_name"]);
  const paymentGatewayRaw = pick(resource, ["payment_gateway_name", "payment_gateway_names"]);
  const easypayRaw = pick(resource, ["easypay_name", "sub_payment_method_name"]);
  const paidRaw = pick(resource, ["paid", "payment_status"]);
  const paymentDateRaw = pick(resource, ["payment_date", "paid_at", "paid_date"]);

  return {
    paymentMethod: paymentMethodRaw ? String(paymentMethodRaw) : null,
    paymentGatewayName: paymentGatewayRaw ? String(paymentGatewayRaw) : null,
    easypayName: easypayRaw ? String(easypayRaw) : null,
    paid: paidRaw === true || paidRaw === 1 || String(paidRaw).toUpperCase() === "T",
    paymentDate: paymentDateRaw ? String(paymentDateRaw) : null,
  };
}

/**
 * 취소/환불 웹훅은 주문번호만 정확히 매칭되면 되므로, 생성 웹훅보다 훨씬 단순합니다.
 * 콘솔에 찍힌 실제 payload를 보고 필요하면 pick() 목록에 필드명을 추가하세요.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function extractCafe24OrderId(payload: any): string | null {
  const resource = payload?.resource ?? payload?.order ?? payload;
  const orderId = pick(resource, ["order_id", "order_no", "orderId", "orderNo"]);
  return orderId ? String(orderId) : null;
}

/**
 * 웹훅 payload에서 구매자 개인정보(이름/이메일/연락처/주소 등)로 보이는 키를 찾아냅니다.
 * 카페24 웹훅 필드는 보통 "buyer_", "orderer_", "receiver_", "member_" 접두어를 쓰므로
 * 이 접두어들과, 접두어 없이도 개인정보임이 명확한 email/phone/address류 키를 대상으로 합니다.
 * (order_id, product_name, payment_method 같은 주문/상품 정보는 건드리지 않습니다.)
 */
function isPiiKey(key: string): boolean {
  const k = key.toLowerCase();
  return (
    k.startsWith("buyer_") ||
    k.startsWith("orderer_") ||
    k.startsWith("receiver_") ||
    k.startsWith("member_") ||
    k === "billing_name" ||
    k.includes("bank_account") ||
    k === "shipping_message" ||
    k === "email" ||
    k === "phone" ||
    k === "cellphone" ||
    k === "hp" ||
    k.includes("address") ||
    k.includes("zipcode") ||
    k.includes("zonecode")
  );
}

/**
 * 로그용으로 payload를 재귀적으로 훑어 개인정보 필드값을 "[REDACTED]"로 가려줍니다.
 * 필드 매핑 디버깅에 필요한 구조/키 이름은 그대로 남기고, 값만 가립니다.
 */
export function redactPiiForLogging(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactPiiForLogging);
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      out[key] = isPiiKey(key) ? "[REDACTED]" : redactPiiForLogging(v);
    }
    return out;
  }
  return value;
}
