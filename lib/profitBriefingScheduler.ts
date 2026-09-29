import { generateDueProfitBriefings } from "./profitBriefings";

const CHECK_INTERVAL_MS = 30_000;
let running = false;

declare global {
  // eslint-disable-next-line no-var
  var __profitBriefingSchedulerStarted: boolean | undefined;
}

async function run() {
  if (running) return;
  running = true;
  try {
    const generated = await generateDueProfitBriefings();
    if (generated.length > 0) {
      console.info(`[profit-briefing] generated ${generated.join(", ")}`);
    }
  } catch (error) {
    console.error("[profit-briefing] generation failed", error instanceof Error ? error.message : error);
  } finally {
    running = false;
  }
}

export function startProfitBriefingScheduler() {
  if (global.__profitBriefingSchedulerStarted) return;
  global.__profitBriefingSchedulerStarted = true;
  void run();
  const timer = setInterval(() => void run(), CHECK_INTERVAL_MS);
  timer.unref();
}
