import { describe, expect, it } from "vitest";
import { isAssetLikePath } from "../spa-fallback.js";

/**
 * Round-2 review (PR #299): the SPA fallback in index.ts used to serve
 * index.html for ANY GET that missed serveStatic, including stale/missing
 * hashed assets after an out-of-lockstep deploy — turning a should-be-404
 * into a confusing 200 text/html response. isAssetLikePath is the extracted
 * decision helper; these are the two scenarios called out in the review.
 */
describe("isAssetLikePath", () => {
  it("treats a missing hashed asset under /assets/ as asset-like (should 404)", () => {
    expect(isAssetLikePath("/assets/missing-abc123.js")).toBe(true);
  });

  it("treats a real document navigation like /console as NOT asset-like (should fall back to index.html)", () => {
    expect(isAssetLikePath("/console")).toBe(false);
  });

  it("treats the app-shell root as not asset-like", () => {
    expect(isAssetLikePath("/")).toBe(false);
  });

  it("treats a nested SPA route without an extension as not asset-like", () => {
    expect(isAssetLikePath("/terminal")).toBe(false);
  });

  it("treats any dotted-extension path as asset-like even outside /assets", () => {
    expect(isAssetLikePath("/favicon.ico")).toBe(true);
    expect(isAssetLikePath("/robots.txt")).toBe(true);
    expect(isAssetLikePath("/some/nested/file.map")).toBe(true);
  });

  it("treats a bare /assets/ directory path with no extension as asset-like (prefix rule)", () => {
    expect(isAssetLikePath("/assets/")).toBe(true);
  });
});
