import { exec, execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

// Canonical session-name allowlist, shared by every place a tmux session
// name crosses a trust boundary: the boot-time TMUX_SESSION env validation
// below, the `?session=` WS query param (terminal-ws.ts), and the
// /api/terminal/sessions listing (terminal/sessions.ts). Same charset and
// length bound as the cockpit's cockpit-attach wrapper — alphanumerics,
// hyphens, underscores, dots, 1-64 chars. A name that fails this regex must
// never reach a tmux argv.
export const SESSION_NAME_RE = /^[A-Za-z0-9_.-]{1,64}$/;

// TMUX_SESSION is consumed by execAsync (shell) in several helpers, so a
// malicious `process.env.TMUX_SESSION` would break the fence. Validate
// once at module load against the canonical tmux session-name charset
// (alphanumerics, hyphens, underscores, dots) and refuse to start
// otherwise. Dots are allowed because real tmux session names in use
// here include them (e.g. "claudes-world" plus dotted variants from
// knowledge/ADR work); tmux itself accepts them. See PR #100 round 5
// for the regex expansion.
// Every TMUX_SESSION consumer in the codebase must import THIS constant
// rather than reading process.env directly so the validation is
// unbypassable.
const _rawTmuxSession = process.env.TMUX_SESSION || "claudes-world";
if (!SESSION_NAME_RE.test(_rawTmuxSession)) {
  throw new Error(
    `Invalid TMUX_SESSION name: ${JSON.stringify(_rawTmuxSession)}. ` +
      `Only alphanumerics, hyphens, underscores, and dots are allowed (max 64 chars).`,
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

export type TargetSessionResult =
  | { ok: true; session: string }
  | { ok: false; error: string };

/**
 * Resolve the optional `session` field of a terminal REST body (the
 * restricted command palette targets the session the terminal tab is
 * viewing — Liam voice msg 1188). Absent/empty = the configured
 * TMUX_SESSION, exactly today's behavior. Anything else is
 * client-controlled input and must pass the shared allowlist before it can
 * reach a tmux argv. Existence is the caller's concern (`tmux has-session`)
 * — this only fences type and charset.
 */
export function resolveTargetSession(raw: unknown): TargetSessionResult {
  if (raw === undefined || raw === null || raw === "") {
    return { ok: true, session: TMUX_SESSION };
  }
  if (typeof raw !== "string" || !SESSION_NAME_RE.test(raw)) {
    return { ok: false, error: "invalid session name" };
  }
  return { ok: true, session: raw };
}

/** True when the (already charset-validated) session exists on the tmux
 *  server. Exact-match `=` prefix — no prefix-matching surprises. */
export async function tmuxSessionExists(session: string): Promise<boolean> {
  try {
    await execFileAsync("tmux", ["has-session", "-t", `=${session}`], {
      timeout: TMUX_TIMEOUT_MS,
    });
    return true;
  } catch {
    return false;
  }
}

export async function sendToTmux(keys: string, session: string = TMUX_SESSION) {
  // The `--` separator stops tmux from interpreting `keys` as an option
  // if the first character is a hyphen. execFile already prevents shell
  // injection but this also prevents tmux-level argument confusion.
  //
  // Target form `=<name>:` — the `=` forces exact-match session lookup
  // (`session` may originate from a request body; exactness also protects
  // against prefix collisions between real session names), and the trailing
  // `:` is REQUIRED on pane-target commands: tmux 3.5a rejects a bare
  // `=name` for send-keys/capture-pane/display-message with "can't find
  // pane" (verified live on this host 2026-07-09); only session-target
  // commands like has-session accept `=name` alone.
  await execFileAsync("tmux", ["send-keys", "-t", `=${session}:`, "-l", "--", keys], {
    timeout: TMUX_TIMEOUT_MS,
  });
  await execFileAsync("tmux", ["send-keys", "-t", `=${session}:`, "Enter"], {
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
