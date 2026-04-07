import { readFileSync } from "node:fs";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "@hono/node-server/serve-static";
import { serve } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import { telegramAuth } from "./middleware.js";
import { validateTelegramLoginWidget, createSession, getAllowedUsers } from "./auth.js";
import { terminalRoute } from "./routes/terminal/index.js";
import { sessionRoute } from "./routes/session.js";
import { todoRoute } from "./routes/todo.js";
import { audioRoute } from "./routes/audio.js";
import { telegramRoute } from "./routes/telegram.js";
import { terminalWsRoute } from "./routes/terminal-ws.js";
import { filesRoute } from "./routes/files.js";
import { voiceRoute } from "./routes/voice.js";
import { markdownRoute } from "./routes/markdown.js";

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

const app = new Hono();
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

app.use("*", cors());

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
  const allowed = getAllowedUsers();
  if (allowed.size > 0 && !allowed.has(String(user.id))) {
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

// WebSocket terminal (auth handled in upgrade via query param)
app.get("/ws/terminal", upgradeWebSocket(terminalWsRoute));

// Serve static frontend in production
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = dirname(fileURLToPath(import.meta.url));
const webDistRoot = join(__dirname, "../../web/dist");
app.use("/*", serveStatic({ root: webDistRoot }));

const port = parseInt(process.env.PORT || "38830");
const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`CPC server running on http://localhost:${info.port}`);
});

injectWebSocket(server);
