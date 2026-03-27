import { createHmac } from "node:crypto";

/**
 * Validate Telegram Mini App initData.
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
export function validateTelegramInitData(
  initData: string,
  botToken: string,
): { valid: boolean; user?: TelegramUser } {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return { valid: false };

  // Remove hash from params and sort alphabetically
  params.delete("hash");
  const dataCheckString = Array.from(params.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, val]) => `${key}=${val}`)
    .join("\n");

  // HMAC-SHA256 with "WebAppData" as key prefix
  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  const computedHash = createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  if (computedHash !== hash) return { valid: false };

  // Parse user data
  const userStr = params.get("user");
  if (!userStr) return { valid: true };

  try {
    const user = JSON.parse(userStr) as TelegramUser;
    return { valid: true, user };
  } catch {
    return { valid: false };
  }
}

export interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

/** Allowed Telegram user IDs (loaded from env) */
export function getAllowedUsers(): Set<string> {
  const raw = process.env.ALLOWED_TELEGRAM_USERS || "";
  return new Set(raw.split(",").map((s) => s.trim()).filter(Boolean));
}
