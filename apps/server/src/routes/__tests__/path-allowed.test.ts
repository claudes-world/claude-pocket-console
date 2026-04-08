import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isPathAllowed } from "../../lib/path-allowed.js";

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
});
