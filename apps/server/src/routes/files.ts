import { Hono } from "hono";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const app = new Hono();

const BASE_DIR = process.env.FILES_BASE_DIR || "/home/claude/claudes-world";

// Allowed root directories the file viewer can access
const ALLOWED_ROOTS = [
  "/home/claude/claudes-world",
  "/home/claude/code",
  "/home/claude/bin",
  "/home/claude/.claude",
  "/home/claude/claudes-world/.claude",
];

function isPathAllowed(absPath: string): boolean {
  const resolved = resolve(absPath);
  return ALLOWED_ROOTS.some((root) => resolved.startsWith(root));
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

/**
 * Find a non-colliding absolute path in `dir` for the given `name`.
 * If `name` exists, inserts a numeric suffix before the extension:
 *   foo.md -> foo-1.md -> foo-2.md ...
 * Shared by /upload and /paste.
 *
 * NOTE: This walk is not race-free — two concurrent callers may both
 * decide the same suffix is free. Matches the legacy /upload behavior;
 * worth revisiting if concurrent writes become common.
 */
async function pickAvailablePath(dir: string, name: string): Promise<string> {
  const destPath = join(dir, name);
  let finalPath = destPath;
  let counter = 1;
  // Find an unused path by probing stat() for each candidate.
  while (true) {
    try {
      await stat(finalPath);
    } catch {
      return finalPath;
    }
    const dotIdx = name.lastIndexOf(".");
    const hasExt = dotIdx > 0; // ignore leading dot (dotfile with no ext)
    const base = hasExt ? name.slice(0, dotIdx) : name;
    const ext = hasExt ? name.slice(dotIdx) : "";
    finalPath = join(dir, `${base}-${counter}${ext}`);
    counter++;
    if (counter > 9999) {
      // Pathological case — give up rather than loop forever.
      throw new Error("Could not find available filename");
    }
  }
}

// List available root directories
app.get("/roots", (c) => {
  return c.json({
    roots: ALLOWED_ROOTS.map((r) => ({
      path: r,
      name: r.replace("/home/claude/", "~/"),
    })),
  });
});

// List directory contents
app.get("/list", async (c) => {
  const dir = c.req.query("path") || BASE_DIR;
  const resolved = resolve(dir);

  if (!isPathAllowed(resolved)) {
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

    return c.json({
      path: resolved,
      parent: resolve(resolved, ".."),
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
  if (!isPathAllowed(resolved)) {
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
app.get("/download", async (c) => {
  const filePath = c.req.query("path");
  if (!filePath) {
    return c.json({ error: "path parameter required" }, 400);
  }

  const resolved = resolve(filePath);
  if (!isPathAllowed(resolved)) {
    return c.json({ error: "Access denied" }, 403);
  }

  try {
    const st = await stat(resolved);
    if (!st.isFile()) {
      return c.json({ error: "Not a file" }, 400);
    }

    // Cap download size at 50MB for safety
    if (st.size > 50 * 1024 * 1024) {
      return c.json({ error: "File too large (max 50MB)" }, 413);
    }

    const content = await readFile(resolved);
    const baseName = resolved.split("/").pop() || "file";

    // Basic content-type guess by extension (keeps browsers from mis-sniffing)
    const ext = baseName.split(".").pop()?.toLowerCase() || "";
    const typeMap: Record<string, string> = {
      md: "text/markdown", txt: "text/plain", json: "application/json",
      js: "application/javascript", ts: "application/typescript",
      html: "text/html", css: "text/css", csv: "text/csv",
      png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
      gif: "image/gif", webp: "image/webp", svg: "image/svg+xml",
      pdf: "application/pdf", mp3: "audio/mpeg", mp4: "video/mp4",
      webm: "video/webm", wav: "audio/wav", ogg: "audio/ogg",
      zip: "application/zip", gz: "application/gzip",
    };
    const contentType = typeMap[ext] || "application/octet-stream";

    // RFC 5987 encoding for Content-Disposition filename to handle unicode safely
    const encodedName = encodeURIComponent(baseName);

    return new Response(new Uint8Array(content), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(content.length),
        "Content-Disposition": `attachment; filename="${baseName.replace(/"/g, "")}"; filename*=UTF-8''${encodedName}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[files/download] error:", err);
    return c.json({ error: "Failed to read file" }, 500);
  }
});

// Fuzzy file/path search — BFS across all allowed roots
app.get("/search", async (c) => {
  const qRaw = c.req.query("q")?.toLowerCase() || "";
  if (qRaw.length < 2) return c.json({ results: [] });
  const q = qRaw;

  const results: { name: string; path: string; type: string; relPath: string }[] = [];
  const MAX = 25;

  // BFS queue: [dirPath, depth]
  const queue: [string, number][] = ALLOWED_ROOTS.map((r) => [r, 0]);

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
        // Match against filename OR relative path (supports partial paths)
        if (e.name.toLowerCase().includes(q) || relPath.toLowerCase().includes(q)) {
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
app.post("/upload", async (c) => {
  const body = await c.req.parseBody();
  const file = body["file"];
  const dir = (body["dir"] as string) || BASE_DIR;

  if (!file || typeof file === "string") {
    return c.json({ error: "No file provided" }, 400);
  }

  const resolved = resolve(dir);
  if (!isPathAllowed(resolved)) {
    return c.json({ error: "Access denied" }, 403);
  }

  try {
    const fileName = (file as File).name || "uploaded-file";
    const finalPath = await pickAvailablePath(resolved, fileName);

    const arrayBuffer = await (file as File).arrayBuffer();
    await writeFile(finalPath, Buffer.from(arrayBuffer));

    return c.json({
      ok: true,
      path: finalPath,
      name: finalPath.split("/").pop(),
      size: arrayBuffer.byteLength,
    });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// Paste text content into the current directory as a new file.
// JSON body: { filename: string, content: string, dir: string }
// 1MB cap, line endings normalized, filename sanitized, never overwrites.
app.post("/paste", async (c) => {
  const body = await c.req.json().catch(() => null);
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
  if (!isPathAllowed(resolved)) {
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
    const finalPath = await pickAvailablePath(resolved, cleanName);
    await writeFile(finalPath, normalized, "utf-8");
    return c.json({
      ok: true,
      path: finalPath,
      name: finalPath.split("/").pop(),
      size: Buffer.byteLength(normalized, "utf-8"),
    });
  } catch (err: any) {
    console.error("[files/paste] write error:", err);
    return c.json({ error: err?.message || "Failed to write file" }, 500);
  }
});

export { app as filesRoute };
