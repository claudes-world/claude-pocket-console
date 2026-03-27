import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import { terminalRoute } from "./routes/terminal.js";
import { actionsRoute } from "./routes/actions.js";

const app = new Hono();
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

app.use("*", cors());

// Health check
app.get("/api/health", (c) => c.json({ status: "ok" }));

// Action endpoints
app.route("/api/actions", actionsRoute);

// WebSocket terminal
app.get("/ws/terminal", upgradeWebSocket(terminalRoute));

const port = parseInt(process.env.PORT || "38830");
const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`CPC server running on http://localhost:${info.port}`);
});

injectWebSocket(server);
