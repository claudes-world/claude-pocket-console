import type { Context, Next } from "hono";
import { validateTelegramInitData, getAllowedUsers } from "./auth.js";

/**
 * Middleware that validates Telegram Mini App auth.
 * Expects initData in the Authorization header as: tma <initData>
 */
export async function telegramAuth(c: Context, next: Next) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    return c.json({ error: "Server not configured: missing bot token" }, 500);
  }

  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("tma ")) {
    return c.json({ error: "Missing Telegram auth" }, 401);
  }

  const initData = authHeader.slice(4);
  const { valid, user } = validateTelegramInitData(initData, botToken);

  if (!valid) {
    return c.json({ error: "Invalid Telegram auth" }, 401);
  }

  if (user) {
    const allowed = getAllowedUsers();
    if (allowed.size > 0 && !allowed.has(String(user.id))) {
      return c.json({ error: "User not authorized" }, 403);
    }
    c.set("telegramUser", user);
  }

  await next();
}
