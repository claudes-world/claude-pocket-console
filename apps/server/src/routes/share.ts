import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { Hono } from "hono";
import { ALLOWED_FILE_ROOTS, isPathAllowed } from "../lib/path-allowed.js";

const execFileAsync = promisify(execFile);

const PUBLISH_SHARED = "/home/claude/bin/publish-shared";
const DEFAULT_PUBLIC_BASE_URL = "https://shared.claude.do/public";
const DEFAULT_PRIVATE_BASE_URL = "https://shared.claude.do/private";

const app = new Hono();

app.post("/publish", async (c) => {
  try {
    const body = await c.req.json<{
      path?: unknown;
      scope?: unknown;
      tmp?: unknown;
    }>();

    if (typeof body.path !== "string" || !body.path) {
      return c.json({ ok: false, error: "path required" }, 400);
    }
    if (body.scope !== "public" && body.scope !== "private") {
      return c.json({ ok: false, error: "scope must be public or private" }, 400);
    }
    if (body.tmp !== undefined && typeof body.tmp !== "boolean") {
      return c.json({ ok: false, error: "tmp must be boolean" }, 400);
    }

    const resolvedPath = resolve(body.path);

    // Publishing makes file contents externally accessible, so every source
    // path must remain within the existing read allowlist.
    if (!(await isPathAllowed(resolvedPath, ALLOWED_FILE_ROOTS))) {
      return c.json({ ok: false, error: "path not allowed" }, 403);
    }
    if (!existsSync(resolvedPath)) {
      return c.json({ ok: false, error: "file not found" }, 404);
    }

    // A fixed executable and literal argv tokens keep user-controlled path
    // data out of shell parsing and prevent command substitution.
    const args = [
      ...(body.tmp ? ["--tmp"] : []),
      body.scope,
      resolvedPath,
    ];
    const { stdout } = await execFileAsync(PUBLISH_SHARED, args, {
      env: {
        ...process.env,
        SHARED_PUBLIC_BASE_URL:
          process.env.SHARED_PUBLIC_BASE_URL ?? DEFAULT_PUBLIC_BASE_URL,
        SHARED_PRIVATE_BASE_URL:
          process.env.SHARED_PRIVATE_BASE_URL ?? DEFAULT_PRIVATE_BASE_URL,
      },
      timeout: 30_000,
    });

    const output = stdout.toString();
    const url = output.match(/^URL: (.+)$/m)?.[1]?.trim();
    if (!url) {
      const tail = output.slice(-1_000).trim();
      throw new Error(`publish-shared returned no URL${tail ? `: ${tail}` : ""}`);
    }

    const destPath = output.match(/^Published: (.+)$/m)?.[1]?.trim();
    if (!destPath) {
      throw new Error("publish-shared returned no destination path");
    }

    return c.json({ ok: true, url, destPath });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500);
  }
});

export { app as shareRoute };
