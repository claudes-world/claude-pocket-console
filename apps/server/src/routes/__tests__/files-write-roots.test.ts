import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Read-roots vs write-roots split (file-viewer expansion, Liam voice 1238):
 * view-only roots (/tmp, legacy lane workspaces) must be listable/readable
 * but NEVER writable — upload and paste are gated on the narrower
 * ALLOWED_WRITE_ROOTS.
 *
 * Unlike file-upload.test.ts (whose mock ignores the roots argument), this
 * suite substitutes the two root CONSTANTS with sandbox directories and
 * leaves isPathAllowed fully real, so the routes' choice of which list to
 * pass is exactly what's under test.
 *
 * Also covers the synthetic /home/claude listing: every TOP-LEVEL root
 * (not nested inside another root) appears, including roots outside
 * /home/claude, labeled by their real path.
 */

let sandbox: string;
let readOnlyRoot: string; // stands in for /tmp or ~/.worldos/lanes
let writableRoot: string; // stands in for e.g. ~/claudes-world
let nestedRoot: string; // a root nested inside writableRoot (like claudes-world/.claude)

// files.ts captures `const ALLOWED_ROOTS = ALLOWED_FILE_ROOTS` at import
// time, before beforeAll can create the sandbox — so the mocked constants
// must be STABLE ARRAY REFERENCES whose contents are filled in later.
// vi.hoisted lifts them above the hoisted vi.mock factory.
const mockRoots = vi.hoisted(() => ({
  file: [] as string[],
  write: [] as string[],
}));

vi.mock("../../lib/path-allowed.js", async () => {
  const real = await vi.importActual<typeof import("../../lib/path-allowed.js")>(
    "../../lib/path-allowed.js",
  );
  return {
    ...real,
    ALLOWED_FILE_ROOTS: mockRoots.file,
    ALLOWED_WRITE_ROOTS: mockRoots.write,
  };
});

const { filesRoute } = await import("../files.js");
const { __resetRealRootCacheForTests } = await vi.importActual<
  typeof import("../../lib/path-allowed.js")
>("../../lib/path-allowed.js");

beforeAll(() => {
  process.env.NODE_ENV = "test";
  sandbox = mkdtempSync(join(tmpdir(), "cpc-write-roots-"));
  readOnlyRoot = join(sandbox, "view-only");
  writableRoot = join(sandbox, "writable");
  nestedRoot = join(writableRoot, "nested-root");
  mkdirSync(readOnlyRoot, { recursive: true });
  mkdirSync(nestedRoot, { recursive: true });
  writeFileSync(join(readOnlyRoot, "artifact.txt"), "shared artifact");
  mockRoots.file.push(writableRoot, nestedRoot, readOnlyRoot);
  mockRoots.write.push(writableRoot, nestedRoot);
  __resetRealRootCacheForTests();
});

afterAll(() => {
  rmSync(sandbox, { recursive: true, force: true });
  __resetRealRootCacheForTests();
});

async function get(path: string) {
  const res = await filesRoute.request(path);
  return { status: res.status, body: (await res.json()) as any };
}

describe("view-only roots are readable", () => {
  it("lists a directory under a read-only root", async () => {
    const { status, body } = await get(`/list?path=${encodeURIComponent(readOnlyRoot)}`);
    expect(status).toBe(200);
    expect(body.items.map((i: any) => i.name)).toContain("artifact.txt");
  });

  it("reads a file under a read-only root", async () => {
    const { status, body } = await get(`/read?path=${encodeURIComponent(join(readOnlyRoot, "artifact.txt"))}`);
    expect(status).toBe(200);
    expect(body.content).toBe("shared artifact");
  });
});

describe("view-only roots reject writes", () => {
  it("403s an upload into a read-only root", async () => {
    const form = new FormData();
    form.append("file", new File(["data"], "evil.txt"));
    form.append("dir", readOnlyRoot);
    const res = await filesRoute.request("/upload", { method: "POST", body: form });
    expect(res.status).toBe(403);
    const body = (await res.json()) as any;
    expect(body.error).toBe("Access denied");
  });

  it("403s a paste into a read-only root", async () => {
    const res = await filesRoute.request("/paste", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "hello", filename: "note.md", dir: readOnlyRoot }),
    });
    expect(res.status).toBe(403);
  });

  it("still accepts an upload into a writable root", async () => {
    const form = new FormData();
    form.append("file", new File(["data"], "ok.txt"));
    form.append("dir", writableRoot);
    const res = await filesRoute.request("/upload", { method: "POST", body: form });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.ok).toBe(true);
  });

  it("still accepts a paste into a writable root", async () => {
    const res = await filesRoute.request("/paste", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "hello", filename: "note2.md", dir: writableRoot }),
    });
    expect(res.status).toBe(200);
  });
});

describe("synthetic home lists top-level roots only", () => {
  it("includes read-only and writable top-level roots, excludes nested roots", async () => {
    const { status, body } = await get(`/list?path=${encodeURIComponent("/home/claude")}`);
    expect(status).toBe(200);
    const paths = body.items.map((i: any) => i.path);
    expect(paths).toContain(writableRoot);
    expect(paths).toContain(readOnlyRoot);
    // Nested inside writableRoot → reachable by browsing, not shown at top level.
    expect(paths).not.toContain(nestedRoot);
    // Roots outside /home/claude are labeled by their real path, not basename.
    const readOnlyItem = body.items.find((i: any) => i.path === readOnlyRoot);
    expect(readOnlyItem.name).toBe(readOnlyRoot);
  });
});
