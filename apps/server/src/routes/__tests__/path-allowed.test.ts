import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  __resetRealRootCacheForTests,
  isPathAllowed,
} from "../../lib/path-allowed.js";

/**
 * Tests for the shared `isPathAllowed` helper. Covers the two hardened
 * behaviors added by the security fix:
 *
 *   1. Sibling-prefix bypass (`/tmp/root` vs `/tmp/root-evil`)
 *   2. Symlink escape (symlink inside an allowed root pointing outside)
 *
 * Each test builds a fresh temp directory layout on disk so the helper's
 * `realpathSync` calls have real inodes to resolve against.
 */

let sandbox: string;
let allowedRoot: string;
let siblingEvil: string;
let outsideDir: string;

beforeAll(() => {
  // Single parent so cleanup is one rmSync call.
  sandbox = mkdtempSync(join(tmpdir(), "cpc-path-allowed-"));

  allowedRoot = join(sandbox, "root");
  siblingEvil = join(sandbox, "root-evil");
  outsideDir = join(sandbox, "outside");

  mkdirSync(allowedRoot, { recursive: true });
  mkdirSync(join(allowedRoot, "sub", "nested"), { recursive: true });
  mkdirSync(siblingEvil, { recursive: true });
  mkdirSync(outsideDir, { recursive: true });

  writeFileSync(join(allowedRoot, "ok.txt"), "ok");
  writeFileSync(join(allowedRoot, "sub", "nested", "deep.txt"), "deep");
  writeFileSync(join(siblingEvil, "secrets.json"), "{\"api\":\"leak\"}");
  writeFileSync(join(outsideDir, "loot.txt"), "loot");

  // Symlink living INSIDE the allowed root but pointing OUTSIDE it.
  // The pre-fix check would allow this because `resolved.startsWith(root)`
  // is true for the symlink path itself; the realpath resolution in the
  // fix catches the escape.
  symlinkSync(outsideDir, join(allowedRoot, "escape-link"));
});

afterAll(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

beforeEach(() => {
  // Each test starts with an empty memoization cache so spies in one test
  // don't see warm entries from a previous test.
  __resetRealRootCacheForTests();
});

describe("isPathAllowed", () => {
  it("allows a file directly inside the allowed root", () => {
    expect(isPathAllowed(join(allowedRoot, "ok.txt"), [allowedRoot])).toBe(true);
  });

  it("allows a nested file inside the allowed root", () => {
    expect(
      isPathAllowed(join(allowedRoot, "sub", "nested", "deep.txt"), [allowedRoot]),
    ).toBe(true);
  });

  it("allows the allowed root itself", () => {
    expect(isPathAllowed(allowedRoot, [allowedRoot])).toBe(true);
  });

  it("rejects the sibling-prefix bypass (`root-evil` vs `root`)", () => {
    // Classic `startsWith`-only bypass: `/tmp/x/root-evil/secrets.json`
    // starts with `/tmp/x/root` as a string. The separator boundary in
    // the fix prevents this from matching.
    expect(
      isPathAllowed(join(siblingEvil, "secrets.json"), [allowedRoot]),
    ).toBe(false);
  });

  it("rejects the sibling-prefix directory itself", () => {
    expect(isPathAllowed(siblingEvil, [allowedRoot])).toBe(false);
  });

  it("rejects a `..` path-traversal that escapes the root after normalization", () => {
    const traversal = join(allowedRoot, "..", "root-evil", "secrets.json");
    expect(isPathAllowed(traversal, [allowedRoot])).toBe(false);
  });

  it("rejects an absolute path entirely outside the allowed root", () => {
    expect(isPathAllowed(join(outsideDir, "loot.txt"), [allowedRoot])).toBe(false);
  });

  it("rejects a symlink that lives inside the root but points outside", () => {
    // The symlink itself is at `allowedRoot/escape-link`, which would pass
    // a naive prefix check. After realpath resolution the target is
    // `outsideDir`, which is NOT under the allowed root.
    const escapeTarget = join(allowedRoot, "escape-link", "loot.txt");
    expect(isPathAllowed(escapeTarget, [allowedRoot])).toBe(false);
  });

  it("rejects a non-existent path (realpath throws)", () => {
    expect(
      isPathAllowed(join(allowedRoot, "does-not-exist.txt"), [allowedRoot]),
    ).toBe(false);
  });

  it("rejects when the candidate does not exist even if the parent does", () => {
    expect(
      isPathAllowed(join(allowedRoot, "sub", "nope", "file.txt"), [allowedRoot]),
    ).toBe(false);
  });

  it("matches against any root when multiple are allowed", () => {
    const roots = [outsideDir, allowedRoot];
    expect(isPathAllowed(join(allowedRoot, "ok.txt"), roots)).toBe(true);
    expect(isPathAllowed(join(outsideDir, "loot.txt"), roots)).toBe(true);
    expect(isPathAllowed(join(siblingEvil, "secrets.json"), roots)).toBe(false);
  });

  it("allows children of the filesystem root when `/` is an allowed root", () => {
    // Regression: previously `realRoot + sep` produced `//`, and a valid
    // child like `/tmp/...` never matched `startsWith("//")`. The fix only
    // appends the separator when the root doesn't already end with one.
    const fileUnderRoot = join(allowedRoot, "ok.txt");
    expect(isPathAllowed(fileUnderRoot, ["/"])).toBe(true);
    expect(isPathAllowed(allowedRoot, ["/"])).toBe(true);
  });

  it("memoizes realpath(root) via an on-disk swap of the root target", () => {
    // Spying on `realpathSync` in ESM is blocked by vitest (module namespace
    // is not configurable), so we verify memoization by observing a behavior
    // that ONLY holds if the cached realpath is being reused: we point a
    // symlink at one directory, prime the cache by calling isPathAllowed
    // against the symlink root, then swap the symlink to point at a
    // different directory. A non-memoized implementation would see the
    // NEW target and reject paths under the OLD one; a memoized
    // implementation keeps using the cached (old) real path.
    __resetRealRootCacheForTests();

    const swapTargetA = join(sandbox, "swap-a");
    const swapTargetB = join(sandbox, "swap-b");
    const swapLink = join(sandbox, "swap-link");
    mkdirSync(swapTargetA, { recursive: true });
    mkdirSync(swapTargetB, { recursive: true });
    writeFileSync(join(swapTargetA, "a.txt"), "a");
    writeFileSync(join(swapTargetB, "b.txt"), "b");
    symlinkSync(swapTargetA, swapLink);

    try {
      // Prime the cache: getRealRoot(swapLink) resolves to swapTargetA.
      expect(isPathAllowed(join(swapTargetA, "a.txt"), [swapLink])).toBe(true);

      // Swap the symlink to point at B. A NON-memoized implementation
      // would now resolve swapLink -> swapTargetB and reject a.txt.
      rmSync(swapLink);
      symlinkSync(swapTargetB, swapLink);

      // With memoization, the cached realpath (swapTargetA) is still used,
      // so a.txt remains allowed.
      expect(isPathAllowed(join(swapTargetA, "a.txt"), [swapLink])).toBe(true);
      // And b.txt — which IS under the current target of the symlink but
      // NOT under the cached realpath — is NOT allowed.
      expect(isPathAllowed(join(swapTargetB, "b.txt"), [swapLink])).toBe(false);

      // Reset the cache; the next call re-resolves and picks up the swap,
      // so the behavior inverts: a.txt is now rejected, b.txt is allowed.
      __resetRealRootCacheForTests();
      expect(isPathAllowed(join(swapTargetA, "a.txt"), [swapLink])).toBe(false);
      expect(isPathAllowed(join(swapTargetB, "b.txt"), [swapLink])).toBe(true);
    } finally {
      rmSync(swapLink, { force: true });
      rmSync(swapTargetA, { recursive: true, force: true });
      rmSync(swapTargetB, { recursive: true, force: true });
      __resetRealRootCacheForTests();
    }
  });
});
