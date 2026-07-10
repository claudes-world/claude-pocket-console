/**
 * Whether a GET path that missed `serveStatic` looks like an asset request
 * (hashed JS/CSS bundle, source map, icon, etc.) rather than an SPA document
 * navigation (e.g. `/console`, `/terminal`).
 *
 * The SPA fallback in index.ts serves `index.html` for any non-API/WS GET
 * that `serveStatic` didn't match, so the client router can handle real app
 * routes. Without this guard that also covers stale/missing hashed assets
 * after an out-of-lockstep deploy (e.g. `/assets/app-<oldhash>.js` from a
 * client that hasn't refreshed yet): a missing-asset 404 silently becomes a
 * 200 `text/html` response, which browsers then fail to parse as JS/CSS with
 * confusing MIME/module errors instead of a clear 404 (round-2 review,
 * PR #299).
 *
 * Kept deliberately simple and path-only (no `Accept` header sniffing,
 * which Telegram WebView requests don't reliably set): any path under
 * `/assets/` or ending in a dotted extension is asset-like and should 404
 * on a miss rather than fall back to the app shell.
 */
export function isAssetLikePath(path: string): boolean {
  if (path.startsWith("/assets/")) return true;
  return /\.\w+$/.test(path);
}
