import type { LiveState, OrderRow } from "./store";

function displayNickname(value: string | null, tier: string) {
  let nickname = value?.trim() ?? "";
  const normalizedTier = tier.trim();
  if (normalizedTier && nickname.slice(0, normalizedTier.length).toLocaleLowerCase()
      === normalizedTier.toLocaleLowerCase()
      && /[\s:|·-]/.test(nickname[normalizedTier.length] ?? "")) {
    nickname = nickname.slice(normalizedTier.length).replace(/^[\s:|·-]+/, "");
  }

  while (/\([^()]*\)/.test(nickname)) nickname = nickname.replace(/\([^()]*\)/g, " ");
  nickname = nickname.replace(/[()]/g, "").replace(/\s+/g, " ").trim();
  return nickname || "-";
}

function scrubOrder<T extends OrderRow>(order: T): T {
  return {
    ...order,
    user_id: "",
    member_id: null,
    tier: "",
    youtube_nickname: displayNickname(order.youtube_nickname, order.tier),
  };
}

export function sanitizeLiveOverlayState(state: LiveState): LiveState {
  return {
    ...state,
    opening: state.opening ? scrubOrder(state.opening) : null,
    completed: state.completed ? scrubOrder(state.completed) : null,
    waiting: state.waiting.map(scrubOrder),
    pendingPayments: state.pendingPayments.map(scrubOrder),
    cancelledOrders: state.cancelledOrders.map(scrubOrder),
    hitCards: state.hitCards.map((item) => ({
      ...item,
      user_id: "",
      youtube_nickname: displayNickname(item.youtube_nickname, ""),
    })),
  };
}
