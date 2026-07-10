import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, parse } from "node:path";
import {
  __resetRealRootCacheForTests,
  isPathAllowed,
  openAllowedForRead,
} from "../../lib/path-allowed.js";

/**
 * Tests for the shared `isPathAllowed` helper. Covers the two hardened
 * behaviors added by the security fix:
 *
 *   1. Sibling-prefix bypass (`/tmp/root` vs `/tmp/root-evil`)
 *   2. Symlink escape (symlink inside an allowed root pointing outside)
 *
 * Each test builds a fresh temp directory layout on disk so the helper's
 * `realpath` calls have real inodes to resolve against.
 */

// On Windows, creating a *directory* symlink requires Developer Mode or admin
// rights. Junctions are a Windows-only alternative for directory links that
// work without those privileges, so the suite stays runnable on stock Windows
// CI. File-level symlinks on Windows still require elevated rights; if any
// file-symlink tests are added they should use a similar platform guard.
const symlinkType = process.platform === "win32" ? "junction" : undefined;

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
  symlinkSync(outsideDir, join(allowedRoot, "escape-link"), symlinkType);
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
  it("allows a file directly inside the allowed root", async () => {
    expect(await isPathAllowed(join(allowedRoot, "ok.txt"), [allowedRoot])).toBe(true);
  });

  it("allows a nested file inside the allowed root", async () => {
    expect(
      await isPathAllowed(join(allowedRoot, "sub", "nested", "deep.txt"), [allowedRoot]),
    ).toBe(true);
  });

  it("allows the allowed root itself", async () => {
    expect(await isPathAllowed(allowedRoot, [allowedRoot])).toBe(true);
  });

  it("rejects the sibling-prefix bypass (`root-evil` vs `root`)", async () => {
    // Classic `startsWith`-only bypass: `/tmp/x/root-evil/secrets.json`
    // starts with `/tmp/x/root` as a string. The separator boundary in
    // the fix prevents this from matching.
    expect(
      await isPathAllowed(join(siblingEvil, "secrets.json"), [allowedRoot]),
    ).toBe(false);
  });

  it("rejects the sibling-prefix directory itself", async () => {
    expect(await isPathAllowed(siblingEvil, [allowedRoot])).toBe(false);
  });

  it("rejects a `..` path-traversal that escapes the root after normalization", async () => {
    const traversal = join(allowedRoot, "..", "root-evil", "secrets.json");
    expect(await isPathAllowed(traversal, [allowedRoot])).toBe(false);
  });

  it("rejects an absolute path entirely outside the allowed root", async () => {
    expect(await isPathAllowed(join(outsideDir, "loot.txt"), [allowedRoot])).toBe(false);
  });

  it("rejects a symlink that lives inside the root but points outside", async () => {
    // The symlink itself is at `allowedRoot/escape-link`, which would pass
    // a naive prefix check. After realpath resolution the target is
    // `outsideDir`, which is NOT under the allowed root.
    const escapeTarget = join(allowedRoot, "escape-link", "loot.txt");
    expect(await isPathAllowed(escapeTarget, [allowedRoot])).toBe(false);
  });

  it("rejects a non-existent path (realpath rejects)", async () => {
    expect(
      await isPathAllowed(join(allowedRoot, "does-not-exist.txt"), [allowedRoot]),
    ).toBe(false);
  });

  it("rejects when the candidate does not exist even if the parent does", async () => {
    expect(
      await isPathAllowed(join(allowedRoot, "sub", "nope", "file.txt"), [allowedRoot]),
    ).toBe(false);
  });

  it("matches against any root when multiple are allowed", async () => {
    const roots = [outsideDir, allowedRoot];
    expect(await isPathAllowed(join(allowedRoot, "ok.txt"), roots)).toBe(true);
    expect(await isPathAllowed(join(outsideDir, "loot.txt"), roots)).toBe(true);
    expect(await isPathAllowed(join(siblingEvil, "secrets.json"), roots)).toBe(false);
  });

  it("allows children of the filesystem root when the platform root is an allowed root", async () => {
    // Regression: previously `realRoot + sep` produced `//`, and a valid
    // child like `/tmp/...` never matched `startsWith("//")`. The fix only
    // appends the separator when the root doesn't already end with one.
    //
    // Use the platform-specific root via path.parse — on Unix this is "/",
    // on Windows path.resolve("/") returns the current drive root (e.g.
    // "D:\\") which may differ from the temp sandbox drive in CI.
    const platformRoot = parse(allowedRoot).root;
    const fileUnderRoot = join(allowedRoot, "ok.txt");
    expect(await isPathAllowed(fileUnderRoot, [platformRoot])).toBe(true);
    expect(await isPathAllowed(allowedRoot, [platformRoot])).toBe(true);
  });

  it("allows a path under /home/claude/.world when that root is in the allowlist", async () => {
    // Verify that ALLOWED_FILE_ROOTS includes /home/claude/.world by importing it
    // and checking membership, then confirm the helper resolves the path as allowed
    // against a synthetic tmp-based root (we can't use the live .world path in CI
    // because it may not exist on the test host).
    const { ALLOWED_FILE_ROOTS } = await import("../../lib/path-allowed.js");
    expect(ALLOWED_FILE_ROOTS).toContain("/home/claude/.world");

    // Functional check: a nested path under an allowed root that mimics the
    // .world layout is accepted. Uses the existing allowedRoot fixture.
    const snapshotsDir = join(allowedRoot, "pulse", "snapshots");
    mkdirSync(snapshotsDir, { recursive: true });
    writeFileSync(join(snapshotsDir, "current.json"), "{}");
    expect(
      await isPathAllowed(join(snapshotsDir, "current.json"), [allowedRoot]),
    ).toBe(true);
  });

  it("read roots include the view-only additions; write roots do not (Liam voice 1238)", async () => {
    const { ALLOWED_FILE_ROOTS, ALLOWED_WRITE_ROOTS } = await import(
      "../../lib/path-allowed.js"
    );
    // View-only roots readable…
    expect(ALLOWED_FILE_ROOTS).toContain("/tmp");
    expect(ALLOWED_FILE_ROOTS).toContain("/home/claude/.worldos/lanes");
    // …but never writable.
    expect(ALLOWED_WRITE_ROOTS).not.toContain("/tmp");
    expect(ALLOWED_WRITE_ROOTS).not.toContain("/home/claude/.worldos/lanes");
    // Write roots are a strict subset of read roots (every writable place
    // is also viewable), and the write list is exactly the pre-expansion
    // allowlist so the write surface never widened.
    for (const root of ALLOWED_WRITE_ROOTS) {
      expect(ALLOWED_FILE_ROOTS).toContain(root);
    }
    expect(ALLOWED_WRITE_ROOTS.length).toBeLessThan(ALLOWED_FILE_ROOTS.length);
  });

  it("denies a /tmp-style symlink that points outside every allowed root", async () => {
    // /tmp is world-writable: any local process can plant a symlink there.
    // The escape-link fixture models exactly that — a link inside an
    // allowed root targeting a directory outside all roots. realpath
    // resolution must reject both the link and anything beneath it.
    expect(await isPathAllowed(join(allowedRoot, "escape-link"), [allowedRoot])).toBe(false);
    expect(
      await isPathAllowed(join(allowedRoot, "escape-link", "loot.txt"), [allowedRoot]),
    ).toBe(false);
  });

  describe("openAllowedForRead (race-safe open+validate)", () => {
    it("opens a real file inside an allowed root and reports its real path", async () => {
      const r = await openAllowedForRead(join(allowedRoot, "ok.txt"), [allowedRoot]);
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.realPath).toBe(join(allowedRoot, "ok.txt"));
        expect((await r.handle.readFile()).toString()).toBe("ok");
        await r.handle.close();
      }
    });

    it("follows a symlink whose target is INSIDE an allowed root (legacy semantics preserved)", async () => {
      const linkInside = join(allowedRoot, "inside-link.txt");
      symlinkSync(join(allowedRoot, "ok.txt"), linkInside, symlinkType);
      try {
        const r = await openAllowedForRead(linkInside, [allowedRoot]);
        expect(r.ok).toBe(true);
        if (r.ok) await r.handle.close();
      } finally {
        unlinkSync(linkInside);
      }
    });

    it("denies (and closes) a symlink whose target is OUTSIDE all roots", async () => {
      // The fd is opened (following the link) but validated against the
      // OPENED inode's real path — /proc/self/fd — so the escape is caught
      // even though open() itself succeeded.
      const r = await openAllowedForRead(join(allowedRoot, "escape-link", "loot.txt"), [allowedRoot]);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe("denied");
    });

    it("closes the race: a file swapped for an out-of-root symlink after a name check is still rejected", async () => {
      // Model the TOCTOU: a path that WOULD pass a by-name check is swapped
      // for an escape symlink before the read. openAllowedForRead validates
      // the opened fd's identity, so it can only ever return ok for the file
      // it actually holds — never the swapped-in secret.
      const racy = join(allowedRoot, "racy.txt");
      // State A: legit file → allowed.
      writeFileSync(racy, "legit");
      const a = await openAllowedForRead(racy, [allowedRoot]);
      expect(a.ok).toBe(true);
      if (a.ok) {
        expect((await a.handle.readFile()).toString()).toBe("legit");
        await a.handle.close();
      }
      // State B: swapped to a symlink pointing outside → denied, no leak.
      unlinkSync(racy);
      symlinkSync(join(outsideDir, "loot.txt"), racy, symlinkType);
      const b = await openAllowedForRead(racy, [allowedRoot]);
      expect(b.ok).toBe(false);
      unlinkSync(racy);
    });

    it("reports not-found for a missing file (distinct from denied)", async () => {
      const r = await openAllowedForRead(join(allowedRoot, "nope.txt"), [allowedRoot]);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe("not-found");
    });
  });

  it("memoizes realpath(root) via an on-disk swap of the root target", async () => {
    // Spying on `realpath` in ESM is blocked by vitest (module namespace
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
    symlinkSync(swapTargetA, swapLink, symlinkType);

    try {
      // Prime the cache: getRealRoot(swapLink) resolves to swapTargetA.
      expect(await isPathAllowed(join(swapTargetA, "a.txt"), [swapLink])).toBe(true);

      // Swap the symlink to point at B. A NON-memoized implementation
      // would now resolve swapLink -> swapTargetB and reject a.txt.
      rmSync(swapLink);
      symlinkSync(swapTargetB, swapLink, symlinkType);

      // With memoization, the cached realpath (swapTargetA) is still used,
      // so a.txt remains allowed.
      expect(await isPathAllowed(join(swapTargetA, "a.txt"), [swapLink])).toBe(true);
      // And b.txt — which IS under the current target of the symlink but
      // NOT under the cached realpath — is NOT allowed.
      expect(await isPathAllowed(join(swapTargetB, "b.txt"), [swapLink])).toBe(false);

      // Reset the cache; the next call re-resolves and picks up the swap,
      // so the behavior inverts: a.txt is now rejected, b.txt is allowed.
      __resetRealRootCacheForTests();
      expect(await isPathAllowed(join(swapTargetA, "a.txt"), [swapLink])).toBe(false);
      expect(await isPathAllowed(join(swapTargetB, "b.txt"), [swapLink])).toBe(true);
    } finally {
      rmSync(swapLink, { force: true });
      rmSync(swapTargetA, { recursive: true, force: true });
      rmSync(swapTargetB, { recursive: true, force: true });
      __resetRealRootCacheForTests();
    }
  });
});
