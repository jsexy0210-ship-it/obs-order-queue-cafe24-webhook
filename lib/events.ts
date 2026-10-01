import { EventEmitter } from "events";

declare global {
  var __cardbreakEmitter: EventEmitter | undefined;
}

export const cardbreakEvents = global.__cardbreakEmitter ?? new EventEmitter();

if (process.env.NODE_ENV !== "production") {
  global.__cardbreakEmitter = cardbreakEvents;
}

// 열려 있는 SSE 연결(오버레이 창, 관리자 화면 등)이 많을 수 있으므로 넉넉하게 설정
cardbreakEvents.setMaxListeners(50);

export function broadcastUpdate() {
  cardbreakEvents.emit("update");
}
