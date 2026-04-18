import { createHash, createHmac, randomBytes } from "node:crypto";

// Allow up to 30 seconds of clock skew on the future-timestamp check.
// Telegram servers and client devices can drift by a few seconds; a hard
// equality check (authDate > nowSec) would reject legitimate requests that
// arrive with a timestamp slightly ahead of the server clock.
const CLOCK_SKEW_TOLERANCE_SEC = 30;

/**
 * Validate an auth_date unix timestamp.
 * Rejects NaN, non-positive, more than 30s in the future (clock-skew
 * tolerance), and older than 24 hours.
 */
function validateAuthDate(rawAuthDate: string | undefined): boolean {
  if (!rawAuthDate) return false;
  const authDate = parseInt(rawAuthDate, 10);
  const nowSec = Date.now() / 1000;
  if (!Number.isFinite(authDate) || authDate <= 0) return false;
  if (authDate > nowSec + CLOCK_SKEW_TOLERANCE_SEC) return false;
  if (nowSec - authDate > 86400) return false;
  return true;
}

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

  // Check auth_date is within 24 hours (guard against NaN, future timestamps)
  if (!validateAuthDate(params.get("auth_date") ?? undefined)) return { valid: false };

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

  // Check auth_date is within 24 hours (guard against NaN, future timestamps)
  if (!validateAuthDate(rest.auth_date)) return { valid: false };

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

/**
 * Validate a JWT token signed with the bot token (keyboard button auth).
 * The bot embeds a signed JWT in keyboard button URLs so the app can
 * authenticate when Telegram initData is unavailable.
 */
export function validateJwtToken(
  token: string,
  botToken: string,
): { valid: boolean; user?: TelegramUser } {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return { valid: false };

    // Verify signature
    const signatureInput = `${parts[0]}.${parts[1]}`;
    const expectedSig = createHmac("sha256", botToken)
      .update(signatureInput)
      .digest("base64url");

    if (expectedSig !== parts[2]) return { valid: false };

    // Decode payload
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());

    // Check expiry
    if (payload.exp && Date.now() / 1000 > payload.exp) return { valid: false };

    return {
      valid: true,
      user: {
        id: parseInt(payload.sub),
        first_name: "Keyboard User",
      },
    };
  } catch {
    return { valid: false };
  }
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

/**
 * Try initData against each token in order; return first success or { valid: false }.
 */
export function validateTelegramInitDataWithTokens(
  initData: string,
  tokens: string[],
): { valid: boolean; user?: TelegramUser } {
  for (const token of tokens) {
    const result = validateTelegramInitData(initData, token);
    if (result.valid) return result;
  }
  return { valid: false };
}

/**
 * Try a JWT token against each bot token in order; return first success or { valid: false }.
 */
export function validateJwtTokenWithTokens(
  jwtToken: string,
  tokens: string[],
): { valid: boolean; user?: TelegramUser } {
  for (const token of tokens) {
    const result = validateJwtToken(jwtToken, token);
    if (result.valid) return result;
  }
  return { valid: false };
}

/** Return the list of bot tokens to validate against.
 * Prefers TELEGRAM_BOT_TOKENS (comma-separated) over TELEGRAM_BOT_TOKEN. */
export function getBotTokens(): string[] {
  const multi = process.env.TELEGRAM_BOT_TOKENS;
  if (multi) {
    const tokens = multi.split(",").map((t) => t.trim()).filter(Boolean);
    if (tokens.length > 0) return tokens;
  }
  const single = process.env.TELEGRAM_BOT_TOKEN;
  return single ? [single] : [];
}

/** Full auth check: validate initData + check allowlist. Returns user if authorized. */
export function checkAuth(initData: string): { ok: boolean; user?: TelegramUser; error?: string } {
  const tokens = getBotTokens();
  if (tokens.length === 0) return { ok: false, error: "Server not configured" };

  const { valid, user } = validateTelegramInitDataWithTokens(initData, tokens);
  if (!valid) return { ok: false, error: "Invalid auth" };

  const allowed = getAllowedUsers();
  if (allowed.size > 0) {
    if (!user) return { ok: false, error: "User identification required" };
    if (!allowed.has(String(user.id))) return { ok: false, error: "Not authorized" };
  }

  return { ok: true, user };
}
