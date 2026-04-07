import { Hono } from "hono";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { db } from "../db.js";

const app = new Hono();

// Allowed root directories — kept in sync with files.ts. Intentionally
// duplicated instead of refactored to utils.ts to avoid cross-file blast
// radius on this PR; a follow-up can centralize.
const ALLOWED_ROOTS = [
  "/home/claude/claudes-world",
  "/home/claude/code",
  "/home/claude/bin",
  "/home/claude/.claude",
  "/home/claude/claudes-world/.claude",
];

function isPathAllowed(absPath: string): boolean {
  const resolved = resolve(absPath);
  return ALLOWED_ROOTS.some((root) => resolved.startsWith(root));
}

const MAX_BYTES = parseInt(process.env.CPC_TLDR_MAX_BYTES || "512000", 10);
const MODEL = process.env.CPC_TLDR_MODEL || "claude-haiku-4-5";
const PROMPT_VERSION = parseInt(process.env.CPC_TLDR_PROMPT_VERSION || "1", 10);
const CLAUDE_TIMEOUT_MS = 60_000;
const CLAUDE_BIN = process.env.CPC_CLAUDE_BIN || "claude";

const SYSTEM_PROMPT = `You are a precise, ruthless summarizer of long-form documents for a busy mobile reader who needs the gist in 30 seconds before deciding whether to read the whole thing. Your output must be skim-optimized markdown.

The user is on a phone. Be concrete. No throat-clearing, no "this document discusses..." filler, no headings beyond the four required sections below.

Output exactly these four sections, in this order, as markdown:

## TL;DR
One or two sentences. Plain English. State the single most important thing the reader should know.

## Key takeaways
Three to five bullets. Each bullet is one sentence. Each bullet states a fact, decision, or finding — not a description of what the document does.

## If you only read N things, read these
Replace N with a number between 2 and 4. List the most important sections, files, or links to jump to. Use the document's own headings verbatim when possible. Half-line reason for each.

## Decisions / actions needed
List anything that requires the reader to do something. If nothing, write: "None — informational only."

# Special handling rules

1. If the document is fewer than ~200 words, do not produce a TL;DR. Output exactly: "Document is already short — read it directly (~X words)."

2. If the document is itself already a summary/scrum/briefing/digest, extract 3-5 key sentences verbatim (with quotes) instead of summarizing.

3. If the document is code/config/non-prose, output: "Not summarizable — this looks like a reference document, not prose."

4. Never invent. If no decisions exist, say "None — informational only."

5. Preserve relevant markdown links from the source.

6. Do not include the document's title (UI shows it).

7. Total output budget: 250 words or less.`;

// In-flight dedupe — collapses simultaneous taps on the same doc into one call.
// Keyed by cache tuple to match lookup semantics.
const inflight = new Map<string, Promise<{ summary: string }>>();

/**
 * Shell out to the Claude Code CLI to summarize the document.
 *
 * Why CLI instead of the Anthropic HTTP API:
 * - Uses the host's existing Claude Max OAuth (no API key, no $ per call)
 * - Same pattern md-speak uses for its table-mode AI decision
 * - Removes the ANTHROPIC_API_KEY config requirement entirely
 *
 * Mode notes:
 * - `-p` (--print) is non-interactive: read prompt from argv/stdin, write
 *   the model's reply to stdout, exit
 * - `--model claude-haiku-4-5` selects the cheapest fast model
 * - `--append-system-prompt` injects our summarizer system prompt
 * - We do NOT use `--bare` because that mode strictly requires
 *   ANTHROPIC_API_KEY and bypasses the OAuth keychain — defeating the
 *   whole point of this rewrite
 * - Document content goes to stdin so we don't hit argv length limits
 *   on large markdown files
 */
async function callClaudeCli(content: string): Promise<{ summary: string }> {
  return new Promise((resolveCall, rejectCall) => {
    const args = [
      "-p",
      "--model",
      MODEL,
      "--append-system-prompt",
      SYSTEM_PROMPT,
    ];

    const proc = spawn(CLAUDE_BIN, args, {
      stdio: ["pipe", "pipe", "pipe"],
      // Inherit environment so the CLI can find its OAuth/keychain
      env: process.env,
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        proc.kill("SIGTERM");
      } catch {
        // ignore
      }
      const err: Error & { name?: string } = new Error("claude CLI timed out");
      err.name = "AbortError";
      rejectCall(err);
    }, CLAUDE_TIMEOUT_MS);

    proc.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf-8");
    });
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf-8");
    });

    proc.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      rejectCall(
        new Error(
          `Failed to spawn claude CLI (${CLAUDE_BIN}): ${err.message}`,
        ),
      );
    });

    proc.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (code !== 0) {
        rejectCall(
          new Error(
            `claude CLI exited ${code}: ${stderr.slice(0, 200) || "(no stderr)"}`,
          ),
        );
        return;
      }
      const summary = stdout.trim();
      if (!summary) {
        rejectCall(new Error("claude CLI returned empty output"));
        return;
      }
      resolveCall({ summary });
    });

    // Stream the document content into stdin and close.
    proc.stdin.write(`Summarize this document:\n\n<document>\n${content}\n</document>\n`);
    proc.stdin.end();
  });
}

app.post("/summarize", async (c) => {
  const started = Date.now();
  let body: { path?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: "Invalid JSON body" }, 400);
  }

  const rawPath = typeof body.path === "string" ? body.path : "";
  if (!rawPath) {
    return c.json({ ok: false, error: "path required" }, 400);
  }

  const resolved = resolve(rawPath);
  if (!isPathAllowed(resolved)) {
    return c.json({ ok: false, error: "Access denied" }, 403);
  }
  if (!resolved.toLowerCase().endsWith(".md")) {
    return c.json({ ok: false, error: "Only .md files are supported" }, 400);
  }

  let st;
  try {
    st = await stat(resolved);
  } catch {
    return c.json({ ok: false, error: "File not found" }, 404);
  }
  if (!st.isFile()) {
    return c.json({ ok: false, error: "Not a file" }, 400);
  }
  if (st.size > MAX_BYTES) {
    return c.json(
      { ok: false, error: `File too large for TL;DR (max ${Math.round(MAX_BYTES / 1024)}KB)` },
      413,
    );
  }

  let content: string;
  try {
    content = await readFile(resolved, "utf-8");
  } catch (err: any) {
    return c.json({ ok: false, error: `Read failed: ${err.message}` }, 500);
  }
  if (!content.trim()) {
    return c.json({ ok: false, error: "File is empty" }, 400);
  }

  // Content-addressed cache key including prompt_version + model so prompt
  // or model bumps naturally invalidate without manual cache busting.
  const contentHash = createHash("sha256").update(content).digest("hex");
  const cacheKey = `${contentHash}:${PROMPT_VERSION}:${MODEL}`;

  // Cache lookup
  const cached = db
    .prepare(
      `SELECT summary FROM tldr_cache WHERE content_hash = ? AND prompt_version = ? AND model = ?`,
    )
    .get(contentHash, PROMPT_VERSION, MODEL) as { summary: string } | undefined;

  if (cached) {
    return c.json({
      ok: true,
      summary: cached.summary,
      cached: true,
      model: MODEL,
      promptVersion: PROMPT_VERSION,
      ms: Date.now() - started,
    });
  }

  // In-flight dedupe — collapse simultaneous taps on the same doc.
  let flight = inflight.get(cacheKey);
  if (!flight) {
    flight = callClaudeCli(content).finally(() => {
      // Clean up in finally to avoid leaking on rejection (Codex DA).
      inflight.delete(cacheKey);
    });
    inflight.set(cacheKey, flight);
  }

  try {
    const { summary } = await flight;

    // Persist to cache. input_tokens/output_tokens are not exposed by
    // the CLI surface so we record 0 — kept in the schema for forward
    // compat with a possible future direct-API path.
    try {
      db.prepare(
        `INSERT OR REPLACE INTO tldr_cache
         (content_hash, prompt_version, model, summary, source_path, input_tokens, output_tokens, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(contentHash, PROMPT_VERSION, MODEL, summary, resolved, 0, 0, Date.now());
    } catch (err: any) {
      console.error("[markdown/summarize] cache write failed:", err.message);
      // Non-fatal — return the summary anyway.
    }

    return c.json({
      ok: true,
      summary,
      cached: false,
      model: MODEL,
      promptVersion: PROMPT_VERSION,
      ms: Date.now() - started,
    });
  } catch (err: any) {
    const status = err?.name === "AbortError" ? 504 : 502;
    const msg =
      err?.name === "AbortError"
        ? "Took too long — Claude may be slow right now"
        : err?.message || "Summarization failed";
    return c.json({ ok: false, error: msg }, status);
  }
});

export { app as markdownRoute };
