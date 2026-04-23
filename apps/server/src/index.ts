import './lib/otel.js';
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { HttpBindings } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { serve } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import { telegramAuth } from "./middleware.js";
import { validateTelegramLoginWidget, createSession } from "./auth.js";
import { isAllowedUser } from "./lib/allowed-users.js";
import { ALLOWED_ORIGINS } from "./lib/allowed-origins.js";
import { registerDbSizeGauge, getTracer } from "./lib/otel.js";
import { propagation, context as otelContext, trace, SpanStatusCode } from "@opentelemetry/api";
import { DB_PATH } from "./db.js";
import { terminalRoute } from "./routes/terminal/index.js";
import { sessionRoute } from "./routes/session.js";
import { todoRoute } from "./routes/todo.js";
import { audioRoute } from "./routes/audio.js";
import { telegramRoute } from "./routes/telegram.js";
import { terminalWsRoute } from "./routes/terminal-ws.js";
import { filesRoute } from "./routes/files.js";
import { voiceRoute } from "./routes/voice.js";
import { markdownRoute } from "./routes/markdown.js";
import { readingListRoute } from "./routes/reading-list.js";
import { prsRoute } from "./routes/prs.js";
import { pulseRoute } from "./routes/pulse.js";

// Load env from secrets file if not already set
function loadEnv(path: string) {
  try {
    const content = readFileSync(path, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq);
      const val = trimmed.slice(eq + 1);
      if (!process.env[key]) process.env[key] = val;
    }
  } catch (e: any) {
    if (e.code !== "ENOENT") {
      console.error(`[loadEnv] Error reading ${path}:`, e.message);
    }
  }
}

loadEnv(`${process.env.HOME}/.secrets/cpc.env`);

// Register DB size gauge after env is loaded so DB_PATH is stable
registerDbSizeGauge(DB_PATH);

const app = new Hono<{ Bindings: HttpBindings }>();
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

app.use("*", cors({
  origin: [...ALLOWED_ORIGINS],
}));

// ── HTTP span middleware ───────────────────────────────────────────────────────
// Extract W3C traceparent from incoming headers, create a span per /api/* request.
// Must run before auth middleware so auth failures are still traced.
const httpTracer = getTracer('cpc-server-http');
app.use('/api/*', async (c, next) => {
  const headers: Record<string, string> = {};
  c.req.raw.headers.forEach((v, k) => { headers[k] = v; });
  const parentCtx = propagation.extract(otelContext.active(), headers);

  // Start with the middleware mount path as the route; we refine it after
  // next() runs, once Hono has resolved the matched handler. `c.req.routePath`
  // inside middleware returns the MIDDLEWARE's own pattern (`/api/*`), not the
  // matched handler's path — so we must wait until after next() and read the
  // matched-route metadata instead. See Hono docs on `matchedRoutes`.
  const span = httpTracer.startSpan(`${c.req.method} /api/*`, {
    attributes: { 'http.method': c.req.method },
  }, parentCtx);
  await otelContext.with(trace.setSpan(parentCtx, span), async () => {
    try {
      await next();
      // Resolve the matched handler's route after next() has returned.
      // Prefer the last entry in `matchedRoutes` that isn't this middleware's
      // own mount pattern; fall back to `routePath`, then `/api/*`.
      let matchedPath = '/api/*';
      try {
        // hono exposes `matchedRoutes` as an array of `{ path, method, handler }`.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const matched = (c.req as any).matchedRoutes as
          | Array<{ path: string; method?: string }>
          | undefined;
        if (Array.isArray(matched) && matched.length > 0) {
          // Walk from the end looking for a specific route (not a catch-all
          // middleware mount like `/api/*`). This covers the common case
          // where the matched application handler is the last entry.
          for (let i = matched.length - 1; i >= 0; i--) {
            const p = matched[i]?.path;
            if (p && !p.endsWith('/*')) { matchedPath = p; break; }
          }
          if (matchedPath === '/api/*') {
            // Fall back to the last matched path even if it's a wildcard.
            matchedPath = matched[matched.length - 1]?.path ?? matchedPath;
          }
        } else {
          matchedPath = c.req.routePath ?? matchedPath;
        }
      } catch {
        // Hono getter threw — keep the /api/* default rather than 500 the
        // request (defence-in-depth around a telemetry-only attribute).
      }
      span.setAttribute('http.route', matchedPath);
      span.updateName(`${c.req.method} ${matchedPath}`);
      span.setAttribute('http.status_code', c.res.status);
      if (c.res.status >= 500) span.setStatus({ code: SpanStatusCode.ERROR });
    } catch (err) {
      span.recordException(err instanceof Error ? err : String(err));
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw err;
    } finally {
      span.end();
    }
  });
});

// Public routes (no auth)
app.get("/api/public/health", (c) => c.json({ status: "ok" }));
app.get("/api/health", (c) => c.json({ status: "ok" })); // backward compat

// Public auth: Telegram Login Widget callback
app.post("/api/auth/telegram-widget", async (c) => {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) return c.json({ error: "Not configured" }, 500);

  const data = await c.req.json();
  const { valid, user } = validateTelegramLoginWidget(data, botToken);
  if (!valid || !user) return c.json({ error: "Invalid login" }, 401);

  // Check allowlist
  if (!isAllowedUser(user.id)) {
    return c.json({ error: "User not authorized" }, 403);
  }

  const token = createSession(user);
  return c.json({ ok: true, token, user: { id: user.id, first_name: user.first_name } });
});

// Auth middleware for all other /api/* routes
app.use("/api/*", telegramAuth);

// Protected routes
app.route("/api/terminal", terminalRoute);
app.route("/api/session", sessionRoute);
app.route("/api/todo", todoRoute);
app.route("/api/audio", audioRoute);
app.route("/api/telegram", telegramRoute);
app.route("/api/files", filesRoute);
app.route("/api/voice", voiceRoute);
app.route("/api/markdown", markdownRoute);
app.route("/api/reading-list", readingListRoute);
app.route("/api/prs", prsRoute);
app.route("/api/pulse", pulseRoute);

// WebSocket terminal (auth handled in upgrade via query param)
app.get("/ws/terminal", upgradeWebSocket(terminalWsRoute));

// Serve static frontend in production
const __dirname = dirname(fileURLToPath(import.meta.url));
const webDistRoot = join(__dirname, "../../web/dist");

const earlyHintsLinks: string[] = [];
try {
  const manifestPath = join(webDistRoot, ".vite/manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
  // Find the entry point (has isEntry: true)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const entry = Object.values(manifest).find((e: any) => e.isEntry) as any;
  if (entry) {
    if (entry.file) earlyHintsLinks.push(`</${entry.file}>; rel=preload; as=script; crossorigin`);
    for (const css of entry.css ?? []) {
      earlyHintsLinks.push(`</${css}>; rel=preload; as=style`);
    }
  }
  earlyHintsLinks.push("<https://telegram.org>; rel=preconnect");
} catch (e: any) {
  console.warn(`[earlyHints] Unable to read manifest: ${e.message}`);
}

app.use("/*", async (c, next) => {
  if (
    process.env.EARLY_HINTS !== "0" &&
    c.req.method === "GET" &&
    (c.req.header("accept") ?? "").includes("text/html") &&
    earlyHintsLinks.length > 0
  ) {
    try {
      c.env.outgoing.writeEarlyHints({ link: earlyHintsLinks });
    } catch {}
  }
  await next();
});

app.use("/*", serveStatic({ root: webDistRoot }));

const port = parseInt(process.env.PORT || "38830");
const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`CPC server running on http://localhost:${info.port}`);
});

injectWebSocket(server);
