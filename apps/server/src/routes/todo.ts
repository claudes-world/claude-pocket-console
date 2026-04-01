import { Hono } from "hono";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { CLAUDES_WORLD } from "./utils.js";

const app = new Hono();

app.get("/", async (c) => {
  try {
    const todoPath = join(CLAUDES_WORLD, "TODO.md");
    if (!existsSync(todoPath)) {
      return c.json({ ok: true, content: "No TODO.md found" });
    }
    const content = readFileSync(todoPath, "utf-8");
    return c.json({ ok: true, content });
  } catch (err: any) {
    return c.json({ ok: false, content: `Error: ${err.message}` });
  }
});

export { app as todoRoute };
