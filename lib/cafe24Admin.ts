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

export async function getCafe24CustomerGroups() {
  const token = await getValidCafe24AccessToken();
  const query = new URLSearchParams({ shop_no: token.shopNo || "1" });
  const response = await request<{ customergroups?: Cafe24CustomerGroup[] }>(`/customergroups?${query}`);
  return response.customergroups ?? [];
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

export async function updateCafe24CustomerGroupName(groupNo: string, groupName: string) {
  const token = await getValidCafe24AccessToken();
  const query = new URLSearchParams({ shop_no: token.shopNo || "1" });
  await request(`/customergroups/${encodeURIComponent(groupNo)}?${query}`, {
    method: "PUT",
    body: JSON.stringify({ group_name: groupName }),
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
  additional_order_info_list?: string | null;
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
  const token = await getValidCafe24AccessToken();
  await request("/points", {
    method: "POST",
    body: JSON.stringify({
      shop_no: Number(token.shopNo || "1"),
      member_id: input.memberId,
      order_id: input.orderId,
      amount: input.amount,
      type: input.type,
      reason: input.reason,
    }),
  });
}
