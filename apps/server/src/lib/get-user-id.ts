import type { Context } from "hono";
import type { TelegramUser } from "../auth.js";

/**
 * Extract the authenticated Telegram user ID from the request context.
 * Returns null if no user is authenticated.
 *
 * Shared helper used by voice.ts and reading-list.ts.
 * Callers decide auth behavior when this returns null
 * (both voice.ts and reading-list.ts return 401).
 */
export function getUserId(c: Context): string | null {
  const user = c.get("telegramUser") as TelegramUser | undefined;
  if (!user?.id) return null;
  return String(user.id);
}
