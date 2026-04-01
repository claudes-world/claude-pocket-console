import { Hono } from "hono";
import { getTelegramCreds, tgRaw, tgSanitize, execAsync } from "./utils.js";

const app = new Hono();

app.post("/send-to-chat", async (c) => {
  const { filePath } = await c.req.json<{ filePath: string }>();
  if (!filePath) return c.json({ ok: false, error: "filePath required" }, 400);

  try {
    const { botToken, chatId } = await getTelegramCreds();
    const shortPath = filePath.replace(/^\/home\/claude\//, "~/");
    const message = [
      `📄 *Shared from Pocket Console*`,
      ``,
      `\`${tgRaw(shortPath)}\``,
      ``,
      tgSanitize(`_User is sharing this file with you. Read it and consider how it relates to our current work. If you can infer the intent, act on it. If you need slight clarification, offer 2-3 multiple choice options so the user can respond quickly. Only ask an open-ended question if you truly cannot guess._`),
    ].join("\n");

    const payload = JSON.stringify({ chat_id: chatId, text: message, parse_mode: "MarkdownV2" });
    const curlCmd = `curl -s -X POST "https://api.telegram.org/bot${botToken}/sendMessage" -H "Content-Type: application/json" -d '${payload.replace(/'/g, "'\\''")}'`;
    const { stdout } = await execAsync(curlCmd, { shell: "/bin/bash" });
    const result = JSON.parse(stdout);
    return c.json({ ok: true, messageId: result?.result?.message_id });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500);
  }
});

export { app as telegramRoute };
