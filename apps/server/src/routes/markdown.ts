import { Hono } from "hono";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { db } from "../db.js";
import { loadAnthropicEnv } from "./utils.js";

// Load Anthropic env on module init (no-op if file missing)
loadAnthropicEnv();

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
const ANTHROPIC_TIMEOUT_MS = 30_000;

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
const inflight = new Map<string, Promise<{ summary: string; inputTokens: number; outputTokens: number }>>();

type AnthropicResponse = {
  content?: Array<{ type: string; text?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { type?: string; message?: string };
};

async function callAnthropic(
  apiKey: string,
  content: string,
): Promise<{ summary: string; inputTokens: number; outputTokens: number }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ANTHROPIC_TIMEOUT_MS);
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 600,
        temperature: 0.3,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: `Summarize this document:\n\n<document>\n${content}\n</document>`,
          },
        ],
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errText = await res.text();
      let msg = `Anthropic API ${res.status}`;
      try {
        const parsed = JSON.parse(errText) as AnthropicResponse;
        if (parsed.error?.message) msg = `Anthropic: ${parsed.error.message}`;
      } catch {
        if (errText) msg = `Anthropic API ${res.status}: ${errText.slice(0, 200)}`;
      }
      const err = new Error(msg);
      (err as any).status = res.status;
      throw err;
    }

    const data = (await res.json()) as AnthropicResponse;
    // Pick the first text block defensively — Anthropic may return tool_use
    // or multi-block responses and data.content[0].text isn't guaranteed.
    const textBlock = data.content?.find((b) => b.type === "text" && typeof b.text === "string");
    if (!textBlock?.text) {
      throw new Error("Anthropic returned no text content");
    }
    return {
      summary: textBlock.text,
      inputTokens: data.usage?.input_tokens ?? 0,
      outputTokens: data.usage?.output_tokens ?? 0,
    };
  } finally {
    clearTimeout(timeout);
  }
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

  // API key check (configuration failure — 503, not 500)
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return c.json(
      { ok: false, error: "ANTHROPIC_API_KEY not set — add it to ~/.secrets/anthropic.env and restart cpc.service" },
      503,
    );
  }

  // In-flight dedupe
  let flight = inflight.get(cacheKey);
  if (!flight) {
    flight = callAnthropic(apiKey, content).finally(() => {
      // Clean up in finally to avoid leaking on rejection (Codex DA).
      inflight.delete(cacheKey);
    });
    inflight.set(cacheKey, flight);
  }

  try {
    const { summary, inputTokens, outputTokens } = await flight;

    // Persist to cache
    try {
      db.prepare(
        `INSERT OR REPLACE INTO tldr_cache
         (content_hash, prompt_version, model, summary, source_path, input_tokens, output_tokens, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(contentHash, PROMPT_VERSION, MODEL, summary, resolved, inputTokens, outputTokens, Date.now());
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
      inputTokens,
      outputTokens,
      ms: Date.now() - started,
    });
  } catch (err: any) {
    const status = err?.name === "AbortError" ? 504 : err?.status === 429 ? 429 : 502;
    const msg =
      err?.name === "AbortError"
        ? "Took too long — Claude may be slow right now"
        : err?.message || "Summarization failed";
    return c.json({ ok: false, error: msg }, status);
  }
});

export { app as markdownRoute };
