import { Hono } from "hono";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { loadOpenAIEnv, getTelegramCreds } from "./utils.js";
import {
  ALLOWED_FILE_ROOTS,
  isPathAllowed as isPathAllowedShared,
} from "../lib/path-allowed.js";
import { getTracer } from "../lib/otel.js";
import { SpanStatusCode } from "@opentelemetry/api";

const execFileAsync = promisify(execFile);

// Load OpenAI env on module init
loadOpenAIEnv();

function isPathAllowed(absPath: string): Promise<boolean> {
  return isPathAllowedShared(absPath, ALLOWED_FILE_ROOTS);
}

const audioTracer = getTracer('cpc-server-audio');

const app = new Hono();

app.get("/check", async (c) => {
  try {
    const filePath = c.req.query("path");
    if (!filePath) return c.json({ ok: false, error: "path required" }, 400);

    // Require an explicit `.md` extension so a non-markdown path (e.g. note.txt)
    // doesn't silently skip the .mp3 replacement and leak file existence of
    // arbitrary paths. Mirrors the same gate in /generate.
    const resolvedFilePath = resolve(filePath);
    if (!resolvedFilePath.toLowerCase().endsWith(".md")) {
      return c.json({ ok: false, error: "only .md files allowed" }, 400);
    }

    // Allowlist-guard the SOURCE markdown path, not the derived .mp3 path.
    // The .mp3 may not exist yet (client is asking "does audio exist?"), and
    // isPathAllowed uses realpath() which fails on non-existent files,
    // returning a false 403. The source .md file is what the client has, so
    // validate that instead. (Fixes #170)
    if (!(await isPathAllowed(resolvedFilePath))) {
      return c.json({ ok: false, error: "path not allowed" }, 403);
    }

    // Audio file is the same path but with .mp3 extension.
    const audioPath = resolvedFilePath.replace(/\.md$/i, ".mp3");

    // Guard the derived .mp3 path too: a symlink planted under an allowed root
    // that points outside allowed roots would otherwise let existsSync() reveal
    // whether an out-of-bounds file exists. If the check fails (symlink escape
    // or the path resolves outside roots), treat the audio as non-existent.
    if (!(await isPathAllowed(resolve(audioPath)))) {
      return c.json({ ok: true, exists: false, path: null });
    }

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

    // Require an explicit `.md` extension (case-insensitive) before doing any
    // path resolution so we never readFileSync() a non-markdown document by
    // accident. Matches what markdown.ts already does at line 345.
    const resolvedPath = resolve(filePath);
    if (!resolvedPath.toLowerCase().endsWith(".md")) {
      return c.json({ ok: false, error: "only .md files allowed" }, 400);
    }
    // Allowlist-guard BEFORE readFileSync. Previous implementation read any
    // path the client supplied, including /home/claude/.secrets/cpc.env, and
    // shipped the contents to OpenAI's TTS endpoint (privacy bust + reflected
    // write of foo.env.mp3 to disk). isPathAllowed resolves symlinks and
    // enforces a path-segment boundary so sibling prefixes can't bypass.
    if (!(await isPathAllowed(resolvedPath))) {
      return c.json({ ok: false, error: "path not allowed" }, 403);
    }

    const audioPath = resolvedPath.replace(/\.md$/i, ".mp3");

    // Read the markdown file
    const content = readFileSync(resolvedPath, "utf-8");
    if (!content.trim()) return c.json({ ok: false, error: "File is empty" }, 400);

    // Use OpenAI TTS API
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return c.json({ ok: false, error: "OPENAI_API_KEY not set" }, 500);

    const ttsInput = content.slice(0, 4096);
    const ttsVoice = "nova";
    const ttsSpan = audioTracer.startSpan('audio.tts', {
      attributes: {
        'ai.model': 'tts-1',
        'audio.voice': ttsVoice,
        'audio.input_length': ttsInput.length,
      },
    });

    let res: Response;
    try {
      res = await fetch("https://api.openai.com/v1/audio/speech", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "tts-1",
          input: ttsInput,
          voice: ttsVoice,
          response_format: "mp3",
        }),
      });
    } catch (err) {
      ttsSpan.recordException(err instanceof Error ? err : String(err));
      ttsSpan.setStatus({ code: SpanStatusCode.ERROR });
      ttsSpan.end();
      throw err;
    }

    if (!res.ok) {
      const err = await res.text();
      ttsSpan.setAttribute('http.status_code', res.status);
      ttsSpan.setStatus({ code: SpanStatusCode.ERROR });
      ttsSpan.end();
      return c.json({ ok: false, error: `TTS API error: ${err}` }, 500);
    }

    ttsSpan.setAttribute('http.status_code', res.status);
    ttsSpan.end();

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
    const rawPath = body.path as string;
    if (!rawPath) return c.json({ ok: false, error: "path required" }, 400);

    // Resolve + allowlist-guard BEFORE touching the filesystem. Previous
    // implementation had zero path validation, so an authenticated caller
    // could make the server `curl -F audio=@/etc/shadow` and exfiltrate
    // arbitrary files via Telegram (legitimate endpoint, illegitimate file).
    const audioPath = resolve(rawPath);
    if (!(await isPathAllowed(audioPath))) {
      return c.json({ ok: false, error: "path not allowed" }, 403);
    }
    if (!existsSync(audioPath)) return c.json({ ok: false, error: "Audio file not found" }, 404);

    const { botToken, chatId } = await getTelegramCreds();
    const fileName = audioPath.split("/").pop() || "audio.mp3";
    const shortPath = audioPath.replace(/^\/home\/claude\//, "~/");
    const encodedPath = encodeURIComponent(audioPath);
    const deepUrl = `https://cpc.claude.do/#file=${encodedPath}`;

    // Shell out via execFile — argv array, no /bin/bash interpolation. The
    // previous `execAsync` template concatenated `audioPath`, `fileName`, and
    // `shortPath` into a double-quoted bash string, which left `$(...)`,
    // backticks, and `${VAR}` expansion live. `"` escaping alone does NOT
    // defeat command substitution. execFile sidesteps the shell entirely so
    // every -F value is a literal argv token regardless of its contents.
    const sendAudioUrl = `https://api.telegram.org/bot${botToken}/sendAudio`;
    const replyMarkup = JSON.stringify({
      inline_keyboard: [[
        { text: "Read in Pocket Console", web_app: { url: deepUrl } },
      ]],
    });
    const { stdout } = await execFileAsync("curl", [
      "-s",
      "-X", "POST",
      sendAudioUrl,
      "-F", `chat_id=${chatId}`,
      "-F", `audio=@${audioPath}`,
      "-F", `title=${fileName}`,
      "-F", `caption=📄 ${shortPath}`,
      "-F", `reply_markup=${replyMarkup}`,
    ]);
    const result = JSON.parse(stdout);
    const msgId = result?.result?.message_id;

    // Auto-pin — also via execFile with argv for the same reason.
    if (msgId) {
      const pinUrl = `https://api.telegram.org/bot${botToken}/pinChatMessage`;
      await execFileAsync("curl", [
        "-s",
        "-X", "POST",
        pinUrl,
        "-d", `chat_id=${chatId}`,
        "-d", `message_id=${msgId}`,
        "-d", "disable_notification=true",
      ]).catch(() => {});
    }

    return c.json({ ok: true, message_id: msgId });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500);
  }
});

export { app as audioRoute };
