import { db } from "./db";
import {
  DEFAULT_REWARD_SETTINGS,
  normalizeRewardSettings,
  type RewardSettings,
} from "./rewardSettings";

export function getRewardSettings(): RewardSettings {
  const row = db.prepare("SELECT value FROM reward_settings WHERE id = 1").get() as
    | { value: string }
    | undefined;

  if (!row) return DEFAULT_REWARD_SETTINGS;

  try {
    return normalizeRewardSettings(JSON.parse(row.value));
  } catch {
    return DEFAULT_REWARD_SETTINGS;
  }
}

export function saveRewardSettings(value: unknown): RewardSettings {
  const settings = normalizeRewardSettings(value);
  db.prepare(
    `INSERT INTO reward_settings (id, value, updated_at) VALUES (1, ?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
  ).run(JSON.stringify(settings));
  return settings;
}
