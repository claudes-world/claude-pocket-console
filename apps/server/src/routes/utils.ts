import { exec } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const execAsync = promisify(exec);

export const TMUX_SESSION = process.env.TMUX_SESSION || "claudes-world";
export const HOME = process.env.HOME || "/home/claude";
export const CLAUDES_WORLD = join(HOME, "claudes-world");
export const SESSION_NAMES_FILE = join(CLAUDES_WORLD, ".cpc-session-names");

/** Send keys to the tmux session */
export async function sendToTmux(keys: string) {
  await execAsync(`tmux send-keys -t ${TMUX_SESSION} "${keys}" Enter`);
}

/** Load OpenAI key from secrets file if not already in env */
export function loadOpenAIEnv() {
  const secretsPath = join(HOME, ".secrets/openai.env");
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

/** Load Telegram creds from common.sh */
export async function getTelegramCreds(): Promise<{ botToken: string; chatId: string }> {
  const commonSh = join(HOME, "code/toolbox/hooks/common.sh");
  const envCmd = `source "${commonSh}" 2>/dev/null; echo "$BOTTOKEN|||$TELEGRAM_CHAT_ID"`;
  const { stdout } = await execAsync(envCmd, { shell: "/bin/bash" });
  const [botToken, chatId] = stdout.trim().split("|||");
  if (!botToken || !chatId) throw new Error("Telegram not configured in common.sh");
  return { botToken, chatId };
}

/** Telegram MarkdownV2 sanitizer — inline version */
const TG_SPECIAL = /[_*\[\]()~`>#\+\-=|{}.!\\]/g;
export function tgRaw(text: string) { return text.replace(TG_SPECIAL, '\\$&'); }
export function tgSanitize(text: string) {
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
