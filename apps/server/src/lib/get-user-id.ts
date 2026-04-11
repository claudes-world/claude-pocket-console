import type { Context } from "hono";
import type { TelegramUser } from "../auth.js";

/**
 * Extract the authenticated Telegram user ID from the request context.
 * Returns null if no user is authenticated.
 *
 * Shared helper used by voice.ts and reading-list.ts.
 * The caller decides the fallback behavior:
 *   - voice.ts falls back to "default" for backward compat
 *   - reading-list.ts returns 401 on null
 */
export function getUserId(c: Context): string | null {
  const user = c.get("telegramUser") as TelegramUser | undefined;
  if (!user?.id) return null;
  return String(user.id);
}
