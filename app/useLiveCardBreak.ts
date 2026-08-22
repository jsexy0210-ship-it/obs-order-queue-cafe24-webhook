"use client";

import { useEffect, useState } from "react";

export type OrderStatus = "waiting" | "opening" | "done" | "cancelled";

export type LiveOrder = {
  id: number;
  source: string;
  external_order_id: string | null;
  user_id: string;
  product: string;
  quantity: number;
  unit_price: number;
  tier: string;
  status: OrderStatus;
  prev_status: string | null;
  cancel_reason: string | null;
  cancelled_at: string | null;
  started_at: string | null;
  timer_seconds: number | null;
  youtube_nickname: string | null;
  created_at: string;
};

export type LiveHitCard = {
  id: number;
  user_id: string;
  card: string;
  youtube_nickname: string | null;
  created_at: string;
};

export type LiveState = {
  opening: LiveOrder | null;
  waiting: LiveOrder[];
  hitCards: LiveHitCard[];
};

const EMPTY_STATE: LiveState = { opening: null, waiting: [], hitCards: [] };

/**
 * /api/orders 로 초기 상태를 받아온 뒤 /api/stream(SSE)을 구독해서
 * 웹훅으로 새 주문이 들어오거나 관리자가 상태를 바꿀 때마다 자동으로 갱신됩니다.
 */
export function useLiveCardBreak(): LiveState {
  const [state, setState] = useState<LiveState>(EMPTY_STATE);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/orders")
      .then((res) => res.json())
      .then((data: LiveState) => {
        if (!cancelled) setState(data);
      })
      .catch(() => {
        // 최초 fetch 실패는 SSE 연결이 이어서 상태를 채워주므로 무시
      });

    const source = new EventSource("/api/stream");

    source.onmessage = (event) => {
      try {
        setState(JSON.parse(event.data));
      } catch {
        // ping 등 JSON이 아닌 메시지는 무시
      }
    };

    return () => {
      cancelled = true;
      source.close();
    };
  }, []);

  return state;
}
