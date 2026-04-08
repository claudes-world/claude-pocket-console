import { Hono } from "hono";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { isPathAllowed as isPathAllowedShared } from "../lib/path-allowed.js";

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

function isPathAllowed(absPath: string): Promise<boolean> {
  return isPathAllowedShared(absPath, ALLOWED_ROOTS);
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
app.get("/download", async (c) => {
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
  if (!await isPathAllowed(resolved)) {
    return c.json({ error: "Access denied" }, 403);
  }

  try {
    // Strip any directory components from the user-supplied filename so a
    // value like "../../etc/passwd" cannot escape the validated `resolved`
    // directory via path.join. basename() returns just the trailing segment.
    const fileName = basename((file as File).name || "uploaded-file");
    const destPath = join(resolved, fileName);

    // Don't overwrite existing files — add suffix
    let finalPath = destPath;
    let counter = 1;
    try {
      while (await stat(finalPath)) {
        const ext = fileName.includes(".") ? "." + fileName.split(".").pop() : "";
        const base = fileName.includes(".") ? fileName.slice(0, fileName.lastIndexOf(".")) : fileName;
        finalPath = join(resolved, `${base}-${counter}${ext}`);
        counter++;
      }
    } catch {
      // File doesn't exist — good, use this path
    }

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

export { app as filesRoute };
