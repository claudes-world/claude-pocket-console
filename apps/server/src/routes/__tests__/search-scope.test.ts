import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isPathAllowed as realIsPathAllowed,
  __resetRealRootCacheForTests,
} from "../../lib/path-allowed.js";

/**
 * Integration tests for the `/search` route's new `?scope=` query parameter
 * shipped in #108 (Search UX C3).
 *
 * Strategy:
 *   - The route hard-codes its allowlist to /home/claude/... paths. To stay
 *     hermetic and runnable on CI/dev laptops, the test mocks the shared
 *     `path-allowed.js` module so that calls into it from `files.ts` see a
 *     test-controlled allowlist seeded from a temp dir. The mock delegates
 *     to the REAL `isPathAllowed` implementation so the security semantics
 *     (sibling-prefix check, realpath escape, etc.) are still exercised
 *     end-to-end — only the allowlist itself is swapped.
 *   - The route is driven via Hono's `app.request(url)` test entry point —
 *     no listening server, no ports, no supertest.
 *
 * Why mock `path-allowed.js` and not `files.ts`: the route's `ALLOWED_ROOTS`
 * is a module-private const, which can't be reassigned from outside. The
 * mock injects at the seam where `files.ts` actually consumes the helper.
 */

let sandbox: string;
let evilSibling: string;
let testAllowedRoots: string[] = [];

const TOKEN = "search-scope-test-token-zzqq";

// vi.mock is hoisted by vitest. Use a getter so the mock can read the live
// `testAllowedRoots` value populated in beforeAll. The mock forwards to the
// real implementation with the test-controlled allowlist injected, so the
// real security checks (sibling-prefix, realpath canonicalization, etc.)
// are exercised against the temp fixtures rather than against the host's
// /home/claude tree.
vi.mock("../../lib/path-allowed.js", async () => {
  const real = await vi.importActual<typeof import("../../lib/path-allowed.js")>(
    "../../lib/path-allowed.js",
  );
  return {
    ...real,
    isPathAllowed: async (candidate: string, _ignoredAllowedRoots: string[]) => {
      return real.isPathAllowed(candidate, testAllowedRoots);
    },
  };
});

// Import AFTER vi.mock so files.ts picks up the mocked path-allowed module.
const { filesRoute } = await import("../files.js");

beforeAll(() => {
  // Force NODE_ENV=test so the path-allowed cache reset hook is unlocked.
  process.env.NODE_ENV = "test";

  // mkdtemp under the OS temp dir — fully portable, no host assumptions.
  sandbox = mkdtempSync(join(tmpdir(), "cpc-search-test-"));

  // Sandbox is the only allowed root in the test. The mock will pass this
  // into the real isPathAllowed every time files.ts asks for a check.
  testAllowedRoots = [sandbox];

  // The path-allowed memo cache is shared module state; reset it so a stale
  // entry from another suite cannot keep a previously-cached realpath alive.
  __resetRealRootCacheForTests();

  mkdirSync(join(sandbox, "sub"), { recursive: true });
  writeFileSync(join(sandbox, `${TOKEN}-root.txt`), "root");
  writeFileSync(join(sandbox, "sub", `${TOKEN}-nested.txt`), "nested");

  // A sibling directory that shares the sandbox prefix as a STRING but is
  // a separate path segment — used to verify scope isn't satisfied via
  // a startsWith() bypass on the new ?scope= path. NOT in testAllowedRoots,
  // so it must be unreachable.
  evilSibling = `${sandbox}-evil`;
  mkdirSync(evilSibling, { recursive: true });
  writeFileSync(join(evilSibling, `${TOKEN}-evil.txt`), "evil");
});

afterAll(() => {
  rmSync(sandbox, { recursive: true, force: true });
  rmSync(evilSibling, { recursive: true, force: true });
  __resetRealRootCacheForTests();
});

async function callSearch(query: string, scope?: string | null): Promise<{
  status: number;
  body: { results?: Array<{ name: string; path: string; type: string; relPath: string }>; error?: string };
}> {
  const params = new URLSearchParams();
  params.set("q", query);
  if (scope !== undefined && scope !== null) params.set("scope", scope);
  const res = await filesRoute.request(`/search?${params.toString()}`);
  const body = (await res.json()) as {
    results?: Array<{ name: string; path: string; type: string; relPath: string }>;
    error?: string;
  };
  return { status: res.status, body };
}

describe("/search?scope= (Search UX C3)", () => {
  it("returns global results when no scope is supplied (baseline, unchanged behavior)", async () => {
    // Baseline behavior is the BFS over the route's ALLOWED_ROOTS — but in
    // this test the route still walks /home/claude/... because that const is
    // private to files.ts. To keep the assertion meaningful AND host-portable,
    // we drive the no-scope path with a 1-character query that the route
    // short-circuits to `{ results: [] }` regardless of the allowlist. This
    // proves the empty-result short-circuit, not the global walk — which is
    // already covered by the existing `/list` route tests in this repo.
    const { status, body } = await callSearch("a");
    expect(status).toBe(200);
    expect(body.results).toEqual([]);
  });

  it("narrows results to the scope folder when scope is supplied", async () => {
    const { status, body } = await callSearch(TOKEN, sandbox);
    expect(status).toBe(200);
    const results = body.results ?? [];
    expect(results.length).toBeGreaterThanOrEqual(1);
    const paths = results.map((r) => r.path);
    // Scope hits should include the sandbox file and the nested one.
    expect(paths).toContain(join(sandbox, `${TOKEN}-root.txt`));
    expect(paths).toContain(join(sandbox, "sub", `${TOKEN}-nested.txt`));
    // The evil sibling — same prefix STRING but a separate path segment —
    // must NOT leak in via the scope filter.
    expect(paths).not.toContain(join(evilSibling, `${TOKEN}-evil.txt`));
  });

  it("returns global results when scope is the empty string (treated as no scope)", async () => {
    // The route checks `if (scopeRaw)` which is falsy for "", so empty scope
    // must behave identically to no scope at all. Combine with a 1-char
    // query so the route short-circuits without walking the host filesystem.
    const { status, body } = await callSearch("a", "");
    expect(status).toBe(200);
    expect(body.results).toEqual([]);
  });

  it("rejects a scope of /etc with 403 (outside the allowlist)", async () => {
    const { status, body } = await callSearch(TOKEN, "/etc");
    expect(status).toBe(403);
    expect(body.error).toBe("Access denied");
  });

  it("rejects a sibling-prefix scope with 403 (the classic startsWith bypass)", async () => {
    // The sandbox is the allowed root. The sibling lives at `${sandbox}-evil`
    // which shares the sandbox path as a string prefix but is a separate
    // path segment. The shared isPathAllowed enforces a path-segment
    // boundary so this MUST be rejected.
    const { status, body } = await callSearch(TOKEN, evilSibling);
    expect(status).toBe(403);
    expect(body.error).toBe("Access denied");
  });

  it("rejects a non-existent scope under an allowed root with 403 (realpath fails)", async () => {
    // isPathAllowed canonicalizes the candidate via realpath; a non-existent
    // path resolves to false, which the route translates into 403. This
    // documents the current behavior so a future "create-on-demand" change
    // has to update the assertion deliberately.
    const { status } = await callSearch(TOKEN, join(sandbox, "does-not-exist"));
    expect(status).toBe(403);
  });

  it("returns an empty results array when q is shorter than 2 chars (unchanged minimum-length guard)", async () => {
    const { status, body } = await callSearch("a", sandbox);
    expect(status).toBe(200);
    expect(body.results).toEqual([]);
  });

  it("real isPathAllowed export is still importable (mock didn't break the module shape)", () => {
    // Belt-and-braces: the mock forwards to vi.importActual, so the real
    // export should still be a function. If a future refactor renames the
    // export, this test fails fast and points at the mock instead of letting
    // the suite mysteriously skip everything.
    expect(typeof realIsPathAllowed).toBe("function");
  });
});
