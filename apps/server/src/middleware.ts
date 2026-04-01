import type { Context, Next } from "hono";
import { validateTelegramInitData, getAllowedUsers, validateSession } from "./auth.js";

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

  // Primary: Telegram Mini App initData
  if (authHeader?.startsWith("tma ")) {
    const initData = authHeader.slice(4);
    const { valid, user } = validateTelegramInitData(initData, botToken);

    if (!valid) {
      return c.json({ error: "Invalid Telegram auth" }, 401);
    }

    const allowed = getAllowedUsers();
    if (allowed.size > 0) {
      if (!user) {
        return c.json({ error: "User identification is required" }, 403);
      }
      if (!allowed.has(String(user.id))) {
        return c.json({ error: "User not authorized" }, 403);
      }
    }

    if (user) {
      c.set("telegramUser", user);
    }

    await next();
    return;
  }

  // Fallback: session token from Login Widget auth
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    const { valid, user } = validateSession(token);
    if (!valid) {
      return c.json({ error: "Invalid or expired session" }, 401);
    }

    const allowed = getAllowedUsers();
    if (allowed.size > 0) {
      if (!user) {
        return c.json({ error: "User identification is required" }, 403);
      }
      if (!allowed.has(String(user.id))) {
        return c.json({ error: "User not authorized" }, 403);
      }
    }

    if (user) {
      c.set("telegramUser", user);
    }

    await next();
    return;
  }

  return c.json({ error: "Missing Telegram auth" }, 401);
}
