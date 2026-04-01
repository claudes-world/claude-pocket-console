import { createHash, createHmac, randomBytes } from "node:crypto";

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

/**
 * Validate Telegram Login Widget data.
 * https://core.telegram.org/widgets/login#checking-authorization
 */
export function validateTelegramLoginWidget(
  data: Record<string, string>,
  botToken: string,
): { valid: boolean; user?: TelegramUser } {
  const { hash, ...rest } = data;
  if (!hash) return { valid: false };

  // Login Widget uses SHA256(botToken) as secret key (different from mini app!)
  const secretKey = createHash("sha256").update(botToken).digest();
  const dataCheckString = Object.keys(rest)
    .sort()
    .map((key) => `${key}=${rest[key]}`)
    .join("\n");
  const computedHash = createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  if (computedHash !== hash) return { valid: false };

  // Check auth_date is within 24 hours
  const authDate = parseInt(rest.auth_date || "0");
  if (Date.now() / 1000 - authDate > 86400) return { valid: false };

  return {
    valid: true,
    user: {
      id: parseInt(rest.id),
      first_name: rest.first_name,
      last_name: rest.last_name,
      username: rest.username,
      language_code: undefined,
    },
  };
}

// Simple in-memory session store (sufficient for single-user app)
const sessions = new Map<string, { user: TelegramUser; expires: number }>();

export function createSession(user: TelegramUser): string {
  const token = randomBytes(32).toString("hex");
  sessions.set(token, { user, expires: Date.now() + 48 * 60 * 60 * 1000 }); // 48 hours
  return token;
}

export function validateSession(token: string): { valid: boolean; user?: TelegramUser } {
  const session = sessions.get(token);
  if (!session) return { valid: false };
  if (Date.now() > session.expires) {
    sessions.delete(token);
    return { valid: false };
  }
  return { valid: true, user: session.user };
}

/** Full auth check: validate initData + check allowlist. Returns user if authorized. */
export function checkAuth(initData: string): { ok: boolean; user?: TelegramUser; error?: string } {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) return { ok: false, error: "Server not configured" };

  const { valid, user } = validateTelegramInitData(initData, botToken);
  if (!valid) return { ok: false, error: "Invalid auth" };

  const allowed = getAllowedUsers();
  if (allowed.size > 0) {
    if (!user) return { ok: false, error: "User identification required" };
    if (!allowed.has(String(user.id))) return { ok: false, error: "Not authorized" };
  }

  return { ok: true, user };
}
