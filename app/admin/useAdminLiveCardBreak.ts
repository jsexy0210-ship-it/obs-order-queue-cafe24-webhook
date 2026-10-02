"use client";

import { useEffect, useState } from "react";
import { DEFAULT_OVERLAY_SETTINGS } from "@/lib/overlaySettings";
import type { LiveOrder, LiveState } from "@/app/useLiveCardBreak";
import { DEVELOPMENT_HOME_SAMPLES_ENABLED, getDevelopmentHomeSamples } from "./developmentHomeSamples";

type AdminLiveState = LiveState & { completedToday: LiveOrder[]; manualOrders: LiveOrder[] };

const EMPTY_STATE: AdminLiveState = {
  loading: true,
  opening: null,
  completed: null,
  waiting: [],
  pendingPayments: [],
  cancelledOrders: [],
  hitCards: [],
  overlaySettings: DEFAULT_OVERLAY_SETTINGS,
  completedToday: [],
  manualOrders: [],
};

/** 로그인된 관리자 홈에서만 이름·등급을 포함한 주문 상태를 조회합니다. */
export function useAdminLiveCardBreak(): AdminLiveState {
  const [state, setState] = useState<AdminLiveState>(EMPTY_STATE);

  useEffect(() => {
    let cancelled = false;
    const refetch = () => {
      fetch("/api/orders", { cache: "no-store" })
        .then((response) => {
          if (!response.ok) throw new Error("관리자 주문 정보를 불러오지 못했습니다.");
          return response.json();
        })
        .then((data: Omit<AdminLiveState, "loading">) => {
          if (cancelled) return;
          const samples = DEVELOPMENT_HOME_SAMPLES_ENABLED ? getDevelopmentHomeSamples() : null;
          setState({
            ...data,
            ...(samples ?? {}),
            loading: false,
          });
        })
        .catch(() => {
          if (!cancelled) setState((current) => ({ ...current, loading: false }));
        });
    };

    refetch();
    const pollTimer = setInterval(refetch, 3000);

    return () => {
      cancelled = true;
      clearInterval(pollTimer);
    };
  }, []);

  return state;
}
