import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { randomBytes } from "node:crypto";
import {
  open,
  readdir,
  readFile,
  stat,
  unlink,
} from "node:fs/promises";
import { createReadStream } from "node:fs";
import { basename, join, resolve, sep } from "node:path";
import { constants as fsConstants } from "node:fs";
import { Readable } from "node:stream";
import {
  ALLOWED_FILE_ROOTS,
  isPathAllowed as isPathAllowedShared,
} from "../lib/path-allowed.js";

const app = new Hono();

const BASE_DIR = process.env.FILES_BASE_DIR || "/home/claude/claudes-world";
const DOWNLOAD_MAX_BYTES = 50 * 1024 * 1024;
const UPLOAD_BODY_LIMIT = 50 * 1024 * 1024;
const UPLOAD_BODY_LIMIT_MB = UPLOAD_BODY_LIMIT / (1024 * 1024);
const DOWNLOAD_TICKET_TTL_MS = 60 * 1000;

type DownloadTicket = {
  path: string;
  expiresAt: number;
  used: boolean;
};

const downloadTickets = new Map<string, DownloadTicket>();

function isPathAllowed(absPath: string): Promise<boolean> {
  return isPathAllowedShared(absPath, ALLOWED_FILE_ROOTS);
}

function pruneExpiredDownloadTickets(now = Date.now()) {
  for (const [ticket, record] of downloadTickets) {
    if (record.expiresAt <= now) {
      downloadTickets.delete(ticket);
    }
  }
}

async function getDownloadableFile(filePath: string): Promise<
  | { ok: true; path: string; size: number; name: string }
  | { ok: false; status: 400 | 403 | 404 | 413 | 500; error: string }
> {
  const resolved = resolve(filePath);
  if (!await isPathAllowed(resolved)) {
    return { ok: false, status: 403, error: "Access denied" };
  }

  try {
    const st = await stat(resolved);
    if (!st.isFile()) {
      return { ok: false, status: 400, error: "Not a file" };
    }

    if (st.size > DOWNLOAD_MAX_BYTES) {
      return { ok: false, status: 413, error: `File too large (max ${DOWNLOAD_MAX_BYTES / (1024 * 1024)}MB)` };
    }

    return {
      ok: true,
      path: resolved,
      size: st.size,
      name: basename(resolved) || "file",
    };
  } catch (err: any) {
    if (err?.code === "ENOENT") {
      return { ok: false, status: 404, error: "File not found" };
    }
    console.error("[files/download] stat error:", err);
    return { ok: false, status: 500, error: "Failed to read file" };
  }
}

function createDownloadResponse(file: { path: string; size: number; name: string }) {
  const encodedName = encodeURIComponent(file.name);
  const safeName = file.name.replace(/["\r\n]/g, "") || "file";
  const body = Readable.toWeb(createReadStream(file.path)) as unknown as BodyInit;

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(file.size),
      "Content-Disposition": `attachment; filename="${safeName}"; filename*=UTF-8''${encodedName}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
    },
  });
}

/**
 * Sanitize a user-supplied filename. Returns null if the name is unsafe.
 * Accepts dotfiles (e.g. .gitignore) but rejects the literal "." and "..",
 * slashes, control chars, null bytes, reserved names, and empty/long names.
 */
function sanitizeFilename(raw: string): string | null {
  if (typeof raw !== "string") return null;
  // Strip control chars (0x00-0x1f, 0x7f) and trim
  let cleaned = raw.replace(/[\x00-\x1f\x7f]/g, "").trim();
  // Collapse trailing dots and spaces (Windows/fat32 footgun + hidden extension tricks)
  cleaned = cleaned.replace(/[. ]+$/, "");
  if (cleaned.length === 0 || cleaned.length > 255) return null;
  if (cleaned.includes("/") || cleaned.includes("\\")) return null;
  if (cleaned === "." || cleaned === "..") return null;
  // Windows reserved names (we're Linux, but files may be transferred/shared)
  const WIN_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
  if (WIN_RESERVED.test(cleaned)) return null;
  return cleaned;
}

// List available root directories
app.get("/roots", (c) => {
  return c.json({
    roots: ALLOWED_FILE_ROOTS.map((r) => ({
      path: r,
      name: r.replace("/home/claude/", "~/"),
    })),
  });
});

// List directory contents
app.get("/list", async (c) => {
  const dir = c.req.query("path") || BASE_DIR;
  const resolved = resolve(dir);

  if (!await isPathAllowed(resolved)) {
    return c.json({ error: "Access denied" }, 403);
  }

  try {
    const entries = await readdir(resolved, { withFileTypes: true });
    const items = await Promise.all(
      entries
        .filter((e) => {
          // Always show dotfiles if ?hidden=1 or inside a dotfile root
          const showHidden = c.req.query("hidden") === "1";
          if (showHidden || resolved.includes("/.")) return true;
          return !e.name.startsWith(".");
        })
        .map(async (e) => {
          const fullPath = join(resolved, e.name);
          try {
            const st = await stat(fullPath);
            return {
              name: e.name,
              path: fullPath,
              type: e.isDirectory() ? "dir" : "file",
              size: st.size,
              modified: st.mtime.toISOString(),
            };
          } catch {
            return {
              name: e.name,
              path: fullPath,
              type: e.isDirectory() ? "dir" : "file",
              size: 0,
              modified: "",
            };
          }
        }),
    );

    // Sort: dirs first, then alphabetical
    items.sort((a, b) => {
      if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    // Return parent: null ONLY if `resolve(resolved, "..")` is itself
    // NOT allowed. Using `ALLOWED_FILE_ROOTS.includes(resolved)` would break
    // nested allowed roots — e.g. if both /a/b and /a/b/c are in the
    // list, a user at /a/b/c could see `parent: null` and be unable to
    // navigate up to /a/b even though that path is allowed. Use the
    // same `isPathAllowed` check that gates the request itself, which
    // canonicalizes via realpath and handles symlinks consistently.
    const candidateParent = resolve(resolved, "..");
    const parentAllowed = await isPathAllowed(candidateParent);
    return c.json({
      path: resolved,
      parent: parentAllowed ? candidateParent : null,
      items,
    });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// Read file contents
app.get("/read", async (c) => {
  const filePath = c.req.query("path");
  if (!filePath) {
    return c.json({ error: "path parameter required" }, 400);
  }

  const resolved = resolve(filePath);
  if (!await isPathAllowed(resolved)) {
    return c.json({ error: "Access denied" }, 403);
  }

  try {
    const st = await stat(resolved);

    // Don't read files larger than 1MB
    if (st.size > 1024 * 1024) {
      return c.json({ error: "File too large (max 1MB)" }, 413);
    }

    // Don't read binary files
    const ext = resolved.split(".").pop()?.toLowerCase() || "";
    const textExts = new Set([
      "md", "txt", "ts", "tsx", "js", "jsx", "json", "yaml", "yml",
      "toml", "css", "html", "svg", "sh", "bash", "zsh", "py",
      "rs", "go", "env", "conf", "cfg", "ini", "xml", "sql",
      "dockerfile", "gitignore", "editorconfig", "prettierrc",
      "eslintrc", "lock",
    ]);
    const baseName = resolved.split("/").pop()?.toLowerCase() || "";
    const isText = textExts.has(ext) ||
      ["makefile", "dockerfile", "caddyfile", "gemfile", "rakefile",
       "license", "readme", "changelog", "agents", "claude"].some(
        (n) => baseName.startsWith(n),
      );

    if (!isText && st.size > 0) {
      // Try reading first 512 bytes to check for binary
      const content = await readFile(resolved);
      const sample = content.subarray(0, 512);
      if (sample.includes(0)) {
        return c.json({ error: "Binary file" }, 415);
      }
      return c.json({
        path: resolved,
        name: baseName,
        content: content.toString("utf-8"),
        size: st.size,
        modified: st.mtime.toISOString(),
      });
    }

    const content = await readFile(resolved, "utf-8");
    return c.json({
      path: resolved,
      name: baseName,
      content,
      size: st.size,
      modified: st.mtime.toISOString(),
    });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// Download file (raw bytes, preserves binary content)
app.post("/download-ticket", async (c) => {
  pruneExpiredDownloadTickets();

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  if (!body || typeof body !== "object" || typeof (body as { path?: unknown }).path !== "string") {
    return c.json({ error: "path required" }, 400);
  }

  const file = await getDownloadableFile((body as { path: string }).path);
  if (!file.ok) {
    return c.json({ error: file.error }, file.status);
  }

  const ticket = randomBytes(16).toString("hex");
  downloadTickets.set(ticket, {
    path: file.path,
    expiresAt: Date.now() + DOWNLOAD_TICKET_TTL_MS,
    used: false,
  });

  return c.json({ ticket });
});

app.get("/download", async (c) => {
  const ticket = c.req.query("ticket");
  if (ticket) {
    // Pruning happens in the POST handler so the map doesn't grow unbounded;
    // the per-request expiry check below handles correctness on GET.
    const record = downloadTickets.get(ticket);
    if (!record || record.used || record.expiresAt <= Date.now()) {
      return c.json({ error: "invalid or expired ticket" }, 403);
    }

    // Claim the ticket synchronously (before any await) so two concurrent
    // GETs can't both pass the `record.used` check and both receive the file.
    // If the subsequent file validation fails we undo the claim so the user
    // can retry with the same ticket.
    record.used = true;

    const file = await getDownloadableFile(record.path);
    if (!file.ok) {
      // Undo claim on file-not-available so the caller can retry.
      record.used = false;
      return c.json({ error: file.error }, file.status);
    }

    return createDownloadResponse(file);
  }

  const filePath = c.req.query("path");
  if (!filePath) {
    return c.json({ error: "path parameter required" }, 400);
  }

  const file = await getDownloadableFile(filePath);
  if (!file.ok) {
    return c.json({ error: file.error }, file.status);
  }

  return createDownloadResponse(file);
});

// Fuzzy file/path search — BFS across all allowed roots.
//
// Optional `scope` query param narrows the walk to a single folder (Search
// UX C3: the "current folder only" toggle in the file-search sheet). The
// scope is subjected to the same `isPathAllowed` check as every other file
// route so a client can't pass `../../etc` and escape the allowlist. When
// present we seed the BFS queue with just that folder instead of every
// allowed root, which is faster AND avoids results leaking in from siblings.
app.get("/search", async (c) => {
  const qRaw = c.req.query("q")?.toLowerCase() || "";
  if (qRaw.length < 2) return c.json({ results: [] });
  const q = qRaw;

  const scopeRaw = c.req.query("scope");
  let roots: readonly string[] = ALLOWED_FILE_ROOTS;
  if (scopeRaw) {
    const scopeResolved = resolve(scopeRaw);
    // Reject scopes that aren't inside an allowed root. Same check as every
    // other file route — realpath-canonicalizing both sides and enforcing a
    // true path-segment boundary — so a symlink escape or sibling-prefix
    // bypass can't smuggle an out-of-tree path in via `?scope=`.
    if (!(await isPathAllowed(scopeResolved))) {
      return c.json({ error: "Access denied" }, 403);
    }
    roots = [scopeResolved];
  }

  const results: { name: string; path: string; type: string; relPath: string }[] = [];
  const MAX = 25;

  // BFS queue: [dirPath, depth]
  const queue: [string, number][] = roots.map((r) => [r, 0]);

  // Pre-compute the scope prefix (with trailing separator so we get a true
  // path-segment boundary and `/a/b-evil` can't match scope `/a/b`). The
  // scope itself is also a valid match, so we check for equality separately.
  const scopeMatchRoot = scopeRaw ? resolve(scopeRaw) : null;
  const scopeMatchPrefix = scopeMatchRoot
    ? (scopeMatchRoot.endsWith(sep) ? scopeMatchRoot : scopeMatchRoot + sep)
    : null;

  while (queue.length > 0 && results.length < MAX) {
    const [dir, depth] = queue.shift()!;
    if (depth > 8) continue;
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const e of entries) {
        if (results.length >= MAX) break;
        if (e.name.startsWith(".") && !e.name.startsWith(".claude")) continue;
        const full = join(dir, e.name);
        const relPath = full.replace("/home/claude/", "~/");
        // Defence in depth: even though the BFS is seeded from the scope
        // root, also drop anything whose path doesn't start with the scope
        // (with a trailing-separator boundary). A compromised readdir or
        // weird symlink can't then leak siblings into a scoped query.
        const inScope = scopeMatchPrefix === null
          || full === scopeMatchRoot
          || full.startsWith(scopeMatchPrefix);
        // Match against filename OR relative path (supports partial paths)
        if (inScope && (e.name.toLowerCase().includes(q) || relPath.toLowerCase().includes(q))) {
          results.push({
            name: e.name,
            path: full,
            type: e.isDirectory() ? "dir" : "file",
            relPath,
          });
        }
        if (e.isDirectory()) queue.push([full, depth + 1]);
      }
    } catch { /* skip inaccessible dirs */ }
  }

  return c.json({ results });
});

// Upload file to current directory
app.post(
  "/upload",
  bodyLimit({
    maxSize: UPLOAD_BODY_LIMIT,
    onError: (c) =>
      c.json(
        { error: `Request body too large (max ${UPLOAD_BODY_LIMIT_MB}MB)` },
        413,
      ),
  }),
  async (c) => {
  const body = await c.req.parseBody();
  const file = body["file"];
  const dir = (body["dir"] as string) || BASE_DIR;

  if (!file || typeof file === "string") {
    return c.json({ error: "No file provided" }, 400);
  }

  const resolved = resolve(dir);
  if (!await isPathAllowed(resolved)) {
    return c.json({ error: "Access denied" }, 403);
  }

  try {
    // Strip directory components then run through sanitizeFilename() which
    // additionally rejects control characters, null bytes, reserved Windows
    // names, and other dangerous patterns. basename() is applied first so
    // sanitizeFilename() never sees a slash-separated path.
    const rawName = basename((file as File).name || "uploaded-file");
    const sanitized = sanitizeFilename(rawName);
    let fileName = sanitized ?? "uploaded-file";
    const arrayBuffer = await (file as File).arrayBuffer();
    const data = Buffer.from(arrayBuffer);

    // Atomic exclusive create with O_NOFOLLOW to defeat both:
    // (a) TOCTOU race (stat-then-write where two concurrent uploads pick the
    //     same suffix), and
    // (b) symlink-redirected writes (a symlink inside an allowed dir pointing
    //     outside the allowed root would trick the write into landing outside
    //     ALLOWED_FILE_ROOTS).
    //
    // Verify the target directory exists before attempting writes. If it
    // doesn't, open() would throw ENOENT which would surface as a generic 500.
    try {
      const dirStat = await stat(resolved);
      if (!dirStat.isDirectory()) {
        return c.json({ error: "Target path is not a directory" }, 400);
      }
    } catch (err: any) {
      if (err && err.code === "ENOENT") {
        return c.json({ error: "Target directory does not exist" }, 404);
      }
      throw err;
    }

    // Try the chosen filename, then incrementing suffixes until O_EXCL
    // succeeds or we give up.
    const dotIdx = fileName.lastIndexOf(".");
    const hasExt = dotIdx > 0;
    const base = hasExt ? fileName.slice(0, dotIdx) : fileName;
    const ext = hasExt ? fileName.slice(dotIdx) : "";

    let finalPath = "";
    for (let counter = 0; counter <= 9999; counter++) {
      const candidate =
        counter === 0
          ? join(resolved, fileName)
          : join(resolved, `${base}-${counter}${ext}`);
      let opened = false;
      try {
        const handle = await open(
          candidate,
          fsConstants.O_WRONLY |
            fsConstants.O_CREAT |
            fsConstants.O_EXCL |
            fsConstants.O_NOFOLLOW,
          0o644,
        );
        opened = true;
        try {
          await handle.writeFile(data);
        } finally {
          await handle.close();
        }
        finalPath = candidate;
        break;
      } catch (err: any) {
        if (err && err.code === "EEXIST") continue;
        if (err && (err.code === "ELOOP" || err.code === "EMLINK")) {
          return c.json(
            { error: "Refusing to write through symlink" },
            403,
          );
        }
        if (opened) {
          try {
            await unlink(candidate);
          } catch {
            // ignore — already gone or unlink not allowed
          }
        }
        throw err;
      }
    }
    if (!finalPath) {
      throw new Error("Could not find available filename");
    }

    return c.json({
      ok: true,
      name: basename(finalPath),
      size: arrayBuffer.byteLength,
    });
  } catch (err: any) {
    console.error("[files/upload] write error:", err);
    return c.json({ error: "Failed to write file" }, 500);
  }
  },
);

// Paste text content into the current directory as a new file.
// JSON body: { filename: string, content: string, dir: string }
// 1MB cap, line endings normalized, filename sanitized, never overwrites.
//
// Hono's bodyLimit middleware rejects oversized bodies at the streaming
// layer BEFORE json() buffers them, so chunked requests or missing
// Content-Length headers can't exhaust server memory. The 2 MB wire
// cap allows for JSON wrapping + escaping overhead on top of the 1 MB
// inner content cap checked below after parse.
const PASTE_BODY_LIMIT = 2 * 1024 * 1024;
app.post(
  "/paste",
  bodyLimit({
    maxSize: PASTE_BODY_LIMIT,
    onError: (c) =>
      c.json(
        { error: "Request body too large (max 2MB wire / 1MB content)" },
        413,
      ),
  }),
  async (c) => {
  // Narrow catch: let BodyLimitError from the streaming middleware propagate
  // so Hono's onError handler returns the configured 413. A blanket .catch
  // would swallow it and mis-classify oversized bodies as 400.
  let body: unknown;
  try {
    body = await c.req.json();
  } catch (err) {
    if (
      err &&
      typeof err === "object" &&
      "name" in err &&
      (err as { name?: unknown }).name === "BodyLimitError"
    ) {
      throw err;
    }
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  if (!body || typeof body !== "object") {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  const { filename, content, dir } = body as {
    filename?: unknown;
    content?: unknown;
    dir?: unknown;
  };

  if (typeof content !== "string") {
    return c.json({ error: "content required (string)" }, 400);
  }
  if (typeof filename !== "string") {
    return c.json({ error: "filename required (string)" }, 400);
  }
  if (typeof dir !== "string") {
    return c.json({ error: "dir required (string)" }, 400);
  }
  if (content.length === 0) {
    return c.json({ error: "content is empty" }, 400);
  }

  // 1 MB cap (matches /read). JSON.stringify already decoded the string,
  // so we measure the UTF-8 byte length of the actual content.
  const byteLength = Buffer.byteLength(content, "utf-8");
  if (byteLength > 1024 * 1024) {
    return c.json({ error: "Content too large (max 1MB)" }, 413);
  }

  const cleanName = sanitizeFilename(filename);
  if (!cleanName) {
    return c.json({ error: "Invalid filename" }, 400);
  }

  const resolved = resolve(dir);
  if (!(await isPathAllowed(resolved))) {
    return c.json({ error: "Access denied" }, 403);
  }

  // Destination must exist and be a directory. We do NOT auto-create.
  try {
    const st = await stat(resolved);
    if (!st.isDirectory()) {
      return c.json({ error: "Destination is not a directory" }, 400);
    }
  } catch {
    return c.json({ error: "Destination directory does not exist" }, 404);
  }

  // Normalize line endings: CRLF and lone CR both become LF.
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  try {
    // Atomic exclusive create with O_NOFOLLOW to defeat both:
    // (a) the TOCTOU race in pickAvailablePath (stat-then-write window where
    //     two concurrent callers pick the same suffix), and
    // (b) symlink-redirected writes (an attacker placing a symlink inside
    //     an allowed dir that points outside the allowed root would otherwise
    //     trick the write into landing outside ALLOWED_FILE_ROOTS).
    //
    // Try the chosen filename, then incrementing suffixes until O_EXCL
    // succeeds or we give up.
    const dotIdx = cleanName.lastIndexOf(".");
    const hasExt = dotIdx > 0;
    const base = hasExt ? cleanName.slice(0, dotIdx) : cleanName;
    const ext = hasExt ? cleanName.slice(dotIdx) : "";

    let finalPath = "";
    for (let counter = 0; counter <= 9999; counter++) {
      const candidate =
        counter === 0
          ? join(resolved, cleanName)
          : join(resolved, `${base}-${counter}${ext}`);
      let opened = false;
      try {
        const handle = await open(
          candidate,
          fsConstants.O_WRONLY |
            fsConstants.O_CREAT |
            fsConstants.O_EXCL |
            fsConstants.O_NOFOLLOW,
          0o644,
        );
        opened = true;
        try {
          await handle.writeFile(normalized, "utf-8");
        } finally {
          await handle.close();
        }
        finalPath = candidate;
        break;
      } catch (err: any) {
        // EEXIST → file already exists at this suffix, try next.
        // ELOOP / EMLINK → candidate path is a symlink; reject the upload
        //                 entirely instead of silently picking another name.
        if (err && err.code === "EEXIST") continue;
        if (err && (err.code === "ELOOP" || err.code === "EMLINK")) {
          return c.json(
            { error: "Refusing to write through symlink" },
            403,
          );
        }
        // If `open` succeeded but `writeFile`/`close` failed, the file
        // exists on disk as an empty or partial write. Clean it up so
        // we don't leave debris in the user's directory. Best-effort
        // unlink; ignore failures (file might already be gone).
        if (opened) {
          try {
            await unlink(candidate);
          } catch {
            // ignore — already gone or unlink not allowed
          }
        }
        throw err;
      }
    }
    if (!finalPath) {
      throw new Error("Could not find available filename");
    }

    // Don't leak the absolute path back to the client (Gemini security-
    // medium review flagged this as info disclosure). The basename is
    // sufficient for the UI to show "saved as foo-2.md"; the directory
    // is whatever the user already typed in the dir field.
    return c.json({
      ok: true,
      name: basename(finalPath),
      size: Buffer.byteLength(normalized, "utf-8"),
    });
  } catch (err: any) {
    // Log full error server-side for debugging but DON'T leak raw fs error
    // text (paths, errno codes) to clients. Gemini security-medium review
    // flagged this as an info-disclosure surface.
    console.error("[files/paste] write error:", err);
    return c.json({ error: "Failed to write file" }, 500);
  }
  },
);

export { app as filesRoute };
