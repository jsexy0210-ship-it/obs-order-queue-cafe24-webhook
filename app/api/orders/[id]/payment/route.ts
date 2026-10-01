import { NextResponse } from "next/server";
import {
  confirmCafe24ManualPayment,
  getCafe24OrderForReward,
  isCafe24OrderPaid,
} from "@/lib/cafe24Admin";
import { getCafe24OAuthStatus } from "@/lib/cafe24OAuth";
import { getOrderById, markOrderPaid } from "@/lib/store";

export const runtime = "nodejs";

type RouteParams = { params: Promise<{ id: string }> };

function paymentDetails(order: Awaited<ReturnType<typeof getCafe24OrderForReward>>) {
  return {
    paymentMethod: Array.isArray(order.payment_method)
      ? order.payment_method.join(", ")
      : order.payment_method ?? null,
    paymentDate: order.payment_date ?? null,
  };
}

export async function POST(_: Request, { params }: RouteParams) {
  const { id: idParam } = await params;
  const id = Number(idParam);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "올바른 주문을 찾을 수 없습니다." }, { status: 400 });
  }

  const localOrder = getOrderById(id);
  if (
    !localOrder ||
    localOrder.source !== "cafe24" ||
    localOrder.status !== "waiting" ||
    !localOrder.external_order_id
  ) {
    return NextResponse.json({ error: "무통장 입금 전 주문만 처리할 수 있습니다." }, { status: 409 });
  }

  const oauth = getCafe24OAuthStatus();
  const hasWriteOrderScope = oauth.scopes.some((scope) => scope === "mall.write_order" || scope === "write_order");
  if (!oauth.connected || !hasWriteOrderScope) {
    return NextResponse.json(
      { error: "카페24 주문 쓰기 권한이 필요합니다. 관리자 설정에서 카페24 재연결 후 다시 시도하세요." },
      { status: 403 }
    );
  }

  try {
    // 처리 전 원본을 읽어 이미 입금확인된 주문이면 카페24를 다시 변경하지 않습니다.
    const before = await getCafe24OrderForReward(localOrder.external_order_id);
    if (isCafe24OrderPaid(before)) {
      markOrderPaid(localOrder.external_order_id, paymentDetails(before));
      return NextResponse.json({ ok: true, alreadyPaid: true });
    }

    // 버튼 클릭은 은행 입금내역을 확인한 관리자의 명시적 승인입니다.
    await confirmCafe24ManualPayment(localOrder.external_order_id);

    // 카페24의 최종 상태가 입금확인으로 바뀐 사실을 다시 확인한 뒤에만 로컬 대기열로 이동합니다.
    const after = await getCafe24OrderForReward(localOrder.external_order_id);
    if (!isCafe24OrderPaid(after)) {
      return NextResponse.json(
        { error: "카페24 입금확인 상태를 검증하지 못했습니다. 대기 주문으로 이동하지 않았습니다." },
        { status: 502 }
      );
    }

    markOrderPaid(localOrder.external_order_id, paymentDetails(after));
    return NextResponse.json({ ok: true, alreadyPaid: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : "카페24 입금확인 처리에 실패했습니다.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
