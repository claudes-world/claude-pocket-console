import { readFileSync } from "node:fs";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "@hono/node-server/serve-static";
import { serve } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import { telegramAuth } from "./middleware.js";
import { terminalRoute } from "./routes/terminal/index.js";
import { sessionRoute } from "./routes/session.js";
import { todoRoute } from "./routes/todo.js";
import { audioRoute } from "./routes/audio.js";
import { telegramRoute } from "./routes/telegram.js";
import { terminalWsRoute } from "./routes/terminal-ws.js";
import { filesRoute } from "./routes/files.js";
import { voiceRoute } from "./routes/voice.js";

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

// WebSocket terminal (auth handled in upgrade via query param)
app.get("/ws/terminal", upgradeWebSocket(terminalWsRoute));

// Serve static frontend in production
app.use("/*", serveStatic({ root: "../web/dist" }));

const port = parseInt(process.env.PORT || "38830");
const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`CPC server running on http://localhost:${info.port}`);
});

injectWebSocket(server);
