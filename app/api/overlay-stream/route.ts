import { NextRequest } from "next/server";
import { cardbreakEvents } from "@/lib/events";
import { resolveLiveBuyerNames } from "@/lib/buyerNames";
import { sanitizeLiveOverlayState } from "@/lib/liveOverlayPrivacy";
import { getLiveState } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      let sequence = 0;
      const send = () => {
        const current = ++sequence;
        void resolveLiveBuyerNames(getLiveState()).then((state) => {
          if (!req.signal.aborted && current === sequence) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(sanitizeLiveOverlayState(state))}\n\n`));
          }
        });
      };

      send();
      cardbreakEvents.on("update", send);
      const heartbeat = setInterval(() => controller.enqueue(encoder.encode(": ping\n\n")), 25000);
      req.signal.addEventListener("abort", () => {
        cardbreakEvents.off("update", send);
        clearInterval(heartbeat);
        try { controller.close(); } catch { /* already closed */ }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
