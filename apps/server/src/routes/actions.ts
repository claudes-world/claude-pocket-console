import { Hono } from "hono";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const execAsync = promisify(exec);

// Load OpenAI key from secrets file if not already in env
function loadOpenAIEnv() {
  const secretsPath = join(process.env.HOME || "/home/claude", ".secrets/openai.env");
  try {
    const content = readFileSync(secretsPath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq);
      const val = trimmed.slice(eq + 1);
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {
    // File may not exist yet
  }
}
loadOpenAIEnv();

const app = new Hono();

const TMUX_SESSION = process.env.TMUX_SESSION || "claudes-world";
const HOME = process.env.HOME || "/home/claude";
const CLAUDES_WORLD = join(HOME, "claudes-world");
const SESSION_NAMES_FILE = join(CLAUDES_WORLD, ".cpc-session-names");

// Send keys to the tmux session
async function sendToTmux(keys: string) {
  await execAsync(`tmux send-keys -t ${TMUX_SESSION} "${keys}" Enter`);
}

app.post("/reload-plugins", async (c) => {
  try {
    await sendToTmux("/reload-plugins");
    return c.json({ ok: true, action: "reload-plugins" });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500);
  }
});

app.post("/git-status", async (c) => {
  try {
    const { stdout } = await execAsync("git -C /home/claude/claudes-world status --short");
    return c.json({ ok: true, output: stdout });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500);
  }
});

// GET version for bottom sheet fetch
app.get("/git-status", async (c) => {
  try {
    const { stdout } = await execAsync("git -C /home/claude/claudes-world status --short");
    return c.json({ ok: true, output: stdout || "(clean)" });
  } catch (err: any) {
    return c.json({ ok: false, output: err.message });
  }
});

app.post("/resize-terminal", async (c) => {
  try {
    await execAsync(`tmux resize-window -t ${TMUX_SESSION} -A`);
    return c.json({ ok: true, action: "resize-terminal" });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500);
  }
});

app.post("/send-keys", async (c) => {
  try {
    const body = await c.req.json();
    const keys = body.keys;
    if (!keys || typeof keys !== "string") {
      return c.json({ ok: false, error: "keys required" }, 400);
    }
    if (body.raw) {
      // Raw tmux key names (Escape, BTab, etc.) — no -l flag, no Enter
      await execAsync(`tmux send-keys -t ${TMUX_SESSION} ${keys}`);
    } else {
      // Escape for tmux — use literal send-keys with -l to avoid special char issues
      await execAsync(`tmux send-keys -t ${TMUX_SESSION} -l ${JSON.stringify(keys)}`);
      await execAsync(`tmux send-keys -t ${TMUX_SESSION} Enter`);
    }
    return c.json({ ok: true, action: "send-keys" });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500);
  }
});

// --- Git command endpoint for git menu actions ---
app.post("/git-command", async (c) => {
  try {
    const body = await c.req.json();
    const command = body.command as string;
    if (!command) return c.json({ ok: false, error: "command required" }, 400);

    let cmd: string;
    switch (command) {
      case "branch":
        cmd = "git -C /home/claude/claudes-world branch --show-current";
        break;
      case "log":
        cmd = "git -C /home/claude/claudes-world log --oneline -10";
        break;
      case "pull":
        cmd = "git -C /home/claude/claudes-world pull";
        break;
      case "status":
        cmd = "git -C /home/claude/claudes-world status --short";
        break;
      default:
        return c.json({ ok: false, error: "unknown command" }, 400);
    }

    const { stdout, stderr } = await execAsync(cmd);
    return c.json({ ok: true, output: stdout || stderr || "(no output)" });
  } catch (err: any) {
    return c.json({ ok: false, output: err.message });
  }
});

// --- TODO endpoint ---
app.get("/todo", async (c) => {
  try {
    const todoPath = join(CLAUDES_WORLD, "TODO.md");
    if (!existsSync(todoPath)) {
      return c.json({ ok: true, content: "No TODO.md found" });
    }
    const content = readFileSync(todoPath, "utf-8");
    return c.json({ ok: true, content });
  } catch (err: any) {
    return c.json({ ok: false, content: `Error: ${err.message}` });
  }
});

// --- Compact endpoint ---
app.post("/compact", async (c) => {
  try {
    const body = await c.req.json();
    const message = body.message as string;
    if (!message) return c.json({ ok: false, error: "message required" }, 400);

    // Send via tmux send-keys
    await execAsync(`tmux send-keys -t ${TMUX_SESSION} -l ${JSON.stringify(message)}`);
    await execAsync(`tmux send-keys -t ${TMUX_SESSION} Enter`);
    return c.json({ ok: true, action: "compact" });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500);
  }
});

// --- Rename session ---
app.post("/rename-session", async (c) => {
  try {
    const body = await c.req.json();
    const name = body.name as string;
    if (!name) return c.json({ ok: false, error: "name required" }, 400);

    // Add to session names file
    let names: { name: string; ts: number }[] = [];
    try {
      if (existsSync(SESSION_NAMES_FILE)) {
        names = JSON.parse(readFileSync(SESSION_NAMES_FILE, "utf-8"));
      }
    } catch { names = []; }

    // Add new entry at the top
    names.unshift({ name, ts: Date.now() });
    // Cap at 100 entries
    if (names.length > 100) names = names.slice(0, 100);
    writeFileSync(SESSION_NAMES_FILE, JSON.stringify(names, null, 2));

    return c.json({ ok: true, name });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500);
  }
});

// --- Session names ---
app.get("/session-names", async (c) => {
  try {
    if (!existsSync(SESSION_NAMES_FILE)) {
      return c.json({ ok: true, names: [] });
    }
    const names = JSON.parse(readFileSync(SESSION_NAMES_FILE, "utf-8"));
    return c.json({ ok: true, names });
  } catch (err: any) {
    return c.json({ ok: true, names: [] });
  }
});

app.delete("/session-names", async (c) => {
  try {
    const body = await c.req.json();
    const ts = body.ts as number;
    if (!ts) return c.json({ ok: false, error: "ts required" }, 400);
    let names: { name: string; ts: number }[] = [];
    try {
      if (existsSync(SESSION_NAMES_FILE)) {
        names = JSON.parse(readFileSync(SESSION_NAMES_FILE, "utf-8"));
      }
    } catch { names = []; }
    const filtered = names.filter((n: { ts: number }) => n.ts !== ts);
    writeFileSync(SESSION_NAMES_FILE, JSON.stringify(filtered, null, 2));
    return c.json({ ok: true });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500);
  }
});

// --- Check audio (TTS) for a markdown file ---
app.get("/check-audio", async (c) => {
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

// --- Generate audio (TTS) for a markdown file ---
app.post("/generate-audio", async (c) => {
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

// Helper: load Telegram creds from common.sh (same pattern as send-to-chat)
async function getTelegramCreds(): Promise<{ botToken: string; chatId: string }> {
  const commonSh = join(process.env.HOME || "/home/claude", "code/toolbox/hooks/common.sh");
  const envCmd = `source "${commonSh}" 2>/dev/null; echo "$BOTTOKEN|||$TELEGRAM_CHAT_ID"`;
  const { stdout } = await execAsync(envCmd, { shell: "/bin/bash" });
  const [botToken, chatId] = stdout.trim().split("|||");
  if (!botToken || !chatId) throw new Error("Telegram not configured in common.sh");
  return { botToken, chatId };
}

// --- Send audio to Telegram ---
app.post("/send-audio-telegram", async (c) => {
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

// Telegram MarkdownV2 sanitizer — inline version (see toolbox/tg-sanitize for full tool)
const TG_SPECIAL = /[_*\[\]()~`>#\+\-=|{}.!\\]/g;
function tgRaw(text: string) { return text.replace(TG_SPECIAL, '\\$&'); }
function tgSanitize(text: string) {
  // Preserve *bold*, _italic_, `code`, then escape everything else
  const phs: { key: string; val: string }[] = [];
  let idx = 0;
  const hold = (m: string) => { const k = `\x00${idx++}\x00`; phs.push({ key: k, val: m }); return k; };
  let t = text;
  t = t.replace(/`[^`]+`/g, hold);
  t = t.replace(/\*([^*]+)\*/g, (_, i) => hold(`*${i.replace(TG_SPECIAL, '\\$&')}*`));
  t = t.replace(/_([^_]+)_/g, (_, i) => hold(`_${i.replace(TG_SPECIAL, '\\$&')}_`));
  t = t.replace(TG_SPECIAL, '\\$&');
  for (const { key, val } of phs) t = t.replace(key, val);
  return t;
}

// Send file path to Telegram chat with contextual prompt
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

app.get("/git-branch", async (c) => {
  try {
    // Get current branch
    const { stdout: branch } = await execAsync("git -C /home/claude/claudes-world rev-parse --abbrev-ref HEAD");

    // Check if this is a worktree or main tree
    const { stdout: gitDir } = await execAsync("git -C /home/claude/claudes-world rev-parse --git-dir");
    const isWorktree = gitDir.trim().includes("/worktrees/");

    return c.json({
      ok: true,
      branch: branch.trim(),
      isWorktree,
      treeType: isWorktree ? "linked tree" : "main tree",
    });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500);
  }
});

export { app as actionsRoute };
