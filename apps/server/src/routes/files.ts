import { Hono } from "hono";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { telegramAuth } from "../middleware.js";

const app = new Hono();

// Always require auth — the middleware handles missing token gracefully
app.use("*", telegramAuth);

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
          // Show dotfiles when inside a dotfile root (like .claude/)
          if (resolved.includes("/.")) return true;
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
