import { execFile } from "node:child_process";
import { createWriteStream, promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { Hono } from "hono";
import { ALLOWED_FILE_ROOTS, openAllowedForRead } from "../lib/path-allowed.js";

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

    const opened = await openAllowedForRead(resolvedPath, ALLOWED_FILE_ROOTS);
    if (!opened.ok) {
      if (opened.reason === "not-found") {
        return c.json({ ok: false, error: "file not found" }, 404);
      }
      if (opened.reason === "denied") {
        return c.json({ ok: false, error: "path not allowed" }, 403);
      }
      return c.json({ ok: false, error: "failed to open file" }, 500);
    }

    let stagingDir: string | undefined;
    let handleClosed = false;
    try {
      stagingDir = await fs.mkdtemp(join(tmpdir(), "cpc-share-"));
      const stagedPath = join(stagingDir, basename(resolvedPath));
      await pipeline(
        opened.handle.createReadStream({ autoClose: false }),
        createWriteStream(stagedPath),
      );
      await opened.handle.close();
      handleClosed = true;

      // A fixed executable and literal argv tokens keep user-controlled path
      // data out of shell parsing and prevent command substitution.
      const args = [
        ...(body.tmp ? ["--tmp"] : []),
        body.scope,
        stagedPath,
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
    } finally {
      if (!handleClosed) {
        await opened.handle.close().catch(() => undefined);
      }
      if (stagingDir) {
        await fs.rm(stagingDir, { recursive: true, force: true });
      }
    }
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500);
  }
});

export { app as shareRoute };
