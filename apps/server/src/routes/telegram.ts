import { resolve as resolvePath } from "node:path";
import { Hono } from "hono";
import { getTelegramCreds, tgRaw, tgSanitize } from "./utils.js";
import { isPathAllowed, ALLOWED_FILE_ROOTS } from "../lib/path-allowed.js";

const app = new Hono();

app.post("/send-to-chat", async (c) => {
  const { filePath } = await c.req.json<{ filePath: string }>();
  if (!filePath) return c.json({ ok: false, error: "filePath required" }, 400);

  if (!(await isPathAllowed(filePath, ALLOWED_FILE_ROOTS))) {
    return c.json({ ok: false, error: "Access denied" }, 403);
  }

  try {
    const { botToken, chatId } = await getTelegramCreds();
    const normalizedPath = resolvePath(filePath);
    const shortPath = normalizedPath.replace(/^\/home\/claude\//, "~/");
    const message = [
      `📄 *Shared from Pocket Console*`,
      ``,
      `\`${tgRaw(shortPath)}\``,
      ``,
      tgSanitize(`_User is sharing this file with you. Read it and consider how it relates to our current work. If you can infer the intent, act on it. If you need slight clarification, offer 2-3 multiple choice options so the user can respond quickly. Only ask an open-ended question if you truly cannot guess._`),
    ].join("\n");

    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: "MarkdownV2" }),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) {
      return c.json({ ok: false, error: result.description || "Telegram API error" }, 502);
    }
    return c.json({ ok: true, messageId: result?.result?.message_id });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500);
  }
});

export { app as telegramRoute };
