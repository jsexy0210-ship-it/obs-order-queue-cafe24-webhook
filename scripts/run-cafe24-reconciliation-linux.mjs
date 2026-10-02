import fs from "node:fs";
import path from "node:path";

const appRoot = process.argv[2];
if (!appRoot || !path.isAbsolute(appRoot)) throw new Error("Invalid application root.");

const environment = fs.readFileSync(path.join(appRoot, ".env.local"), "utf8");
const tokenLine = environment.split(/\r?\n/).find((line) => line.startsWith("CAFE24_WEBHOOK_TOKEN="));
const rawToken = tokenLine?.slice("CAFE24_WEBHOOK_TOKEN=".length).trim();
const token = rawToken && (
  (rawToken.startsWith('"') && rawToken.endsWith('"'))
  || (rawToken.startsWith("'") && rawToken.endsWith("'"))
) ? rawToken.slice(1, -1) : rawToken;
if (!token) throw new Error("Missing Cafe24 reconciliation credentials.");

const response = await fetch("http://127.0.0.1:3001/api/internal/cafe24-reconcile", {
  method: "POST",
  headers: { "x-mango-reconciliation-token": token },
});
const payload = await response.json().catch(() => null);
if (!response.ok || !payload?.result) throw new Error(`Cafe24 reconciliation failed (HTTP ${response.status}).`);

const result = payload.result;
console.log(
  `cafe24_reconciliation=complete range=${result.rangeStart}:${result.rangeEnd}`
  + ` checked=${result.checkedCount} inserted=${result.insertedCount} updated=${result.updatedCount}`
  + ` cancelled=${result.cancelledCount} hidden=${result.skippedHiddenCount}`
  + ` conflicts=${result.skippedConflictCount} failed=${result.failedCount}`
);
