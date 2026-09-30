import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const [releaseRoot, cutoffKst] = process.argv.slice(2);
if (!releaseRoot || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(cutoffKst ?? "")) {
  throw new Error("Invalid nickname backfill target.");
}

function readEnvValue(name) {
  const contents = fs.readFileSync(path.join(releaseRoot, ".env.local"), "utf8");
  const line = contents.split(/\r?\n/).find((entry) => entry.startsWith(`${name}=`));
  if (!line) throw new Error(`Missing ${name} in runtime environment.`);
  let value = line.slice(name.length + 1).trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  return value;
}

function sqliteUtc(value) {
  return value.toISOString().slice(0, 19).replace("T", " ");
}

function parseNickname(raw) {
  if (typeof raw !== "string") return null;
  for (const line of raw.split(/\r?\n/)) {
    const separator = line.indexOf("=");
    if (separator < 0) continue;
    const label = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if ((label.includes("유튜브") || label.toLowerCase().includes("youtube")) && value) return value;
  }
  return null;
}

const require = createRequire(path.join(releaseRoot, "package.json"));
const Database = require("better-sqlite3");
const db = new Database(path.join(releaseRoot, "data", "cardbreak.db"), { fileMustExist: true });
db.pragma("busy_timeout = 5000");

try {
  const key = Buffer.from(readEnvValue("CAFE24_TOKEN_ENCRYPTION_KEY"), "base64");
  if (key.length !== 32) throw new Error("Invalid Cafe24 encryption key.");
  const tokenRow = db.prepare("SELECT encrypted_value FROM cafe24_oauth_tokens WHERE id = 1").get();
  if (!tokenRow?.encrypted_value) throw new Error("Cafe24 OAuth connection is unavailable.");
  const encrypted = JSON.parse(tokenRow.encrypted_value);
  if (encrypted.version !== 1) throw new Error("Unsupported Cafe24 token format.");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(encrypted.iv, "base64"));
  decipher.setAuthTag(Buffer.from(encrypted.tag, "base64"));
  const tokens = JSON.parse(Buffer.concat([
    decipher.update(Buffer.from(encrypted.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8"));
  if (Date.parse(tokens.accessTokenExpiresAt) <= Date.now() + 5 * 60 * 1000) {
    throw new Error("Cafe24 access token is expiring; no database change was made.");
  }

  const targetKstMs = new Date(`${cutoffKst.replace(" ", "T")}:00+09:00`).getTime();
  if (!Number.isFinite(targetKstMs)) throw new Error("Invalid target order time.");
  const cutoff = sqliteUtc(new Date(targetKstMs));
  const candidates = db.prepare(`
    SELECT id, external_order_id, created_at, product, quantity, unit_price, actual_amount, youtube_nickname
    FROM orders
    WHERE source = 'cafe24' AND external_order_id IS NOT NULL
      AND created_at >= ?
      AND (youtube_nickname IS NULL OR trim(youtube_nickname) = '')
    ORDER BY created_at ASC
  `).all(cutoff);

  const sourceHasNickname = [];
  const missingInCafe24 = [];
  for (const candidate of candidates) {
    const query = new URLSearchParams({ shop_no: String(tokens.shopNo || "1"), embed: "items" });
    const response = await fetch(`https://${tokens.mallId}.cafe24api.com/api/v2/admin/orders/${encodeURIComponent(candidate.external_order_id)}?${query}`, {
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
        "Content-Type": "application/json",
        "X-Cafe24-Api-Version": "2026-09-01",
      },
    });
    if (!response.ok) throw new Error(`Cafe24 order verification failed with HTTP ${response.status}.`);
    const order = (await response.json()).order;
    if (!order) continue;
    const orderTime = Date.parse(order.order_date ?? "");
    if (!Number.isFinite(orderTime) || orderTime < targetKstMs) continue;
    const nickname = parseNickname(order.additional_order_info_list);
    if (nickname) sourceHasNickname.push({ id: candidate.id, externalOrderId: candidate.external_order_id, nickname });
    else missingInCafe24.push(candidate.external_order_id);
  }

  const update = db.transaction(() => {
    const statement = db.prepare(`
        UPDATE orders SET youtube_nickname = ?
        WHERE id = ? AND external_order_id = ? AND (youtube_nickname IS NULL OR trim(youtube_nickname) = '')
      `);
    for (const row of sourceHasNickname) {
      const result = statement.run(row.nickname, row.id, row.externalOrderId);
      if (result.changes !== 1) throw new Error("A candidate order changed before update; transaction was rolled back.");
    }
  });
  if (sourceHasNickname.length) update.immediate();
  const savedCount = sourceHasNickname.filter((row) => {
    const saved = db.prepare("SELECT youtube_nickname FROM orders WHERE id = ?").get(row.id);
    return saved?.youtube_nickname === row.nickname;
  }).length;
  if (savedCount !== sourceHasNickname.length) throw new Error("Nickname update verification failed.");
  console.log(`nickname_backfill=complete candidates=${candidates.length} cafe24_values=${sourceHasNickname.length} db_updates=${savedCount} cafe24_missing_values=${missingInCafe24.length}`);
  if (missingInCafe24.length) console.log(`orders_without_cafe24_nickname=${missingInCafe24.join(",")}`);
} finally {
  db.close();
}
