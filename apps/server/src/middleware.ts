import type { Context, Next } from "hono";
import { validateTelegramInitData, getAllowedUsers, validateSession, validateJwtToken } from "./auth.js";

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

  // Fallback: Bearer token (session token from Login Widget, or JWT from keyboard button)
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7);

    // Try session token first
    const sessionResult = validateSession(token);
    if (sessionResult.valid) {
      const allowed = getAllowedUsers();
      if (allowed.size > 0) {
        if (!sessionResult.user) {
          return c.json({ error: "User identification is required" }, 403);
        }
        if (!allowed.has(String(sessionResult.user.id))) {
          return c.json({ error: "User not authorized" }, 403);
        }
      }

      if (sessionResult.user) {
        c.set("telegramUser", sessionResult.user);
      }

      await next();
      return;
    }

    // Try JWT token validation (keyboard button auth)
    const jwtResult = validateJwtToken(token, botToken);
    if (jwtResult.valid) {
      const allowed = getAllowedUsers();
      if (allowed.size > 0) {
        if (!jwtResult.user || !allowed.has(String(jwtResult.user.id))) {
          return c.json({ error: "User not authorized" }, 403);
        }
      }

      if (jwtResult.user) {
        c.set("telegramUser", jwtResult.user);
      }

      await next();
      return;
    }

    return c.json({ error: "Invalid or expired token" }, 401);
  }

  // Fallback: JWT token in query param (keyboard button auth)
  const urlToken = c.req.query("token");
  if (urlToken) {
    const { valid, user } = validateJwtToken(urlToken, botToken);
    if (valid) {
      const allowed = getAllowedUsers();
      if (allowed.size > 0) {
        if (!user || !allowed.has(String(user.id))) {
          return c.json({ error: "User not authorized" }, 403);
        }
      }

      if (user) {
        c.set("telegramUser", user);
      }

      await next();
      return;
    }
  }

  return c.json({ error: "Missing Telegram auth" }, 401);
}
