import { spawn } from "node:child_process";
import { createWriteStream, promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { Hono } from "hono";
import { ALLOWED_FILE_ROOTS, openAllowedForRead } from "../lib/path-allowed.js";

const PUBLISH_SHARED = "/home/claude/bin/publish-shared";
const DEFAULT_PUBLIC_BASE_URL = "https://shared.claude.do/public";
const DEFAULT_PRIVATE_BASE_URL = "https://shared.claude.do/private";
const MAX_SHARE_BYTES = 50 * 1024 * 1024;
const RAW_MEDIA_EXTENSIONS = new Set([
  "avif", "bmp", "gif", "heic", "heif", "ico", "jpeg", "jpg", "jxl",
  "m4v", "m4a", "mov", "mp3", "mp4", "ogg", "oga", "ogv", "png",
  "svg", "tif", "tiff", "wav", "webm", "webp",
]);

function derivePublishSlug(path: string, now = new Date()): string {
  const name = basename(path);
  const lastDot = name.lastIndexOf(".");
  const stem = lastDot === -1 ? name : name.slice(0, lastDot);
  const pad = (value: number) => String(value).padStart(2, "0");
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  let slug = `${stem}-${stamp}`;

  const extension = lastDot === -1 ? "" : name.slice(lastDot + 1);
  if (
    extension &&
    RAW_MEDIA_EXTENSIONS.has(extension.toLowerCase()) &&
    !basename(slug).includes(".")
  ) {
    slug += `.${extension}`;
  }

  // publish-shared applies its own locale-aware space replacement and
  // [:alnum:] allowlist to explicit slugs, so leave sanitization to it.
  return slug;
}

function runPublishShared(
  args: string[],
  env: NodeJS.ProcessEnv,
  inheritedFd: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(PUBLISH_SHARED, args, {
      env,
      stdio: ["ignore", "pipe", "pipe", inheritedFd],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve(stdout);
    };
    const timeout = setTimeout(() => {
      child.kill();
      finish(new Error("publish-shared timed out"));
    }, 30_000);

    // These streams are present because stdout/stderr are configured as pipes.
    child.stdout!.setEncoding("utf8");
    child.stderr!.setEncoding("utf8");
    child.stdout!.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr!.on("data", (chunk: string) => { stderr += chunk; });
    child.once("error", (error) => finish(error));
    child.once("close", (code, signal) => {
      if (code === 0) finish();
      else finish(new Error(
        `publish-shared exited with ${code ?? signal ?? "unknown status"}: ${stderr}`,
      ));
    });
  });
}

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
    let stagedHandle: Awaited<ReturnType<typeof fs.open>> | undefined;
    let handleClosed = false;
    try {
      const stats = await opened.handle.stat();
      if (!stats.isFile()) {
        return c.json({ ok: false, error: "not a regular file" }, 400);
      }
      if (stats.size > MAX_SHARE_BYTES) {
        return c.json({ ok: false, error: "file too large" }, 413);
      }

      stagingDir = await fs.mkdtemp(join(tmpdir(), "cpc-share-"));
      const stagedPath = join(stagingDir, basename(resolvedPath));
      await pipeline(
        opened.handle.createReadStream({ autoClose: false }),
        createWriteStream(stagedPath),
      );
      await opened.handle.close();
      handleClosed = true;

      stagedHandle = await fs.open(stagedPath, "r");

      // A fixed executable and literal argv tokens keep user-controlled path
      // data out of shell parsing and prevent command substitution. Passing an
      // inherited descriptor also prevents a same-UID process from swapping the
      // staged path before publish-shared opens it.
      const args = [
        ...(body.tmp ? ["--tmp"] : []),
        body.scope,
        "/dev/fd/3",
        derivePublishSlug(resolvedPath),
      ];
      const stdout = await runPublishShared(
        args,
        {
          ...process.env,
          SHARED_PUBLIC_BASE_URL:
            process.env.SHARED_PUBLIC_BASE_URL ?? DEFAULT_PUBLIC_BASE_URL,
          SHARED_PRIVATE_BASE_URL:
            process.env.SHARED_PRIVATE_BASE_URL ?? DEFAULT_PRIVATE_BASE_URL,
        },
        stagedHandle.fd,
      );

      const output = stdout.toString();
      const url = output.match(/^URL: (.+)$/m)?.[1]?.trim();
      if (!url) {
        const tail = output.slice(-1_000).trim();
        console.error("publish-shared returned no URL", { stdoutTail: tail });
        throw new Error("publish-shared returned no URL");
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
      if (stagedHandle) {
        await stagedHandle.close().catch(() => undefined);
      }
      if (stagingDir) {
        await fs.rm(stagingDir, { recursive: true, force: true });
      }
    }
  } catch (err) {
    console.error("Failed to publish shared file:", err);
    return c.json({ ok: false, error: "publish failed" }, 500);
  }
});

export { app as shareRoute };
