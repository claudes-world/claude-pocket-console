import type { Context, Next } from "hono";
import { validateTelegramInitData, validateSession, validateJwtToken } from "./auth.js";
import { isAllowedUser } from "./lib/allowed-users.js";

/**
 * Middleware that validates Telegram Mini App auth.
 * Expects initData in the Authorization header as: tma <initData>
 */
export async function telegramAuth(c: Context, next: Next) {
  const ticket = c.req.query("ticket");
  if (
    c.req.method === "GET" &&
    c.req.path === "/api/files/download" &&
    ticket &&
    /^[0-9a-f]{32}$/.test(ticket)
  ) {
    await next();
    return;
  }

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

    if (!isAllowedUser(user?.id)) {
      return c.json({ error: "User not authorized" }, 403);
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
      if (!isAllowedUser(sessionResult.user?.id)) {
        return c.json({ error: "User not authorized" }, 403);
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
      if (!isAllowedUser(jwtResult.user?.id)) {
        return c.json({ error: "User not authorized" }, 403);
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
      if (!isAllowedUser(user?.id)) {
        return c.json({ error: "User not authorized" }, 403);
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
