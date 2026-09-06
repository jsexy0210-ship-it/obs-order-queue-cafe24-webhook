import { NextRequest, NextResponse } from "next/server";
import { cancelOrder, insertOrder, markOrderPaid } from "@/lib/store";
import {
  extractCafe24OrderId,
  extractCafe24PaymentInfo,
  normalizeCafe24Order,
  redactPiiForLogging,
} from "@/lib/cafe24";

export const runtime = "nodejs";

// 카페24 개발자센터 WebHook 설정에서 이벤트별로 URL을 따로 등록합니다.
// 예)
//   주문접수 이벤트   -> .../api/webhooks/cafe24?token=xxx&event=created
//   주문취소 이벤트   -> .../api/webhooks/cafe24?token=xxx&event=cancelled
//   환불/입금취소 이벤트 -> .../api/webhooks/cafe24?token=xxx&event=refunded
// payload 안의 필드로 이벤트 종류를 추측할 필요 없이 URL만으로 정확히 구분됩니다.
export async function POST(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  const expected = process.env.CAFE24_WEBHOOK_TOKEN;

  if (expected && token !== expected) {
    return NextResponse.json({ error: "invalid token" }, { status: 401 });
  }

  const event = req.nextUrl.searchParams.get("event") ?? "created";

  const payload = await req.json().catch(() => null);
  if (!payload) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  // 구매자 이름/이메일/연락처/주소 등은 로그에서 가리고, 필드 매핑 디버깅에 필요한
  // 구조(주문번호/상품/결제방식 등)만 남깁니다. (pm2 logs에 무기한 남는 로그라 PII 최소화 필요)
  console.log(
    `[cafe24 webhook][${event}] payload:`,
    JSON.stringify(redactPiiForLogging(payload))
  );

  if (event === "cancelled" || event === "refunded") {
    const orderId = extractCafe24OrderId(payload);

    if (!orderId) {
      console.warn(
        `[cafe24 webhook][${event}] 주문번호를 찾지 못했습니다 - lib/cafe24.ts의 extractCafe24OrderId() 확인 필요`
      );
      return NextResponse.json({ ok: true, warning: "order_id_not_found" });
    }

    const matched = cancelOrder(orderId, event);
    if (!matched) {
      console.warn(`[cafe24 webhook][${event}] 큐에 없는 주문(${orderId}) - 무시`);
    }

    return NextResponse.json({ ok: true, matched });
  }

  if (event === "paid") {
    const orderId = extractCafe24OrderId(payload);
    if (!orderId) {
      console.warn(
        `[cafe24 webhook][paid] 주문번호를 찾지 못했습니다 - lib/cafe24.ts의 extractCafe24OrderId() 확인 필요`
      );
      return NextResponse.json({ ok: true, warning: "order_id_not_found" });
    }

    const matched = markOrderPaid(orderId, extractCafe24PaymentInfo(payload));
    if (!matched) {
      console.warn(`[cafe24 webhook][paid] 큐에 없거나 이미 입금완료 처리된 주문(${orderId}) - 무시`);
    }

    return NextResponse.json({ ok: true, matched });
  }

  // 기본값: 주문 접수(생성)
  const normalized = normalizeCafe24Order(payload);

  if (!normalized) {
    console.warn(
      "[cafe24 webhook][created] 정규화 실패 - lib/cafe24.ts의 normalizeCafe24Order() 필드명 확인 필요"
    );
    return NextResponse.json({ ok: true, warning: "normalize_failed" });
  }

  insertOrder({
    source: "cafe24",
    externalOrderId: normalized.externalOrderId,
    userId: normalized.userId,
    product: normalized.product,
    quantity: normalized.quantity,
    unitPrice: normalized.unitPrice,
    youtubeNickname: normalized.youtubeNickname,
    paymentMethod: normalized.paymentMethod,
    paymentGatewayName: normalized.paymentGatewayName,
    easypayName: normalized.easypayName,
    paid: normalized.paid,
    paymentDate: normalized.paymentDate,
  });

  return NextResponse.json({ ok: true });
}
