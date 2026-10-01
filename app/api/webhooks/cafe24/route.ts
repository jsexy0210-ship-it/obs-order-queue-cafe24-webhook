import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import {
  cancelOrder,
  insertOrder,
  markOrderPaid,
  saveCafe24OrderIdentity,
  updateCafe24Order,
} from "@/lib/store";
import {
  extractCafe24OrderId,
  extractCafe24PaymentInfo,
  normalizeCafe24Order,
  redactPiiForLogging,
} from "@/lib/cafe24";
import { getCafe24OrderBuyerInfo, getCafe24OrderForReward } from "@/lib/cafe24Admin";
import { issueRewardForOrder, recoverRewardForOrder } from "@/lib/rewardService";
import { getRewardSettings } from "@/lib/rewardStore";

export const runtime = "nodejs";

// 카페24 개발자센터 WebHook 설정에서 이벤트별로 URL을 따로 등록합니다.
// 예)
//   주문접수 이벤트   -> .../api/webhooks/cafe24?token=xxx&event=created
//   주문상품 추가 이벤트 -> .../api/webhooks/cafe24?token=xxx&event=product_added
//   주문취소 이벤트   -> .../api/webhooks/cafe24?token=xxx&event=cancelled
//   환불/입금취소 이벤트 -> .../api/webhooks/cafe24?token=xxx&event=refunded
// payload 안의 필드로 이벤트 종류를 추측할 필요 없이 URL만으로 정확히 구분됩니다.
export async function POST(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  const expected = process.env.CAFE24_WEBHOOK_TOKEN;

  if (!expected) {
    console.error("[cafe24 webhook] CAFE24_WEBHOOK_TOKEN is not configured");
    return NextResponse.json({ error: "webhook_not_configured" }, { status: 503 });
  }

  const expectedBuffer = Buffer.from(expected);
  const tokenBuffer = Buffer.from(token ?? "");
  if (
    expectedBuffer.length !== tokenBuffer.length ||
    !crypto.timingSafeEqual(expectedBuffer, tokenBuffer)
  ) {
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

    // 실패해도 카페24 웹훅을 재전송시키지 않습니다. 원장에 실패를 남기고 관리자에서 수동 회수할 수 있게 합니다.
    try {
      await recoverRewardForOrder(orderId, "automatic");
    } catch (error) {
      console.error("[cafe24 reward] automatic recovery failed", {
        orderId,
        message: error instanceof Error ? error.message : "unknown",
      });
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

    const payment = extractCafe24PaymentInfo(payload);
    if (!payment.paid) {
      return NextResponse.json({ ok: true, warning: "payment_not_confirmed" });
    }

    let matched = markOrderPaid(orderId, payment);
    if (!matched) {
      try {
        // 주문접수 웹훅이 누락되어도 결제완료 웹훅에서 Cafe24 원본을 확인해 큐 행을 복구합니다.
        const cafe24Order = await getCafe24OrderForReward(orderId);
        const verifiedPayment = extractCafe24PaymentInfo({ order: cafe24Order });
        if (cafe24Order.order_id !== orderId || !verifiedPayment.paid || cafe24Order.canceled === "T") {
          return NextResponse.json({ ok: true, matched: false, warning: "order_not_paid_or_cancelled" });
        }

        const normalized = normalizeCafe24Order({ order: cafe24Order });
        if (!normalized || normalized.externalOrderId !== orderId) {
          throw new Error("Cafe24 원본 주문의 필수 정보가 부족합니다.");
        }
        const amount = Number(cafe24Order.payment_amount);
        insertOrder({
          source: "cafe24",
          externalOrderId: normalized.externalOrderId,
          userId: normalized.userId,
          memberId: normalized.memberId,
          product: normalized.product,
          quantity: normalized.quantity,
          unitPrice: normalized.unitPrice,
          actualAmount: Number.isFinite(amount) && amount > 0 ? amount : null,
          youtubeNickname: normalized.youtubeNickname,
          paymentMethod: normalized.paymentMethod,
          paymentGatewayName: normalized.paymentGatewayName,
          easypayName: normalized.easypayName,
        });
        matched = markOrderPaid(orderId, {
          paymentMethod: verifiedPayment.paymentMethod ?? payment.paymentMethod,
          paymentGatewayName: verifiedPayment.paymentGatewayName ?? payment.paymentGatewayName,
          easypayName: verifiedPayment.easypayName ?? payment.easypayName,
          paymentDate: verifiedPayment.paymentDate ?? payment.paymentDate,
        });
        if (!matched) throw new Error("복구한 주문을 결제완료 상태로 저장하지 못했습니다.");
        console.warn(`[cafe24 webhook][paid] 주문접수 누락 주문을 Cafe24 원본으로 복구했습니다 (${orderId})`);
      } catch (error) {
        console.error("[cafe24 webhook][paid] 누락 주문 복구 실패", {
          orderId,
          message: error instanceof Error ? error.message : "unknown",
        });
        return NextResponse.json({ error: "paid_order_sync_failed" }, { status: 503 });
      }
    }

    let rewardResult: unknown = { outcome: "not_triggered" };
    if (getRewardSettings().issueTrigger === "paid") {
      try {
        rewardResult = await issueRewardForOrder(orderId, "paid");
      } catch (error) {
        rewardResult = { outcome: "failed" };
        console.error("[cafe24 reward] issue failed", {
          orderId,
          message: error instanceof Error ? error.message : "unknown",
        });
      }
    }

    const includeRewardResult = req.headers.get("x-mangotcg-reward-result") === "true";
    return NextResponse.json({
      ok: true,
      matched,
      ...(includeRewardResult ? { reward: rewardResult } : {}),
    });
  }

  if (event === "product_added") {
    const orderId = extractCafe24OrderId(payload);
    if (!orderId) {
      return NextResponse.json({ ok: true, warning: "order_id_not_found" });
    }

    try {
      // 90031 payload may only identify the changed order. Re-read the authoritative
      // order so existing local rows receive the new full item list and paid state.
      const cafe24Order = await getCafe24OrderForReward(orderId);
      if (cafe24Order.order_id !== orderId || cafe24Order.canceled === "T") {
        return NextResponse.json({ ok: true, matched: false, warning: "order_missing_or_cancelled" });
      }

      const normalized = normalizeCafe24Order({ order: cafe24Order });
      if (!normalized || normalized.externalOrderId !== orderId) {
        throw new Error("Cafe24 원본 주문의 필수 정보가 부족합니다.");
      }
      const items = cafe24Order.items ?? [];
      const quantity = items.reduce((total, item) => {
        const value = Number(item.quantity ?? 0);
        return total + (Number.isFinite(value) && value > 0 ? value : 0);
      }, 0) || normalized.quantity;
      const actualAmountRaw = cafe24Order.paid === "T"
        ? cafe24Order.payment_amount
        : cafe24Order.actual_order_amount?.total_amount_due
          ?? cafe24Order.actual_order_amount?.order_price_amount
          ?? cafe24Order.initial_order_amount?.payment_amount;
      const actualAmount = Number(actualAmountRaw);
      const itemAmount = items.reduce((total, item) => {
        const value = Number(item.payment_amount ?? 0);
        return total + (Number.isFinite(value) && value > 0 ? value : 0);
      }, 0);
      const unitPrice = itemAmount > 0
        ? Math.round(itemAmount / quantity)
        : Number.isFinite(actualAmount) && actualAmount > 0
          ? Math.round(actualAmount / quantity)
          : normalized.unitPrice;
      const orderInput = {
        externalOrderId: orderId,
        userId: normalized.userId,
        memberId: normalized.memberId,
        product: normalized.product,
        quantity,
        unitPrice,
        actualAmount: Number.isFinite(actualAmount) && actualAmount >= 0 ? Math.round(actualAmount) : null,
        youtubeNickname: normalized.youtubeNickname,
        paymentMethod: normalized.paymentMethod,
        paymentGatewayName: normalized.paymentGatewayName,
        easypayName: normalized.easypayName,
      };
      const matched = updateCafe24Order(orderInput);
      if (!matched) {
        insertOrder({ source: "cafe24", ...orderInput, paid: normalized.paid, paymentDate: normalized.paymentDate });
      }
      saveCafe24OrderIdentity(orderId, { memberId: normalized.memberId, buyerName: normalized.userId });
      if (normalized.paid) markOrderPaid(orderId, normalized);

      let reward: unknown = { outcome: "not_triggered" };
      if (normalized.paid && getRewardSettings().issueTrigger === "paid") {
        try {
          reward = await issueRewardForOrder(orderId, "paid");
        } catch (error) {
          reward = { outcome: "failed" };
          console.error("[cafe24 reward] product-added issue failed", {
            orderId,
            message: error instanceof Error ? error.message : "unknown",
          });
        }
      }
      return NextResponse.json({ ok: true, matched: true, updated: matched, paid: normalized.paid, reward });
    } catch (error) {
      console.error("[cafe24 webhook][product_added] 원본 주문 동기화 실패", {
        orderId,
        message: error instanceof Error ? error.message : "unknown",
      });
      return NextResponse.json({ error: "product_added_sync_failed" }, { status: 503 });
    }
  }

  if (event === "delivered") {
    const orderId = extractCafe24OrderId(payload);
    if (!orderId) {
      return NextResponse.json({ ok: true, warning: "order_id_not_found" });
    }
    if (getRewardSettings().issueTrigger === "delivered") {
      try {
        await issueRewardForOrder(orderId, "delivered");
      } catch (error) {
        console.error("[cafe24 reward] issue failed", {
          orderId,
          message: error instanceof Error ? error.message : "unknown",
        });
      }
    }
    return NextResponse.json({ ok: true });
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
    memberId: normalized.memberId,
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

  // 웹훅은 회원 ID를 생략할 수 있으므로, 카페24 구매자 조회값으로 보완해
  // 이후 주문랭킹이 이름이 아닌 같은 회원 계정 단위로 항상 합산되게 합니다.
  try {
    const buyer = await getCafe24OrderBuyerInfo(normalized.externalOrderId);
    saveCafe24OrderIdentity(normalized.externalOrderId, {
      memberId: buyer?.memberId ?? normalized.memberId,
      buyerName: buyer?.name ?? normalized.userId,
    });
  } catch {
    // 웹훅 수신 자체는 보존합니다. 다음 랭킹 조회 때 누락된 회원 ID를 다시 보완합니다.
  }

  // 카드결제는 주문 생성 이벤트 시점에 이미 결제완료(T)로 전달될 수 있다.
  // paid 이벤트만 기다리면 별도 결제완료 웹훅이 오지 않는 카드 주문은 영구적으로
  // 적립 대상에서 빠지므로, 카페24 원본 주문을 다시 검증한 뒤 동일한 지급 경로를 실행한다.
  if (normalized.paid && getRewardSettings().issueTrigger === "paid") {
    try {
      await issueRewardForOrder(normalized.externalOrderId, "paid");
    } catch (error) {
      console.error("[cafe24 reward] issue failed", {
        orderId: normalized.externalOrderId,
        message: error instanceof Error ? error.message : "unknown",
      });
    }
  }

  return NextResponse.json({ ok: true });
}
