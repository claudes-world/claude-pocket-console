import { Hono } from "hono";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const app = new Hono();

const SNAPSHOT_PATH = join(
  process.env.HOME ?? "/home/claude",
  ".world/pulse/snapshots/current.json"
);
const CACHE_TTL_MS = 60 * 1000;

let cachedSnapshot: unknown = null;
let cacheExpiresAt = 0;

app.get("/current", async (c) => {
  const now = Date.now();
  if (cachedSnapshot !== null && now < cacheExpiresAt) {
    return c.json(cachedSnapshot);
  }

  try {
    const raw = await readFile(SNAPSHOT_PATH, "utf-8");
    cachedSnapshot = JSON.parse(raw);
    cacheExpiresAt = now + CACHE_TTL_MS;
    return c.json(cachedSnapshot);
  } catch (err: any) {
    if (err?.code === "ENOENT") {
      return c.json({ error: "pulse snapshot not available" }, 503);
    }
    console.error("[pulse/current] read error:", err);
    return c.json({ error: "pulse snapshot not available" }, 503);
  }
});

export { app as pulseRoute };
