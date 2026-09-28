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

export type Cafe24CustomerGroup = { group_no: number | string; group_name: string };

export async function getCafe24CustomerGroups() {
  const token = await getValidCafe24AccessToken();
  const query = new URLSearchParams({ shop_no: token.shopNo || "1" });
  const response = await request<{ customergroups?: Cafe24CustomerGroup[] }>(`/customergroups?${query}`);
  return response.customergroups ?? [];
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
  payment_amount?: string | number;
  quantity?: string | number;
  order_status?: string;
  status_code?: string;
};

export type Cafe24RewardOrder = {
  member_id?: string;
  member_group_no?: string | number;
  group_no?: string | number;
  payment_method?: string;
  items?: Cafe24OrderItem[];
};

/** 주문 원본을 다시 조회해 웹훅의 축약 payload에 의존하지 않습니다. */
export async function getCafe24OrderForReward(orderId: string): Promise<Cafe24RewardOrder> {
  const token = await getValidCafe24AccessToken();
  const query = new URLSearchParams({ shop_no: token.shopNo || "1", embed: "items" });
  const response = await request<{ order?: Cafe24RewardOrder }>(
    `/orders/${encodeURIComponent(orderId)}?${query}`
  );
  if (!response.order) throw new Error("카페24 주문 상세를 찾을 수 없습니다.");
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
