import { NextRequest } from "next/server";
import { cardbreakEvents } from "@/lib/events";
import { getLiveState } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const send = () => {
        const state = getLiveState();
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(state)}\n\n`));
      };

      // 최초 접속 시 현재 상태를 바로 전송 (OBS를 껐다 켜도 즉시 최신 상태로 뜸)
      send();

      const onUpdate = () => send();
      cardbreakEvents.on("update", onUpdate);

      // 연결이 죽지 않도록 주기적으로 ping (프록시/방화벽의 idle timeout 방지)
      const heartbeat = setInterval(() => {
        controller.enqueue(encoder.encode(`: ping\n\n`));
      }, 25000);

      req.signal.addEventListener("abort", () => {
        cardbreakEvents.off("update", onUpdate);
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          // 이미 닫힌 경우 무시
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // nginx는 기본적으로 프록시 응답을 버퍼링해서 SSE 이벤트가 바로 전달되지 않고
      // 버퍼가 찰 때까지(혹은 연결 종료 시까지) 지연될 수 있습니다.
      // 이 헤더로 이 응답만큼은 nginx가 버퍼링하지 않도록 지정합니다.
      "X-Accel-Buffering": "no",
    },
  });
}
