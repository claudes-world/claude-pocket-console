import { Hono } from "hono";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { loadOpenAIEnv, getTelegramCreds, execAsync } from "./utils.js";

// Load OpenAI env on module init
loadOpenAIEnv();

const app = new Hono();

app.get("/check", async (c) => {
  try {
    const filePath = c.req.query("path");
    if (!filePath) return c.json({ ok: false, error: "path required" }, 400);

    // Audio file is the same path but with .mp3 extension
    const audioPath = filePath.replace(/\.md$/, ".mp3");
    const exists = existsSync(audioPath);
    return c.json({ ok: true, exists, path: exists ? audioPath : null });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500);
  }
});

app.post("/generate", async (c) => {
  try {
    const body = await c.req.json();
    const filePath = body.path as string;
    if (!filePath) return c.json({ ok: false, error: "path required" }, 400);

    const audioPath = filePath.replace(/\.md$/, ".mp3");

    // Read the markdown file
    const content = readFileSync(filePath, "utf-8");
    if (!content.trim()) return c.json({ ok: false, error: "File is empty" }, 400);

    // Use OpenAI TTS API
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return c.json({ ok: false, error: "OPENAI_API_KEY not set" }, 500);

    const res = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "tts-1",
        input: content.slice(0, 4096), // API limit
        voice: "nova",
        response_format: "mp3",
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      return c.json({ ok: false, error: `TTS API error: ${err}` }, 500);
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    writeFileSync(audioPath, buffer);

    return c.json({ ok: true, path: audioPath });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500);
  }
});

app.post("/send-telegram", async (c) => {
  try {
    const body = await c.req.json();
    const audioPath = body.path as string;
    if (!audioPath) return c.json({ ok: false, error: "path required" }, 400);
    if (!existsSync(audioPath)) return c.json({ ok: false, error: "Audio file not found" }, 404);

    const { botToken, chatId } = await getTelegramCreds();
    const fileName = audioPath.split("/").pop() || "audio.mp3";
    const shortPath = audioPath.replace(/^\/home\/claude\//, "~/");
    const encodedPath = encodeURIComponent(audioPath);
    const deepUrl = `https://cpc.claude.do/#file=${encodedPath}`;

    // Use curl for multipart — more reliable than fetch FormData in bun
    const curlCmd = `curl -s -X POST "https://api.telegram.org/bot${botToken}/sendAudio" \
      -F "chat_id=${chatId}" \
      -F "audio=@${audioPath}" \
      -F "title=${fileName.replace(/"/g, '\\"')}" \
      -F "caption=📄 ${shortPath.replace(/"/g, '\\"')}" \
      -F 'reply_markup={"inline_keyboard":[[{"text":"Read in Pocket Console","web_app":{"url":"${deepUrl}"}}]]}'`;

    const { stdout } = await execAsync(curlCmd, { shell: "/bin/bash" });
    const result = JSON.parse(stdout);
    const msgId = result?.result?.message_id;

    // Auto-pin
    if (msgId) {
      await execAsync(`curl -s -X POST "https://api.telegram.org/bot${botToken}/pinChatMessage" \
        -d "chat_id=${chatId}&message_id=${msgId}&disable_notification=true"`, { shell: "/bin/bash" }).catch(() => {});
    }

    return c.json({ ok: true, message_id: msgId });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500);
  }
});

export { app as audioRoute };
