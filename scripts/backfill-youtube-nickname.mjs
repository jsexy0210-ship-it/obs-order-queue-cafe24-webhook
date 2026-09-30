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
  const isYoutubeLabel = (value) => typeof value === "string"
    && (value.includes("유튜브") || value.toLowerCase().includes("youtube"));
  if (typeof raw === "string") {
    for (const line of raw.split(/\r?\n/)) {
      const separator = line.indexOf("=");
      if (separator < 0) continue;
      const label = line.slice(0, separator).trim();
      const value = line.slice(separator + 1).trim();
      if (isYoutubeLabel(label) && value) return value;
    }
    try {
      const parsed = JSON.parse(raw);
      if (parsed !== raw) return parseNickname(parsed);
    } catch {
      return null;
    }
    return null;
  }
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const found = parseNickname(item);
      if (found) return found;
    }
  } else if (raw && typeof raw === "object") {
    const entries = Object.entries(raw);
    const label = entries.find(([key]) => /(?:label|name|title|field|key)/i.test(key))?.[1];
    const value = entries.find(([key]) => /(?:value|answer|content|text)/i.test(key))?.[1];
    if (isYoutubeLabel(label) && (typeof value === "string" || typeof value === "number")) {
      return String(value).trim() || null;
    }
    for (const [key, nested] of entries) {
      if (isYoutubeLabel(key) && (typeof nested === "string" || typeof nested === "number")) {
        return String(nested).trim() || null;
      }
      const found = parseNickname(nested);
      if (found) return found;
    }
  }
  return null;
}

function describeAdditionalInfo(raw) {
  const labels = new Set();
  const visit = (value) => {
    if (typeof value === "string") {
      for (const line of value.split(/\r?\n/)) {
        const separator = line.indexOf("=");
        if (separator > 0) labels.add(line.slice(0, separator).trim());
      }
      try {
        const parsed = JSON.parse(value);
        if (parsed !== value) visit(parsed);
      } catch {}
    } else if (Array.isArray(value)) {
      value.forEach(visit);
    } else if (value && typeof value === "object") {
      for (const [key, nested] of Object.entries(value)) {
        if (/(?:^|_)(?:label|name|title|field|key)$/i.test(key) && typeof nested === "string") labels.add(nested);
        if (/(?:유튜브|youtube)/i.test(key)) labels.add(key);
        visit(nested);
      }
    }
  };
  visit(raw);
  return `${raw == null ? "missing" : Array.isArray(raw) ? "array" : typeof raw}[${[...labels].join("|")}]`;
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
  const targetDay = cutoffKst.slice(0, 10);
  async function cafe24(pathname) {
    const url = new URL(`https://${tokens.mallId}.cafe24api.com/api/v2/admin${pathname}`);
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
        "Content-Type": "application/json",
        "X-Cafe24-Api-Version": "2026-09-01",
      },
    });
    if (!response.ok) throw new Error(`Cafe24 order verification failed with HTTP ${response.status}.`);
    return response.json();
  }

  const remoteOrders = [];
  for (let offset = 0; offset <= 15000; offset += 100) {
    const query = new URLSearchParams({
      shop_no: String(tokens.shopNo || "1"),
      start_date: targetDay,
      end_date: targetDay,
      limit: "100",
      offset: String(offset),
    });
    const page = await cafe24(`/orders?${query}`);
    const rows = Array.isArray(page.orders) ? page.orders : [];
    remoteOrders.push(...rows);
    if (rows.length < 100) break;
  }

  const candidates = remoteOrders.filter((order) => {
    const orderTime = Date.parse(order.order_date ?? "");
    return order.order_id && Number.isFinite(orderTime) && orderTime >= targetKstMs;
  });
  const sourceHasNickname = [];
  const missingInCafe24 = [];
  const orderStatuses = [];
  for (const listedOrder of candidates) {
    const local = db.prepare(`
      SELECT id, youtube_nickname FROM orders WHERE external_order_id = ? AND source = 'cafe24'
    `).get(listedOrder.order_id);
    const detailQuery = new URLSearchParams({ shop_no: String(tokens.shopNo || "1"), embed: "items" });
    const detail = await cafe24(`/orders/${encodeURIComponent(listedOrder.order_id)}?${detailQuery}`);
    const order = detail.order;
    const nickname = parseNickname(order?.additional_order_info_list)
      || parseNickname(listedOrder.additional_order_info_list);
    if (!nickname) {
      missingInCafe24.push(listedOrder.order_id);
      const fieldShape = describeAdditionalInfo(order?.additional_order_info_list ?? listedOrder.additional_order_info_list);
      orderStatuses.push(`${listedOrder.order_id}:cafe24_value_missing,local_row=${local ? "present" : "absent"},additional_info=${fieldShape}`);
      continue;
    }
    if (!local) {
      orderStatuses.push(`${listedOrder.order_id}:cafe24_value_present,local_row=absent`);
      continue;
    }
    if (local.youtube_nickname?.trim()) {
      orderStatuses.push(`${listedOrder.order_id}:already_stored`);
      continue;
    }
    sourceHasNickname.push({ id: local.id, externalOrderId: listedOrder.order_id, nickname });
    orderStatuses.push(`${listedOrder.order_id}:cafe24_value_present,local_row=present,updated=true`);
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
  console.log(`nickname_backfill=complete cafe24_orders_after_cutoff=${candidates.length} cafe24_values_missing=${missingInCafe24.length} db_updates=${savedCount}`);
  for (const status of orderStatuses) console.log(`order=${status}`);
} finally {
  db.close();
}
