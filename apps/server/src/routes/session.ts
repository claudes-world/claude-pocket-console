import { Hono } from "hono";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { SESSION_NAMES_FILE } from "./utils.js";

const app = new Hono();

app.post("/rename", async (c) => {
  try {
    const body = await c.req.json();
    const name = body.name as string;
    if (!name) return c.json({ ok: false, error: "name required" }, 400);

    // Add to session names file
    let names: { name: string; ts: number }[] = [];
    try {
      if (existsSync(SESSION_NAMES_FILE)) {
        names = JSON.parse(readFileSync(SESSION_NAMES_FILE, "utf-8"));
      }
    } catch { names = []; }

    // Add new entry at the top
    names.unshift({ name, ts: Date.now() });
    // Cap at 100 entries
    if (names.length > 100) names = names.slice(0, 100);
    writeFileSync(SESSION_NAMES_FILE, JSON.stringify(names, null, 2));

    return c.json({ ok: true, name });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500);
  }
});

app.get("/names", async (c) => {
  try {
    if (!existsSync(SESSION_NAMES_FILE)) {
      return c.json({ ok: true, names: [] });
    }
    const names = JSON.parse(readFileSync(SESSION_NAMES_FILE, "utf-8"));
    return c.json({ ok: true, names });
  } catch (err: any) {
    return c.json({ ok: true, names: [] });
  }
});

app.delete("/names", async (c) => {
  try {
    const body = await c.req.json();
    const ts = body.ts as number;
    if (!ts) return c.json({ ok: false, error: "ts required" }, 400);
    let names: { name: string; ts: number }[] = [];
    try {
      if (existsSync(SESSION_NAMES_FILE)) {
        names = JSON.parse(readFileSync(SESSION_NAMES_FILE, "utf-8"));
      }
    } catch { names = []; }
    const filtered = names.filter((n: { ts: number }) => n.ts !== ts);
    writeFileSync(SESSION_NAMES_FILE, JSON.stringify(filtered, null, 2));
    return c.json({ ok: true });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500);
  }
});

export { app as sessionRoute };
