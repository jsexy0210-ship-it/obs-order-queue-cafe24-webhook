import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";

const appRoot = process.argv[2];
if (!appRoot || !path.isAbsolute(appRoot)) throw new Error("Invalid application root.");

function readEnvValue(name) {
  const contents = fs.readFileSync(path.join(appRoot, ".env.local"), "utf8");
  const line = contents.split(/\r?\n/).find((entry) => entry.startsWith(`${name}=`));
  if (!line) throw new Error(`Missing ${name} in runtime environment.`);
  const value = line.slice(name.length + 1).trim();
  return (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))
    ? value.slice(1, -1)
    : value;
}

const require = createRequire(path.join(appRoot, "package.json"));
const Database = require("better-sqlite3");
const databasePath = path.join(appRoot, "data", "cardbreak.db");
const db = new Database(databasePath, { fileMustExist: true });
db.pragma("busy_timeout = 5000");

function getCafe24Tokens() {
  const key = Buffer.from(readEnvValue("CAFE24_TOKEN_ENCRYPTION_KEY"), "base64");
  if (key.length !== 32) throw new Error("Invalid Cafe24 token encryption key.");
  const row = db.prepare("SELECT encrypted_value FROM cafe24_oauth_tokens WHERE id = 1").get();
  if (!row?.encrypted_value) throw new Error("Cafe24 OAuth connection is unavailable.");
  const encrypted = JSON.parse(row.encrypted_value);
  if (encrypted.version !== 1) throw new Error("Unsupported Cafe24 token format.");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(encrypted.iv, "base64"));
  decipher.setAuthTag(Buffer.from(encrypted.tag, "base64"));
  const tokens = JSON.parse(Buffer.concat([
    decipher.update(Buffer.from(encrypted.ciphertext, "base64")), decipher.final(),
  ]).toString("utf8"));
  if (Date.parse(tokens.accessTokenExpiresAt) <= Date.now() + 60_000) {
    throw new Error("Cafe24 access token is expiring; no database change was made.");
  }
  return tokens;
}

async function getCafe24Order(tokens, orderId) {
  const query = new URLSearchParams({ shop_no: String(tokens.shopNo || "1"), embed: "items" });
  const response = await fetch(
    `https://${tokens.mallId}.cafe24api.com/api/v2/admin/orders/${encodeURIComponent(orderId)}?${query}`,
    {
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
        "Content-Type": "application/json",
        "X-Cafe24-Api-Version": "2026-09-01",
      },
    }
  );
  if (!response.ok) throw new Error(`Cafe24 order verification failed (HTTP ${response.status}).`);
  const payload = await response.json();
  if (!payload.order) throw new Error("Cafe24 order verification returned no order.");
  return payload.order;
}

function paidOrderFacts(orderId, order, expectedAmount, expectedDate, expectedMethod) {
  const amount = Number(order.payment_amount);
  const paymentDate = order.payment_date ? new Date(order.payment_date) : null;
  const methods = Array.isArray(order.payment_method) ? order.payment_method : [order.payment_method];
  if (order.order_id !== orderId || order.paid !== "T" || order.canceled === "T"
    || amount !== expectedAmount || !paymentDate || paymentDate.getTime() !== Date.parse(expectedDate)
    || methods.filter(Boolean).map(String).join(",") !== expectedMethod) {
    throw new Error(`Cafe24 live order data for ${orderId} no longer matches the audited values.`);
  }
  return paymentDate.toISOString().slice(0, 19).replace("T", " ");
}

const targetIds = ["20260930-0000169", "20260930-0000152"];
const token = readEnvValue("CAFE24_WEBHOOK_TOKEN");
const port = 3001;
const cafe24Tokens = getCafe24Tokens();
const facts169 = paidOrderFacts(
  targetIds[0], await getCafe24Order(cafe24Tokens, targetIds[0]), 71500,
  "2026-09-30T13:58:45Z", "card"
);
const facts152 = paidOrderFacts(
  targetIds[1], await getCafe24Order(cafe24Tokens, targetIds[1]), 535256,
  "2026-09-30T15:02:39Z", "cash,point"
);
const selected = db.prepare(
  `SELECT external_order_id, source, status, actual_amount, paid_at, payment_method
     FROM orders WHERE external_order_id IN (?, ?)`
).all(...targetIds);
const byId = new Map(selected.map((row) => [row.external_order_id, row]));
const hiddenIds = new Set(db.prepare(
  `SELECT external_order_id FROM hidden_order_history WHERE external_order_id IN (?, ?)`
).all(...targetIds).map((row) => row.external_order_id));
if (selected.length !== 2 || selected.some((row) => row.source !== "cafe24")) {
  throw new Error("Expected Cafe24 order rows were not found; no changes were made.");
}

const order169 = byId.get(targetIds[0]);
const order152 = byId.get(targetIds[1]);
const alreadySynchronized = !hiddenIds.size
  && order152.actual_amount === 535256
  && order152.paid_at === facts152;
if (!alreadySynchronized) {
  if (!hiddenIds.has(targetIds[0]) || !hiddenIds.has(targetIds[1])) {
    throw new Error("The hidden-order state changed; no changes were made.");
  }
  if (order169.status !== "done" || order169.actual_amount !== 71500
    || order169.paid_at !== facts169) {
    throw new Error("Order 20260930-0000169 no longer matches the audited state; no changes were made.");
  }
  if (order152.status !== "done" || order152.actual_amount !== 855000 || order152.paid_at !== null
    || order152.payment_method !== "cash,point") {
    throw new Error("Order 20260930-0000152 no longer matches the audited state; no changes were made.");
  }

  const backupPath = `${databasePath}.before-order-sync-${Date.now()}.bak`;
  await db.backup(backupPath);
  db.transaction(() => {
    db.prepare(
      `UPDATE orders SET actual_amount = ?, paid_at = ?
       WHERE external_order_id = ? AND source = 'cafe24' AND actual_amount = ? AND paid_at IS NULL`
    ).run(535256, facts152, targetIds[1], 855000);
    db.prepare("DELETE FROM hidden_order_history WHERE external_order_id IN (?, ?)").run(...targetIds);
  })();
  console.log("order_sync_backup_created=true");
} else {
  console.log("order_sync_backup_created=false");
  console.log("order_sync_already_converged=true");
}

if (!db.prepare(
  "SELECT 1 FROM reward_ledger WHERE external_order_id = ? AND action = 'issue'"
).get(targetIds[1])) {
  const endpoint = `http://127.0.0.1:${port}/api/webhooks/cafe24?token=${encodeURIComponent(token)}&event=paid`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", "x-mangotcg-reward-result": "true" },
    body: JSON.stringify({
      order: {
        order_id: targetIds[1],
        paid: "T",
        payment_date: "2026-10-01T00:02:39+09:00",
        payment_method: ["cash", "point"],
      },
    }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) {
    throw new Error(`Paid-order reconciliation endpoint failed (HTTP ${response.status}).`);
  }
  console.log(`order_0152_reward_outcome=${payload.reward?.outcome || "not_reported"}`);
  if (payload.reward?.amount != null) console.log(`order_0152_reward_amount=${payload.reward.amount}`);
} else {
  console.log("order_0152_reward_attempt=skipped_existing_ledger");
}

const verification = db.prepare(
  `SELECT external_order_id, actual_amount, paid_at FROM orders WHERE external_order_id IN (?, ?)`
).all(...targetIds);
const remainingHidden = db.prepare(
  `SELECT COUNT(*) AS count FROM hidden_order_history WHERE external_order_id IN (?, ?)`
).get(...targetIds).count;
const reward = db.prepare(
  "SELECT amount, status FROM reward_ledger WHERE external_order_id = ? AND action = 'issue'"
).get(targetIds[1]);
console.log(`order_sync_hidden_remaining=${remainingHidden}`);
for (const row of verification) {
  console.log(`order_sync_verified=${row.external_order_id}|${row.actual_amount ?? "-"}|${row.paid_at ?? "-"}`);
}
console.log(`order_0152_reward_ledger=${reward ? `${reward.status}:${reward.amount}` : "none"}`);
db.close();
