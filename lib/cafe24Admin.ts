import { getValidCafe24AccessToken } from "./cafe24OAuth";

const API_VERSION = "2026-09-01";

type Cafe24Error = { error?: { message?: string; code?: string | number } };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await getValidCafe24AccessToken();
  const response = await fetch(`https://${token.mallId}.cafe24api.com/api/v2/admin${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token.accessToken}`,
      "Content-Type": "application/json",
      "X-Cafe24-Api-Version": API_VERSION,
      ...init?.headers,
    },
    cache: "no-store",
  });
  const body = await response.json().catch(() => null) as (T & Cafe24Error) | null;
  if (!response.ok || !body) {
    const message = body?.error?.message ?? `HTTP ${response.status}`;
    throw new Error(`카페24 API 요청 실패: ${message}`);
  }
  return body;
}

export type Cafe24CustomerGroup = {
  group_no: number | string;
  group_name: string;
  buy_benefits?: string;
};

export type Cafe24CustomerGroupDetail = Cafe24CustomerGroup & {
  points_information?: Record<string, string | number | null>;
  mobile_points_information?: Record<string, string | number | null>;
};

export async function getCafe24CustomerGroups() {
  const token = await getValidCafe24AccessToken();
  const query = new URLSearchParams({ shop_no: token.shopNo || "1" });
  const response = await request<{ customergroups?: Cafe24CustomerGroup[] }>(`/customergroups?${query}`);
  return response.customergroups ?? [];
}

/**
 * `buy_benefits=M/P`인 등급은 실제 적립률도 함께 확인해야 합니다.
 * 카페24에는 적립 혜택 유형만 M으로 남기고 적립률을 0으로 둔 등급이 있을 수 있어,
 * 유형 코드만 보고 망고TCG 지급을 차단하면 해당 등급은 영구적으로 지급되지 않습니다.
 */
export async function getCafe24CustomerGroup(groupNo: string | number) {
  const token = await getValidCafe24AccessToken();
  const query = new URLSearchParams({ shop_no: token.shopNo || "1" });
  const response = await request<{ customergroup?: Cafe24CustomerGroupDetail }>(
    `/customergroups/${encodeURIComponent(String(groupNo))}?${query}`
  );
  return response.customergroup ?? null;
}

export async function getCafe24OrderBuyerInfo(orderId: string) {
  const token = await getValidCafe24AccessToken();
  const query = new URLSearchParams({ shop_no: token.shopNo || "1" });
  const response = await request<{ buyer?: { name?: string; member_id?: string } }>(
    `/orders/${encodeURIComponent(orderId)}/buyer?${query}`
  );
  if (!response.buyer) return null;
  return {
    name: response.buyer.name?.trim() || null,
    memberId: response.buyer.member_id?.trim() || null,
  };
}

export async function getCafe24CurrentCustomerGroupNo(memberId: string): Promise<string | null> {
  const token = await getValidCafe24AccessToken();
  const query = new URLSearchParams({ shop_no: token.shopNo || "1", member_id: memberId });
  const response = await request<{ customers?: Array<{ member_id: string; group_no: string | number }> }>(
    `/customers?${query}`
  );
  const customer = response.customers?.find((item) => item.member_id === memberId);
  return customer?.group_no == null ? null : String(customer.group_no);
}

/** 적립금 지급·회수 직후 대시보드 잔액을 갱신하기 위한 회원 현재 적립금 조회입니다. */
export async function getCafe24CustomerPointBalance(memberId: string) {
  const token = await getValidCafe24AccessToken();
  // /customers의 total_points는 회원의 현재 사용가능 적립금이 아닐 수 있습니다.
  // 지급/회수 후 표시할 잔액은 적립금 API가 제공하는 available_points_total을 사용합니다.
  // 카페24 적립금 조회 API는 조회 기간을 90일 이내로 요구합니다.
  const end = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const start = new Date(end.getTime() - 89 * 24 * 60 * 60 * 1000);
  const query = new URLSearchParams({
    shop_no: token.shopNo || "1",
    member_id: memberId,
    start_date: start.toISOString().slice(0, 10),
    end_date: end.toISOString().slice(0, 10),
  });
  const response = await request<{
    points?: Array<{
      available_points_total?: string | number;
    }>;
  }>(`/points?${query}`);
  const latestBalance = response.points
    ?.map((point) => Number(point.available_points_total))
    .find((balance) => Number.isFinite(balance) && balance >= 0);
  if (latestBalance === undefined) {
    throw new Error("카페24 회원의 현재 적립금을 확인할 수 없습니다.");
  }
  return {
    memberId,
    balance: Math.floor(latestBalance),
  };
}

export async function updateCafe24CustomerGroupName(groupNo: string, groupName: string) {
  const token = await getValidCafe24AccessToken();
  const query = new URLSearchParams({ shop_no: token.shopNo || "1" });
  await request(`/customergroups/${encodeURIComponent(groupNo)}?${query}`, {
    method: "PUT",
    body: JSON.stringify({ group_name: groupName }),
  });
}

/** 망고TCG 적립 정책과 카페24 회원등급 자동변경 기준을 같은 시점으로 맞춥니다. */
export async function updateCafe24CustomerGroupAutoUpdateSettings(input: {
  issueTrigger: "paid" | "delivered";
  deductCancellationRefund: boolean;
}) {
  const token = await getValidCafe24AccessToken();
  const query = new URLSearchParams({ shop_no: token.shopNo || "1" });
  const current = await request<{ customergroup?: Record<string, unknown> }>(
    `/customergroups/setting?${query}`
  );
  if (!current.customergroup) {
    throw new Error("카페24 회원등급 자동변경 설정을 찾을 수 없습니다.");
  }
  await request(`/customergroups/setting?${query}`, {
    method: "PUT",
    body: JSON.stringify({
      ...current.customergroup,
      shop_no: Number(token.shopNo || "1"),
      auto_update: "T",
      use_auto_update: "T",
      customer_tier_criteria: "purchase_amount",
      standard_purchase_amount: "total_paid_amount",
      auto_update_criteria: input.issueTrigger === "paid" ? "payment_complete" : "delivery_complete",
      deduct_cancellation_refund: input.deductCancellationRefund ? "T" : "F",
    }),
  });
}

export type Cafe24OrderItem = {
  product_name?: string;
  payment_amount?: string | number;
  quantity?: string | number;
  order_status?: string;
  status_code?: string;
};

export type Cafe24RewardOrder = {
  order_id?: string;
  billing_name?: string;
  canceled?: string;
  cancel_date?: string | null;
  actual_order_amount?: { order_price_amount?: string | number };
  initial_order_amount?: { payment_amount?: string | number };
  additional_order_info_list?: unknown;
  member_id?: string;
  member_group_no?: string | number;
  group_no?: string | number;
  order_date?: string | null;
  payment_date?: string | null;
  paid?: string | boolean | number;
  payment_confirmation?: string | boolean | number;
  payment_method?: string | string[];
  payment_amount?: string | number;
  items?: Cafe24OrderItem[];
};

export async function listCafe24Orders(startDate: string, endDate: string): Promise<Cafe24RewardOrder[]> {
  const token = await getValidCafe24AccessToken();
  const orders: Cafe24RewardOrder[] = [];
  for (let offset = 0; offset <= 15_000; offset += 100) {
    const query = new URLSearchParams({
      shop_no: token.shopNo || "1", start_date: startDate, end_date: endDate,
      limit: "100", offset: String(offset),
    });
    const page = await request<{ orders?: Cafe24RewardOrder[] }>(`/orders?${query}`);
    const rows = page.orders ?? [];
    orders.push(...rows);
    if (rows.length < 100) return orders;
  }
  throw new Error("카페24 주문 조회 범위가 페이지 제한을 초과했습니다.");
}

/** 주문 원본을 다시 조회해 웹훅의 축약 payload에 의존하지 않습니다. */
export async function getCafe24OrderForReward(
  orderId: string,
  options: { includeBuyerGroup?: boolean } = {}
): Promise<Cafe24RewardOrder> {
  const token = await getValidCafe24AccessToken();
  const query = new URLSearchParams({ shop_no: token.shopNo || "1", embed: "items" });
  const response = await request<{ order?: Cafe24RewardOrder }>(
    `/orders/${encodeURIComponent(orderId)}?${query}`
  );
  if (!response.order) throw new Error("카페24 주문 상세를 찾을 수 없습니다.");
  if (options.includeBuyerGroup && !response.order.member_group_no && !response.order.group_no) {
    const buyer = await request<{ buyer?: { member_id?: string; member_group_no?: string | number } }>(
      `/orders/${encodeURIComponent(orderId)}/buyer?shop_no=${encodeURIComponent(token.shopNo || "1")}`
    );
    if (buyer.buyer) {
      if (response.order.member_id && buyer.buyer.member_id && response.order.member_id !== buyer.buyer.member_id) {
        throw new Error("카페24 주문과 구매자 정보의 회원 ID가 일치하지 않습니다.");
      }
      response.order.member_id = response.order.member_id || buyer.buyer.member_id;
      response.order.member_group_no = buyer.buyer.member_group_no;
    }
  }
  return response.order;
}

export async function changeCafe24Points(input: {
  memberId: string;
  orderId: string;
  amount: number;
  type: "increase" | "decrease";
  reason: string;
}) {
  if (!input.memberId.trim() || !input.orderId.trim() || !Number.isInteger(input.amount) || input.amount <= 0) {
    throw new Error("카페24 적립금 변경 요청값이 올바르지 않습니다.");
  }
  const token = await getValidCafe24AccessToken();
  await request("/points", {
    method: "POST",
    body: JSON.stringify({
      request: {
        shop_no: Number(token.shopNo || "1"),
        member_id: input.memberId,
        order_id: input.orderId,
        amount: input.amount,
        type: input.type,
        reason: input.reason,
      },
    }),
  });
}
