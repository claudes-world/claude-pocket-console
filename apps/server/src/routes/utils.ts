import { exec, execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

// TMUX_SESSION is consumed by execAsync (shell) in several helpers, so a
// malicious `process.env.TMUX_SESSION` would break the fence. Validate
// once at module load against the canonical tmux session-name charset
// (alphanumerics, hyphens, underscores) and refuse to start otherwise.
// Every TMUX_SESSION consumer in the codebase must import THIS constant
// rather than reading process.env directly so the validation is
// unbypassable.
const _rawTmuxSession = process.env.TMUX_SESSION || "claudes-world";
if (!/^[A-Za-z0-9_-]+$/.test(_rawTmuxSession)) {
  throw new Error(
    `Invalid TMUX_SESSION name: ${JSON.stringify(_rawTmuxSession)}. ` +
      `Only alphanumerics, hyphens, and underscores are allowed.`,
  );
}
export const TMUX_SESSION = _rawTmuxSession;
export const HOME = process.env.HOME || "/home/claude";
export const CLAUDES_WORLD = join(HOME, "claudes-world");
export const SESSION_NAMES_FILE = join(CLAUDES_WORLD, ".cpc-session-names");

/**
 * Send literal text to the tmux session and submit it with Enter.
 *
 * Uses `execFile` (no shell) with an argv array so `keys` cannot inject
 * shell metacharacters — we do not rely on `JSON.stringify` as a shell
 * quoting strategy (it doesn't escape `$VAR`, backticks, or `$(...)` inside
 * double-quotes). Two separate calls so the literal text is fully flushed
 * before the Enter key is delivered.
 *
 * The previous implementation `tmux send-keys -t SESSION "${keys}" Enter`
 * (raw shell interpolation, no `-l`, single call via exec) was observed to
 * hang indefinitely against the live `claudes-world` tmux session when
 * invoked from the /reload-plugins endpoint, leaving hung tmux clients in
 * the cpc.service cgroup and never delivering the slash command to Claude
 * CLI. The `-l` (literal) flag also matters on its own: without it, tmux
 * tries to interpret `keys` as key names, which can reject or buffer
 * arbitrary user input.
 */
// 5-second cap on each tmux invocation. Prevents the hang-forever failure
// mode that originally motivated this PR — if tmux send-keys ever stalls
// again, the promise rejects after 5s instead of wedging the HTTP handler.
// On timeout execFile SIGTERMs the child and surfaces the rejection to
// the caller; the catch in the /reload-plugins route already handles that
// path and returns a non-OK JSON response to the client.
const TMUX_TIMEOUT_MS = 5_000;

export async function sendToTmux(keys: string) {
  // The `--` separator stops tmux from interpreting `keys` as an option
  // if the first character is a hyphen. execFile already prevents shell
  // injection but this also prevents tmux-level argument confusion.
  await execFileAsync("tmux", ["send-keys", "-t", TMUX_SESSION, "-l", "--", keys], {
    timeout: TMUX_TIMEOUT_MS,
  });
  await execFileAsync("tmux", ["send-keys", "-t", TMUX_SESSION, "Enter"], {
    timeout: TMUX_TIMEOUT_MS,
  });
}

/** Load OpenAI key from secrets file if not already in env */
export function loadOpenAIEnv() {
  loadSecretsFile(join(HOME, ".secrets/openai.env"));
}

/** Load Anthropic key from secrets file if not already in env */
export function loadAnthropicEnv() {
  loadSecretsFile(join(HOME, ".secrets/anthropic.env"));
}

/** Shared secrets-file loader — parses KEY=VAL lines, skips comments/blanks. */
function loadSecretsFile(secretsPath: string) {
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
    // File may not exist yet — feature endpoint must no-op gracefully.
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
