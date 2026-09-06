"use client";

import { useEffect, useState } from "react";
import { DEFAULT_OVERLAY_SETTINGS, type OverlaySettings } from "@/lib/overlaySettings";

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
  paid_at: string | null;
  payment_method: string | null;
  payment_gateway_name: string | null;
  easypay_name: string | null;
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
  overlaySettings: OverlaySettings;
};

const EMPTY_STATE: LiveState = {
  opening: null,
  waiting: [],
  hitCards: [],
  overlaySettings: DEFAULT_OVERLAY_SETTINGS,
};

/**
 * /api/orders 로 초기 상태를 받아온 뒤 /api/stream(SSE)을 구독해서
 * 웹훅으로 새 주문이 들어오거나 관리자가 상태를 바꿀 때마다 자동으로 갱신됩니다.
 */
// SSE 연결이 (드물게) 끊긴 채로 재연결이 안 되는 경우를 대비한 안전장치.
// OBS 브라우저 소스는 몇 시간~며칠씩 켜져 있으므로, 이 주기로 강제 새로고침합니다.
const FALLBACK_POLL_MS = 30000;

export function useLiveCardBreak(): LiveState {
  const [state, setState] = useState<LiveState>(EMPTY_STATE);

  useEffect(() => {
    let cancelled = false;

    const refetch = () => {
      fetch("/api/orders")
        .then((res) => res.json())
        .then((data: LiveState) => {
          if (!cancelled) setState(data);
        })
        .catch(() => {
          // 실패해도 다음 폴링이나 SSE가 이어서 채워주므로 무시
        });
    };

    refetch();

    const source = new EventSource("/api/stream");

    source.onmessage = (event) => {
      try {
        setState(JSON.parse(event.data));
      } catch {
        // ping 등 JSON이 아닌 메시지는 무시
      }
    };

    // 자동 갱신 안전장치: SSE가 살아있어도 주기적으로 한 번 더 최신 상태를 받아옵니다.
    const pollTimer = setInterval(refetch, FALLBACK_POLL_MS);

    return () => {
      cancelled = true;
      source.close();
      clearInterval(pollTimer);
    };
  }, []);

  return state;
}
